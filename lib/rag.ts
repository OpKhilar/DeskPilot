import { inflateSync } from "node:zlib";

// RAG indexing for company files and policies.
//
// Text is split into 500-character chunks that overlap by 100 characters, and
// each chunk gets a deterministic 64-dimension embedding. The index lives in a
// module-level map: it survives for the lifetime of the running server (which
// is all the demo needs) but not a restart, and it is not shared between
// separately deployed instances.

export const CHUNK_SIZE = 500;
export const CHUNK_OVERLAP = 100;
export const VECTOR_DIM = 64;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** Text beyond this is indexed in full but not echoed back to the browser. */
export const MAX_TEXT_CHARS = 20_000;
/** Hard ceiling on how much text one upload can index. */
export const MAX_INDEX_CHARS = 200_000;

export type RagSource = "upload" | "article";

export interface ChunkVector {
  dim: number;
  status: "indexed";
  /** Magnitude of the embedding before L2 normalisation. */
  norm: number;
  /** First few components, so the UI can show a real vector. */
  preview: string;
}

export interface RagChunk {
  id: string;
  docId: string;
  index: number;
  start: number;
  end: number;
  chars: number;
  /** Characters shared with the following chunk (0 for the last chunk). */
  overlapsNext: number;
  text: string;
  vector: ChunkVector;
}

export interface IndexedDocument {
  id: string;
  title: string;
  source: RagSource;
  chars: number;
  chunkCount: number;
  indexedAt: string;
  chunks: RagChunk[];
}

export interface IndexedDocumentSummary {
  id: string;
  title: string;
  source: RagSource;
  chars: number;
  chunkCount: number;
  avgChunkChars: number;
  indexedAt: string;
}

const VECTOR_DB = new Map<string, IndexedDocument>();

/* -------------------------------------------------------------------------- */
/* Text preparation                                                           */
/* -------------------------------------------------------------------------- */

export function normalizeText(input: string): string {
  return input
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function toDocId(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `kb-${slug || "uploaded-file"}-${Date.now().toString(36).slice(-4)}`;
}

/**
 * Split normalised text into overlapping windows. Windows prefer to end on a
 * word boundary, but never shrink below 60% of the configured size.
 */
export function chunkText(text: string): Array<{
  index: number;
  start: number;
  end: number;
  text: string;
  overlapsNext: number;
}> {
  const clean = normalizeText(text);
  if (!clean) return [];

  const windows: Array<{
    index: number;
    start: number;
    end: number;
    text: string;
    overlapsNext: number;
  }> = [];

  let start = 0;
  let index = 0;

  while (start < clean.length) {
    let end = Math.min(clean.length, start + CHUNK_SIZE);

    if (end < clean.length) {
      const boundary = clean.lastIndexOf(" ", end);
      if (boundary > start + Math.floor(CHUNK_SIZE * 0.6)) end = boundary;
    }

    const slice = clean.slice(start, end).trim();
    if (slice.length > 0) {
      windows.push({ index, start, end, text: slice, overlapsNext: 0 });
      index += 1;
    }

    if (end >= clean.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }

  for (let i = 0; i < windows.length - 1; i += 1) {
    windows[i].overlapsNext = Math.max(0, windows[i].end - windows[i + 1].start);
  }

  return windows;
}

/* -------------------------------------------------------------------------- */
/* Deterministic embeddings                                                   */
/* -------------------------------------------------------------------------- */

function hashToken(token: string): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * A stand-in for a real embedding model: tokens are hashed into 64 buckets with
 * a stable sign, then L2 normalised. Deterministic, so re-indexing the same text
 * produces the same vector.
 */
export function embedText(text: string): { vector: number[]; magnitude: number } {
  const vector = new Array<number>(VECTOR_DIM).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

  for (const token of tokens) {
    const hash = hashToken(token);
    const slot = hash % VECTOR_DIM;
    const sign = (hash >>> 16) % 2 === 0 ? 1 : -1;
    vector[slot] += sign * (1 + Math.min(token.length, 12) / 12);
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  const safeMagnitude = magnitude || 1;

  return {
    vector: vector.map((value) => Number((value / safeMagnitude).toFixed(4))),
    magnitude: Number(magnitude.toFixed(4)),
  };
}

/* -------------------------------------------------------------------------- */
/* Index                                                                      */
/* -------------------------------------------------------------------------- */

export function indexDocument(input: {
  id: string;
  title: string;
  source: RagSource;
  text: string;
}): IndexedDocument {
  const text = normalizeText(input.text);

  const chunks: RagChunk[] = chunkText(text).map((window) => {
    const { vector, magnitude } = embedText(window.text);

    return {
      id: `${input.id}::chunk-${window.index}`,
      docId: input.id,
      index: window.index,
      start: window.start,
      end: window.end,
      chars: window.text.length,
      overlapsNext: window.overlapsNext,
      text: window.text,
      vector: {
        dim: VECTOR_DIM,
        status: "indexed",
        norm: magnitude,
        preview: vector.slice(0, 4).map((value) => value.toFixed(3)).join(", "),
      },
    };
  });

  const document: IndexedDocument = {
    id: input.id,
    title: input.title,
    source: input.source,
    chars: text.length,
    chunkCount: chunks.length,
    indexedAt: new Date().toISOString(),
    chunks,
  };

  VECTOR_DB.set(document.id, document);
  return document;
}

export function getIndexedDocument(docId: string): IndexedDocument | undefined {
  return VECTOR_DB.get(docId);
}

export function listIndexedDocuments(): IndexedDocumentSummary[] {
  return [...VECTOR_DB.values()].map(summarize);
}

export function summarize(document: IndexedDocument): IndexedDocumentSummary {
  return {
    id: document.id,
    title: document.title,
    source: document.source,
    chars: document.chars,
    chunkCount: document.chunkCount,
    avgChunkChars:
      document.chunkCount > 0
        ? Math.round(
            document.chunks.reduce((sum, chunk) => sum + chunk.chars, 0) /
              document.chunkCount,
          )
        : 0,
    indexedAt: document.indexedAt,
  };
}

/* -------------------------------------------------------------------------- */
/* File extraction                                                            */
/* -------------------------------------------------------------------------- */

const TEXT_EXTENSIONS = new Set(["txt", "md", "markdown", "csv", "tsv", "log", "json"]);

export function fileExtension(fileName: string): string {
  return (fileName.split(".").pop() ?? "").toLowerCase();
}

export function isSupportedFile(fileName: string): boolean {
  const extension = fileExtension(fileName);
  return extension === "pdf" || TEXT_EXTENSIONS.has(extension);
}

function decodePdfString(raw: string): string {
  return raw.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_match, escape: string) => {
    if (/^[0-7]{1,3}$/.test(escape)) return String.fromCharCode(parseInt(escape, 8));
    switch (escape) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "b":
        return "\b";
      case "f":
        return "\f";
      default:
        return escape;
    }
  });
}

