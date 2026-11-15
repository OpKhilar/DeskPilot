import { promises as fs } from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";

/**
 * DeskPilot's private RAG store.
 *
 * Chunks + embeddings live in `data/rag-store.json` so uploaded policy files
 * survive a server restart. The file is created and seeded with four Indian D2C
 * policy documents on first use. Embeddings come from Gemini
 * (`text-embedding-004`) when a key is available, and from a deterministic
 * hashed bag-of-words vectorizer otherwise, so retrieval works offline.
 *
 * This module touches the filesystem and must only run on the server.
 */

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "rag-store.json");

/** Target characters per chunk, with this much trailing text repeated after. */
const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 100;

const LOCAL_DIM = 384;
const LOCAL_MODEL = "local:hashed-bow-384";
/** Overridable so a retired model name can be swapped without a code change. */
const GOOGLE_EMBEDDING_MODEL =
  process.env.GEMINI_EMBEDDING_MODEL || "text-embedding-004";

const SCHEMA_VERSION = 1;

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface RagChunkDraft {
  id: string;
  docId: string;
  title: string;
  version: string;
  chunkIndex: number;
  text: string;
  start: number;
  end: number;
}

export interface RagChunk extends RagChunkDraft {
  embedding: number[];
  embeddingModel: string;
  createdAt: string;
}

export interface RagDocumentRecord {
  docId: string;
  title: string;
  version: string;
  chunkCount: number;
  embeddingModel: string;
  updatedAt: string;
}

export interface RagStore {
  schemaVersion: number;
  documents: RagDocumentRecord[];
  chunks: RagChunk[];
}

export type RetrievedChunk = Omit<RagChunk, "embedding"> & { score: number };

export interface IngestResult {
  docId: string;
  title: string;
  version: string;
  chunkCount: number;
  replacedChunks: number;
  embeddingModel: string;
  storePath: string;
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  topScore: number;
}

/* -------------------------------------------------------------------------- */
/* Chunking                                                                   */
/* -------------------------------------------------------------------------- */

const ABBREVIATIONS = new Set([
  "mr",
  "mrs",
  "ms",
  "dr",
  "vs",
  "etc",
  "e.g",
  "i.e",
  "rs",
  "no",
  "approx",
]);

function normaliseWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Split into sentences, keeping terminal punctuation. */
function splitSentences(text: string): string[] {
  const raw = text.match(/[^.!?…]+[.!?…]+["')\]]*|[^.!?…]+$/g) ?? [text];
  const sentences: string[] = [];

  for (const piece of raw) {
    const sentence = piece.trim();
    if (!sentence) continue;

    // Re-join accidental breaks after common abbreviations and initials.
    const previous = sentences[sentences.length - 1];
    const lastWord = previous
      ?.replace(/[.!?…]+$/, "")
      .split(/\s+/)
      .pop()
      ?.toLowerCase();
    if (previous && lastWord && (ABBREVIATIONS.has(lastWord) || /^[a-z]$/.test(lastWord))) {
      sentences[sentences.length - 1] = `${previous} ${sentence}`;
    } else {
      sentences.push(sentence);
    }
  }

  return sentences;
}

/** Split an over-long sentence on word boundaries into <= maxLength pieces. */
function splitLongText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const pieces: string[] = [];
  let buffer = "";

  for (const word of text.split(/\s+/)) {
    if (!buffer) {
      buffer = word;
    } else if (buffer.length + 1 + word.length <= maxLength) {
      buffer += ` ${word}`;
    } else {
      pieces.push(buffer);
      buffer = word;
    }

    // A single enormous token (URL, no-space text) is hard-cut.
    while (buffer.length > maxLength) {
      pieces.push(buffer.slice(0, maxLength));
      buffer = buffer.slice(maxLength);
    }
  }

  if (buffer) pieces.push(buffer);
  return pieces;
}

/** The trailing text of a chunk, snapped forward to a word boundary. */
function overlapTail(text: string): string {
  if (text.length <= CHUNK_OVERLAP) return "";
  const tail = text.slice(-CHUNK_OVERLAP);
  const firstSpace = tail.indexOf(" ");
  if (firstSpace === -1) return tail;
  const snapped = tail.slice(firstSpace + 1).trim();
  return snapped.length > 0 ? snapped : tail.trim();
}

/**
 * Split text into ~500 character chunks with a 100 character overlap.
 * Sentence boundaries are preserved wherever a sentence fits in a chunk.
 */
export function chunkText(
  text: string,
  docMeta: { docId: string; title: string; version: string },
): RagChunkDraft[] {
  const normalised = normaliseWhitespace(text);
  if (!normalised) return [];

  // Keep every unit comfortably below the chunk size so that prepending the
  // overlap cannot blow past it.
  const maxUnitLength = CHUNK_SIZE - CHUNK_OVERLAP;
  const units = splitSentences(normalised).flatMap((sentence) =>
    splitLongText(sentence, maxUnitLength),
  );

  const texts: string[] = [];
  let current = "";

  for (const unit of units) {
    const candidate = current ? `${current} ${unit}` : unit;

    if (candidate.length <= CHUNK_SIZE) {
      current = candidate;
      continue;
    }

    if (current.trim()) texts.push(current.trim());
    const tail = overlapTail(current);
    current = tail ? `${tail} ${unit}` : unit;

    // Defensive: a carried tail plus a max-length unit can exceed the target.
    if (current.length > CHUNK_SIZE) {
      texts.push(current.trim());
      current = overlapTail(current);
    }
  }

  if (current.trim()) texts.push(current.trim());

  // Drop a trailing chunk that only repeats the previous overlap.
  const unique = texts.filter(
    (chunk, index) =>
      chunk.length > 0 &&
      (index === 0 || !texts[index - 1].trim().endsWith(chunk.trim())),
  );

  let searchFrom = 0;
  return unique.map((chunk, index) => {
    const start = normalised.indexOf(chunk, searchFrom);
    const safeStart = start === -1 ? searchFrom : start;
    const end = Math.min(normalised.length, safeStart + chunk.length);
    // Advance to the chunk's start, not its end: the next chunk deliberately
    // begins inside this one, so its text is found at an earlier offset.
    if (start !== -1) searchFrom = safeStart;

    return {
      id: `${docMeta.docId}::${docMeta.version}::${index}`,
      docId: docMeta.docId,
      title: docMeta.title,
      version: docMeta.version,
      chunkIndex: index,
      text: chunk,
      start: safeStart,
      end,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Embeddings                                                                 */
/* -------------------------------------------------------------------------- */

const STOPWORDS = new Set([
  "a","about","above","after","again","all","also","am","an","and","any","are","as","at",
  "be","because","been","before","being","below","between","both","but","by","can","could",
  "did","do","does","doing","down","during","each","few","for","from","further","had","has",
  "have","having","he","her","here","hers","him","his","how","i","if","in","into","is","it",
  "its","itself","just","me","more","most","my","no","nor","not","now","of","off","on","once",
  "only","or","other","our","out","over","own","same","she","should","so","some","such","than",
  "that","the","their","them","then","there","these","they","this","those","through","to","too",
  "under","until","up","very","was","we","were","what","when","where","which","while","who",
  "whom","why","will","with","would","you","your",
  // Roman-script Hindi function words, so Hinglish queries match content words.
  "hai","hain","ho","hota","hoti","kya","ka","ki","ke","ko","se","me","mein","par","aur","ya",
  "nahi","nahin","bhi","toh","tab","mera","meri","mere","aap","aapka","aapki","hum","woh",
  "yeh","ye","jo","kar","karo","karna","karte","gaya","gayi","liye","wala","wali","bahut",
]);

const EMBEDDING_CACHE_LIMIT = 500;
const embeddingCache = new Map<string, number[]>();

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

/** FNV-1a, 32-bit, deterministic across runs and platforms. */
function hashToken(token: string): number {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function l2Normalise(vector: number[]): number[] {
  let sumSquares = 0;
  for (const value of vector) sumSquares += value * value;
  const norm = Math.sqrt(sumSquares);
  if (!norm) return vector;
  return vector.map((value) => value / norm);
}

/**
 * Deterministic offline embedding: hashed bag-of-words with sublinear term
 * frequency and word-bigram features, L2-normalised for cosine similarity.
 * No network, no rate limits, identical output for identical text.
 */
function localEmbedding(text: string): number[] {
  const tokens = tokenize(text);
  const vector = new Array<number>(LOCAL_DIM).fill(0);
  if (tokens.length === 0) return vector;

  const counts = new Map<string, number>();
  const addTerm = (term: string) => {
    counts.set(term, (counts.get(term) ?? 0) + 1);
  };

  tokens.forEach(addTerm);
  for (let index = 0; index < tokens.length - 1; index += 1) {
    addTerm(`${tokens[index]}_${tokens[index + 1]}`);
  }

  for (const [term, count] of counts) {
    const hash = hashToken(term);
    const bucket = hash % LOCAL_DIM;
    const sign = (hash & 0x80000000) !== 0 ? -1 : 1;
    const weight = 1 + Math.log(count);
    vector[bucket] += sign * (term.includes("_") ? weight * 0.5 : weight);
  }

  return l2Normalise(vector);
}

function googleApiKey(): string | undefined {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || undefined;
}

let googleClient: GoogleGenAI | null = null;

async function googleEmbedding(text: string): Promise<number[]> {
  const apiKey = googleApiKey();
  if (!apiKey) throw new Error("No Gemini API key configured.");

  googleClient ??= new GoogleGenAI({ apiKey });
  const response = await googleClient.models.embedContent({
    model: GOOGLE_EMBEDDING_MODEL,
    contents: text,
  });

  const values = response.embeddings?.[0]?.values;
  if (!values || values.length === 0) {
    throw new Error("Gemini returned an empty embedding.");
  }
  return values;
}

/** Embed text, returning which backend produced the vector. */
async function embedWithModel(
  text: string,
): Promise<{ vector: number[]; embeddingModel: string }> {
  const trimmed = text.trim();
  if (!trimmed) return { vector: localEmbedding(""), embeddingModel: LOCAL_MODEL };

  const cacheKey = `${trimmed.length}:${hashToken(trimmed)}`;
  if (embeddingCache.has(cacheKey)) {
    const cached = embeddingCache.get(cacheKey);
    if (cached) return { vector: cached, embeddingModel: LOCAL_MODEL };
  }

  if (googleApiKey()) {
    try {
      return {
        vector: await googleEmbedding(trimmed),
        embeddingModel: GOOGLE_EMBEDDING_MODEL,
      };
    } catch (error) {
      console.warn(
        `[ragEngine] Gemini embedding unavailable, using local vectors: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }

  const vector = localEmbedding(trimmed);
  if (embeddingCache.size >= EMBEDDING_CACHE_LIMIT) {
    const oldest = embeddingCache.keys().next().value;
    if (oldest !== undefined) embeddingCache.delete(oldest);
  }
  embeddingCache.set(cacheKey, vector);

  return { vector, embeddingModel: LOCAL_MODEL };
}

/** Generate a vector embedding for arbitrary text. */
export async function embedText(text: string): Promise<number[]> {
  const { vector } = await embedWithModel(text);
  return vector;
}

/* -------------------------------------------------------------------------- */
/* Persistence                                                                */
/* -------------------------------------------------------------------------- */

function emptyStore(): RagStore {
  return { schemaVersion: SCHEMA_VERSION, documents: [], chunks: [] };
}

let cache: RagStore | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();

async function readStoreFromDisk(): Promise<RagStore> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<RagStore>;
    if (!parsed || !Array.isArray(parsed.chunks) || !Array.isArray(parsed.documents)) {
      throw new Error("rag-store.json has an unexpected shape.");
    }
    return {
      schemaVersion: parsed.schemaVersion ?? SCHEMA_VERSION,
      documents: parsed.documents,
      chunks: parsed.chunks,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
    throw error;
  }
}

async function getStore(): Promise<RagStore> {
  if (!cache) cache = await readStoreFromDisk();
  return cache;
}

async function writeStore(store: RagStore): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temporaryPath = `${STORE_PATH}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(store, null, 2), "utf8");
  await fs.rename(temporaryPath, STORE_PATH);
  cache = store;
}

/** Serialise mutations so two uploads cannot clobber each other. */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task, task);
  writeQueue = run.catch(() => undefined);
  return run;
}

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || `doc-${Date.now().toString(36)}`;
}

/* -------------------------------------------------------------------------- */
/* Seed corpus                                                                */
/* -------------------------------------------------------------------------- */

const SEED_DOCUMENTS: { title: string; version: string; text: string }[] = [
  {
    title: "Return & Refund Policy",
    version: "v1.2",
    text: `Customers may raise a return within 7 days of delivery for unused, unwashed items with original tags intact. Damaged, defective or wrong items must be reported within 48 hours of delivery with unboxing photos or a video; these qualify for a full refund including shipping. Approved refunds are credited to the original payment method within 5 to 7 working days, or to store credit within 24 hours if the customer prefers. Made-to-order, personalised and innerwear items are non-returnable unless they arrive damaged. Reverse pickup is free on serviceable pin codes. Where pickup is unavailable, customers may self-ship and upload the courier receipt for reimbursement up to ₹150. Refunds for cash-on-delivery orders are paid to the customer's UPI ID or bank account after manual verification. If an order is lost in transit, the customer can choose a replacement or a full refund, and no return shipment is required.`,
  },
  {
    title: "Shipping Timelines",
    version: "v1.2",
    text: `Metro pin codes are delivered in 2 to 4 working days, tier-2 cities in 3 to 6 working days, and North-East, Jammu and Kashmir, Himachal and island pin codes in 7 to 10 working days. Orders placed before 2 PM IST are dispatched the same working day. Orders placed on Sunday or a national holiday are dispatched on the next working day. Tracking links activate within 24 hours of dispatch and sometimes take up to 6 hours to refresh after a scan. Delayed shipments that run more than 48 hours past the promised date are eligible for a ₹100 shipping credit on request. We currently ship within India only; international shipping is not available. Delivery to Port Blair and other island pin codes depends on courier serviceability and can take up to 10 working days.`,
  },
  {
    title: "Warranty Terms",
    version: "v1.2",
    text: `Household and kitchen products carry a 6-month manufacturing warranty from the date of delivery, covering seams, joints, handles and structural defects. Brass and copper items naturally develop a patina over time; that is not a defect and is not covered. Silver-plated and oxidised jewellery has a 30-day plating warranty, after which re-polishing is chargeable at ₹199. Warranty claims need the order ID and a photo or short video of the issue. Replacements ship within 3 working days of approval. Accidental damage, misuse, dishwasher use on handwash-only items and normal wear are excluded. The warranty is non-transferable and applies only to the original purchaser with a valid order record.`,
  },
  {
    title: "UPI & Payment Failures",
    version: "v1.2",
    text: `If money was debited but the order was not confirmed, the amount is auto-reversed by the bank or UPI PSP within 48 hours. Customers should not retry the payment immediately. Share the 12-digit UPI reference number or a screenshot so support can reconcile it with the payment gateway ledger. Failed payments never create a duplicate order. Cash on delivery is unavailable on orders above ₹5,000 or on pin codes marked prepaid-only. Refunds to UPI land in 3 to 5 working days, card refunds in 5 to 7 working days, and netbanking refunds in 7 to 9 working days. GST invoices for business purchases can be requested within 30 days of delivery by writing to support with the order ID and GSTIN.`,
  },
];

let startupPromise: Promise<void> | null = null;

/** Seed the JSON store on first use and load it into memory. */
export function ensureRagStore(): Promise<void> {
  startupPromise ??= (async () => {
    const store = await getStore();
    if (store.chunks.length > 0) return;

    for (const doc of SEED_DOCUMENTS) {
      await ingestUnlocked(doc.title, doc.version, doc.text);
    }
  })();

  return startupPromise;
}

/* -------------------------------------------------------------------------- */
/* Ingest                                                                     */
/* -------------------------------------------------------------------------- */

async function ingestUnlocked(
  title: string,
  version: string,
  rawText: string,
): Promise<IngestResult> {
  const cleanTitle = title.trim();
  const cleanVersion = version.trim() || "v1.0";
  const body = rawText.trim();

  if (!cleanTitle) throw new Error("Document title is required.");
  if (!body) throw new Error("Document text is empty.");

  const docId = slugify(cleanTitle);
  const drafts = chunkText(body, {
    docId,
    title: cleanTitle,
    version: cleanVersion,
  });

  if (drafts.length === 0) {
    throw new Error("Document produced no chunks.");
  }

  const chunks: RagChunk[] = [];
  let embeddingModel = LOCAL_MODEL;

  for (const draft of drafts) {
    const embedded = await embedWithModel(draft.text);
    embeddingModel = embedded.embeddingModel;
    chunks.push({
      ...draft,
      embedding: embedded.vector,
      embeddingModel: embedded.embeddingModel,
      createdAt: new Date().toISOString(),
    });
  }

  const store = await getStore();
  const existingChunks = store.chunks.filter((chunk) => chunk.docId === docId);
  const remainingChunks = store.chunks.filter((chunk) => chunk.docId !== docId);

  const nextStore: RagStore = {
    schemaVersion: SCHEMA_VERSION,
    documents: [
      ...store.documents.filter((document) => document.docId !== docId),
      {
        docId,
        title: cleanTitle,
        version: cleanVersion,
        chunkCount: chunks.length,
        embeddingModel,
        updatedAt: new Date().toISOString(),
      },
    ],
    chunks: [...remainingChunks, ...chunks],
  };

  await writeStore(nextStore);

  return {
    docId,
    title: cleanTitle,
    version: cleanVersion,
    chunkCount: chunks.length,
    replacedChunks: existingChunks.length,
    embeddingModel,
    storePath: STORE_PATH,
  };
}

/**
 * Chunk, embed and persist a document. Re-ingesting the same title replaces all
 * of that document's older chunks (including a previous version).
 */
export async function ingestDocument(
  title: string,
  version: string,
  rawText: string,
): Promise<IngestResult> {
  await ensureRagStore();
  return enqueue(() => ingestUnlocked(title, version, rawText));
}

/** Read the persisted store (seeding it first if needed). */
export async function getRagStore(): Promise<RagStore> {
  await ensureRagStore();
  return getStore();
}

/* -------------------------------------------------------------------------- */
/* Retrieval                                                                  */
/* -------------------------------------------------------------------------- */

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }

  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Cosine over sparse token counts, used when vector spaces don't match. */
function lexicalSimilarity(
  queryTokens: string[],
  documentText: string,
): number {
  const documentTokens = tokenize(documentText);
  if (queryTokens.length === 0 || documentTokens.length === 0) return 0;

  const queryCounts = new Map<string, number>();
  for (const token of queryTokens) {
    queryCounts.set(token, (queryCounts.get(token) ?? 0) + 1);
  }
  const documentCounts = new Map<string, number>();
  for (const token of documentTokens) {
    documentCounts.set(token, (documentCounts.get(token) ?? 0) + 1);
  }

  let dot = 0;
  let normQuery = 0;
  let normDocument = 0;

  for (const [token, count] of queryCounts) {
    normQuery += count * count;
    const match = documentCounts.get(token);
    if (match) dot += count * match;
  }
  for (const count of documentCounts.values()) {
    normDocument += count * count;
  }

  if (!normQuery || !normDocument) return 0;
  return dot / (Math.sqrt(normQuery) * Math.sqrt(normDocument));
}

/**
 * Embed the query and rank every stored chunk by cosine similarity.
 * Chunks embedded with a different backend fall back to lexical similarity so
 * retrieval still returns results after a key is added or removed.
 */
export async function retrieveRelevantChunks(
  query: string,
  topK = 3,
): Promise<RetrievalResult> {
  const trimmed = query.trim();
  if (!trimmed) return { chunks: [], topScore: 0 };

  await ensureRagStore();
  const store = await getStore();
  if (store.chunks.length === 0) return { chunks: [], topScore: 0 };

  const { vector, embeddingModel } = await embedWithModel(trimmed);
  const queryTokens = tokenize(trimmed);

  const scored: RetrievedChunk[] = store.chunks.map((chunk) => {
    const comparable =
      chunk.embeddingModel === embeddingModel &&
      chunk.embedding.length === vector.length &&
      vector.length > 0;

    const rawScore = comparable
      ? cosineSimilarity(vector, chunk.embedding)
      : lexicalSimilarity(queryTokens, chunk.text);

    const { embedding: _embedding, ...rest } = chunk;
    return { ...rest, score: Number.isFinite(rawScore) ? rawScore : 0 };
  });

  scored.sort((a, b) => b.score - a.score);

  const limit = Math.max(1, Math.floor(Number.isFinite(topK) ? topK : 3));
  const chunks = scored.slice(0, limit);

  return {
    chunks,
    topScore: chunks[0]?.score ?? 0,
  };
}

// Seed on server startup (module evaluation), so the JSON database exists
// before the first query. Failures are logged, not thrown, to keep boot alive.
if (typeof window === "undefined") {
  void ensureRagStore().catch((error) => {
    console.error(
      "[ragEngine] Could not seed data/rag-store.json:",
      error instanceof Error ? error.message : error,
    );
  });
}