/** Pull the strings shown by text operators out of a PDF content stream. */
function pdfStreamText(content: string): string {
  const pieces: string[] = [];
  const blockRe = /BT([\s\S]*?)ET/g;
  let block: RegExpExecArray | null;

  while ((block = blockRe.exec(content)) !== null) {
    const inner = block[1];
    const stringRe = /\((?:\\.|[^\\()])*\)/g;
    let literal: RegExpExecArray | null;

    while ((literal = stringRe.exec(inner)) !== null) {
      pieces.push(decodePdfString(literal[0].slice(1, -1)));
    }
    pieces.push(" ");
  }

  return pieces.join(" ");
}

/**
 * Best-effort PDF text extraction with no external dependency: inflate each
 * stream with zlib, then read the literals inside BT/ET text blocks. Works for
 * most text-based PDFs; scanned PDFs contain no text and are reported as such.
 */
export function extractPdfText(bytes: Buffer): string {
  const latin = bytes.toString("latin1");
  const collected: string[] = [];
  const streamRe = /stream\r?\n?([\s\S]*?)endstream/g;
  let match: RegExpExecArray | null;

  while ((match = streamRe.exec(latin)) !== null) {
    const raw = Buffer.from(match[1], "latin1");
    let content: string;

    try {
      content = inflateSync(raw).toString("latin1");
    } catch {
      content = match[1];
    }

    if (content.includes("BT")) collected.push(pdfStreamText(content));
  }

  if (collected.length === 0) collected.push(pdfStreamText(latin));

  return normalizeText(collected.join(" ").replace(/\s+/g, " "));
}

export function extractDocumentText(
  fileName: string,
  bytes: Buffer,
): { text: string; kind: "text" | "pdf" } {
  const extension = fileExtension(fileName);

  if (extension === "pdf") {
    return { text: extractPdfText(bytes), kind: "pdf" };
  }

  if (TEXT_EXTENSIONS.has(extension)) {
    return { text: normalizeText(bytes.toString("utf8")), kind: "text" };
  }

  throw new Error(
    `Unsupported file type “.${extension || "unknown"}”. Upload a .PDF, .TXT, .MD or .CSV file.`,
  );
}
