"use client";

// Knowledge base workspace: company files can be uploaded and indexed into the
// RAG vector store, policy articles sit on the left and AI-detected gaps on the
// right. Editing an article bumps its minor version (v1.2 -> v1.3) and records a
// revision entry; publishing an article (or an article made from a gap) writes
// it straight into the vector store.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Clock,
  Database,
  History,
  Loader2,
  Pencil,
  Plus,
  Search,
  Sparkles,
  TrendingUp,
  UploadCloud,
  X,
} from "lucide-react";
import { useDeskStore } from "@/lib/store";
import type {
  KbCategory,
  KbDoc,
  KnowledgeGap,
  KnowledgeGapStatus,
} from "@/lib/types";

/** Revision log kept beside the store so it survives a reload with the doc. */
const HISTORY_STORAGE_KEY = "deskpilot:kb-history:v1";

const CATEGORIES: KbCategory[] = ["Returns", "Shipping", "Warranty", "Payments"];

const ACCEPTED_FILES = ".pdf,.txt,.md,.csv";
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

const updatedFmt = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const seenFmt = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
});

const gapStatusMeta: Record<
  KnowledgeGapStatus,
  { label: string; className: string }
> = {
  open: { label: "Open", className: "bg-brand-500 text-cream-50" },
  in_review: {
    label: "In review",
    className: "bg-cream-200 text-charcoal-900",
  },
  resolved: {
    label: "Resolved",
    className:
      "bg-charcoal-700 text-ash-400 ring-1 ring-inset ring-charcoal-600",
  },
};

const gapStatusRank: Record<KnowledgeGapStatus, number> = {
  open: 0,
  in_review: 1,
  resolved: 2,
};

const categoryHints: Array<{ category: KbCategory; pattern: RegExp }> = [
  {
    category: "Shipping",
    pattern:
      /\b(deliver\w*|ship\w*|pin ?code\w*|pincode\w*|courier|tracking|awb|port blair|serviceable)\b/i,
  },
  {
    category: "Payments",
    pattern: /\b(upi|cod|payment\w*|paid|gst|invoice\w*|billing|card|netbanking|debited)\b/i,
  },
  {
    category: "Warranty",
    pattern: /\b(warranty|guarantee|plating|defect\w*|repair|patina)\b/i,
  },
  {
    category: "Returns",
    pattern: /\b(return\w*|exchange|replace\w*|pickup|refund\w*)\b/i,
  },
];

interface VersionEntry {
  id: string;
  /** Version after saving, e.g. "v1.3". */
  version: string;
  /** Version the article replaced; null for the initial revision. */
  previousVersion: string | null;
  note: string;
  savedAt: string;
}

interface Draft {
  mode: "new" | "edit";
  /** Remount key so the modal form resets between openings. */
  key: string;
  docId?: string;
  gapId?: string;
  title: string;
  category: KbCategory;
  content: string;
}

/** Shapes returned by /api/kb/upload and /api/kb/index. */
interface RagChunkView {
  id: string;
  docId: string;
  index: number;
  start: number;
  end: number;
  chars: number;
  overlapsNext: number;
  text: string;
  vector: { dim: number; status: string; norm: number; preview: string };
}

interface IndexedDocView {
  id: string;
  title: string;
  source: string;
  chars: number;
  chunkCount: number;
  avgChunkChars: number;
  indexedAt: string;
}

interface IndexResponse {
  ok: true;
  doc: IndexedDocView;
  chunks: RagChunkView[];
  text?: string;
  truncated?: boolean;
}

interface UploadState {
  status: "uploading" | "done" | "error";
  fileName: string;
  chunkCount?: number;
  chars?: number;
  message?: string;
}

function bumpMinorVersion(version: string): string {
  const match = /^v?(\d+)\.(\d+)$/i.exec(version.trim());
  if (!match) return "v1.1";
  return `v${match[1]}.${Number(match[2]) + 1}`;
}

function makeDocId(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `kb-${slug || "article"}-${Math.random().toString(36).slice(2, 6)}`;
}

function makeEntryId(): string {
  return `ver-${Math.random().toString(36).slice(2, 10)}`;
}

function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  if (!base) return "Uploaded document";
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isSupportedFileName(fileName: string): boolean {
  return /\.(pdf|txt|md|csv)$/i.test(fileName);
}

function guessCategoryFromText(text: string): KbCategory {
  const hint = categoryHints.find(({ pattern }) => pattern.test(text));
  return hint?.category ?? "Returns";
}

export default function KnowledgeBaseView() {
  const {
    kbDocs,
    knowledgeGaps,
    addKbDoc,
    updateKbDoc,
    updateKnowledgeGap,
    setKnowledgeGapStatus,
  } = useDeskStore();

  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, VersionEntry[]>>({});
  const [historyLoaded, setHistoryLoaded] = useState(false);

  // RAG indexing state.
  const [dragActive, setDragActive] = useState(false);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [chunksByDoc, setChunksByDoc] = useState<Record<string, IndexResponse>>({});
  const [openChunksId, setOpenChunksId] = useState<string | null>(null);
  const [chunkLoadingId, setChunkLoadingId] = useState<string | null>(null);
  const [chunkErrors, setChunkErrors] = useState<Record<string, string>>({});

  // Revision history is tied to persisted documents, so it is persisted too.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          setHistory(parsed as Record<string, VersionEntry[]>);
        }
      }
    } catch {
      // Corrupt payload: start from an empty log.
    }
    setHistoryLoaded(true);
  }, []);

  useEffect(() => {
    if (!historyLoaded) return;
    try {
      window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
    } catch {
      // Ignore quota / disabled storage.
    }
  }, [history, historyLoaded]);

  // Auto-dismiss the save confirmation.
  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 4500);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const logVersion = useCallback((docId: string, entry: VersionEntry) => {
    setHistory((prev) => ({ ...prev, [docId]: [entry, ...(prev[docId] ?? [])] }));
  }, []);

  const filteredDocs = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const docs = needle
      ? kbDocs.filter((doc) =>
          [doc.title, doc.content, doc.category, doc.version]
            .join(" ")
            .toLowerCase()
            .includes(needle),
        )
      : kbDocs;
    return [...docs].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }, [kbDocs, query]);

  const sortedGaps = useMemo(
    () =>
      [...knowledgeGaps].sort(
        (a, b) =>
          gapStatusRank[a.status] - gapStatusRank[b.status] ||
          b.frequency - a.frequency,
      ),
    [knowledgeGaps],
  );

  const openGapCount = knowledgeGaps.filter((gap) => gap.status !== "resolved").length;

  const totalCitations = kbDocs.reduce((sum, doc) => sum + doc.citationCount, 0);

  const indexedDocCount = Object.keys(chunksByDoc).length;

  function guessCategory(gap: KnowledgeGap): KbCategory {
    const suggested = kbDocs.find(
      (doc) => doc.id === gap.suggestedKbDocId,
    )?.category;
    if (suggested) return suggested;
    return guessCategoryFromText(gap.query);
  }

  /** POST a policy article to the vector store and cache its chunks. */
  const indexArticle = useCallback(
    async (docId: string, title: string, content: string): Promise<IndexResponse | null> => {
      try {
        const response = await fetch("/api/kb/index", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docId, title, content }),
        });
        const data = (await response.json().catch(() => null)) as
          | (IndexResponse | { message?: string })
          | null;

        if (!response.ok || !data || !("ok" in data) || !data.ok) {
          const message =
            data && "message" in data && data.message
              ? data.message
              : "The RAG index rejected this article.";
          setChunkErrors((prev) => ({ ...prev, [docId]: message }));
          return null;
        }

        setChunksByDoc((prev) => ({ ...prev, [docId]: data }));
        setChunkErrors((prev) => {
          const next = { ...prev };
          delete next[docId];
          return next;
        });
        return data;
      } catch {
        setChunkErrors((prev) => ({
          ...prev,
          [docId]: "Could not reach /api/kb/index.",
        }));
        return null;
      }
    },
    [],
  );

  /** Upload a company file, index it, and add it to the knowledge base. */
  const uploadFile = useCallback(
    async (file: File) => {
      if (!isSupportedFileName(file.name)) {
        setUpload({
          status: "error",
          fileName: file.name,
          message: "Only .PDF, .TXT, .MD and .CSV files can be indexed.",
        });
        return;
      }

      if (file.size > MAX_UPLOAD_BYTES) {
        setUpload({
          status: "error",
          fileName: file.name,
          message: `${formatBytes(file.size)} exceeds the 2 MB limit.`,
        });
        return;
      }

      const title = titleFromFileName(file.name);
      const docId = makeDocId(title);
      setUpload({ status: "uploading", fileName: file.name });

      try {
        const body = new FormData();
        body.append("file", file);
        body.append("docId", docId);
        body.append("title", title);

        const response = await fetch("/api/kb/upload", { method: "POST", body });
        const data = (await response.json().catch(() => null)) as
          | (IndexResponse | { message?: string })
          | null;

        if (!response.ok || !data || !("ok" in data) || !data.ok) {
          const message =
            data && "message" in data && data.message
              ? data.message
              : "Indexing failed.";
          setUpload({ status: "error", fileName: file.name, message });
          return;
        }

        const text = data.text ?? "";
        addKbDoc({
          id: docId,
          title,
          version: "v1.0",
          content: text,
          category: guessCategoryFromText(`${title} ${text}`),
          updatedAt: new Date().toISOString(),
          citationCount: 0,
        });
        logVersion(docId, {
          id: makeEntryId(),
          version: "v1.0",
          previousVersion: null,
          note: `Imported from ${file.name} · ${data.doc.chunkCount} chunks indexed${
            data.truncated ? " (text truncated in the editor)" : ""
          }`,
          savedAt: new Date().toISOString(),
        });

        setChunksByDoc((prev) => ({ ...prev, [docId]: data }));
        setOpenChunksId(docId);
        setUpload({
          status: "done",
          fileName: file.name,
          chunkCount: data.doc.chunkCount,
          chars: data.doc.chars,
        });
      } catch {
        setUpload({
          status: "error",
          fileName: file.name,
          message: "Could not reach /api/kb/upload — is the dev server running?",
        });
      }
    },
    [addKbDoc, logVersion],
  );

  /** Show the stored chunks, indexing the article first if needed. */
  async function toggleChunks(doc: KbDoc) {
    if (openChunksId === doc.id) {
      setOpenChunksId(null);
      return;
    }

    setOpenChunksId(doc.id);
    if (chunksByDoc[doc.id]) return;

    setChunkLoadingId(doc.id);
    await indexArticle(doc.id, doc.title, doc.content);
    setChunkLoadingId(null);
  }

  function openNewArticle() {
    setDraft({
      mode: "new",
      key: `new-${Date.now()}`,
      title: "",
      category: "Returns",
      content: "",
    });
  }

  function openEdit(doc: KbDoc) {
    setDraft({
      mode: "edit",
      key: `edit-${doc.id}-${Date.now()}`,
      docId: doc.id,
      title: doc.title,
      category: doc.category,
      content: doc.content,
    });
  }

  function openFromGap(gap: KnowledgeGap) {
    setDraft({
      mode: "new",
      key: `gap-${gap.id}-${Date.now()}`,
      gapId: gap.id,
      title: gap.query,
      category: guessCategory(gap),
      content: "",
    });
  }

  async function handleSave(values: {
    title: string;
    category: KbCategory;
    content: string;
  }): Promise<void> {
    if (!draft) return;
    const title = values.title.trim();
    const content = values.content.trim();
    const savedAt = new Date().toISOString();

    if (draft.mode === "edit" && draft.docId) {
      const doc = kbDocs.find((item) => item.id === draft.docId);
      if (!doc) {
        setDraft(null);
        return;
      }
      const nextVersion = bumpMinorVersion(doc.version);

      updateKbDoc(doc.id, {
        title,
        category: values.category,
        content,
        version: nextVersion,
        updatedAt: savedAt,
      });
      logVersion(doc.id, {
        id: makeEntryId(),
        version: nextVersion,
        previousVersion: doc.version,
        note: `Policy text revised · ${content.length} characters`,
        savedAt,
      });

      const indexed = await indexArticle(doc.id, title, content);
      setExpandedId(doc.id);
      setFlash(
        indexed
          ? `${title} saved as ${nextVersion} — re-indexed ${indexed.doc.chunkCount} chunks.`
          : `${title} saved as ${nextVersion} — vector re-index failed.`,
      );
      setDraft(null);
      return;
    }

    const docId = makeDocId(title);
    const doc: KbDoc = {
      id: docId,
      title,
      version: "v1.0",
      content,
      category: values.category,
      updatedAt: savedAt,
      citationCount: 0,
    };

    addKbDoc(doc);
    logVersion(docId, {
      id: makeEntryId(),
      version: doc.version,
      previousVersion: null,
      note: draft.gapId
        ? "Created from an AI-detected knowledge gap"
        : "Article created",
      savedAt,
    });

    const indexed = await indexArticle(docId, title, content);
    setOpenChunksId(docId);

    if (draft.gapId) {
      setKnowledgeGapStatus(draft.gapId, "resolved");
      updateKnowledgeGap(draft.gapId, {
        resolutionNote: indexed
          ? `Resolved by “${title}” (${doc.version}) · ${indexed.doc.chunkCount} chunks indexed in the RAG vector DB`
          : `Resolved by “${title}” (${doc.version})`,
        suggestedKbDocId: docId,
      });
      setFlash(
        indexed
          ? `“${title}” indexed as ${indexed.doc.chunkCount} chunks · knowledge gap RESOLVED.`
          : `“${title}” published · knowledge gap RESOLVED (vector index failed).`,
      );
    } else {
      setFlash(
        indexed
          ? `“${title}” created at v1.0 · ${indexed.doc.chunkCount} chunks indexed.`
          : `“${title}” created at v1.0 — vector indexing failed.`,
      );
    }

    setDraft(null);
  }

  const draftGap = draft?.gapId
    ? knowledgeGaps.find((gap) => gap.id === draft.gapId)
    : undefined;
  const draftDoc = draft?.docId
    ? kbDocs.find((doc) => doc.id === draft.docId)
    : undefined;

  return (
    <div className="w-full">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-500 text-cream-100 shadow-glow">
            <BookOpen className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-cream-50">
              Knowledge base
            </h1>
            <p className="text-sm text-ash-400">
              {kbDocs.length} policies · {totalCitations} citations ·{" "}
              {openGapCount} open gaps · {indexedDocCount} in the RAG index
            </p>
          </div>
        </div>
        <span className="pill self-start bg-charcoal-800 text-ash-300 ring-1 ring-inset ring-charcoal-600">
          <Database className="h-3 w-3 text-brand-300" />
          RAG vector DB
        </span>
      </header>

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,65fr)_minmax(0,35fr)]">
        {/* ---------------------------- Left: documents --------------------------- */}
        <section className="min-w-0">
          {/* ------------------------------ Upload -------------------------------- */}
          <label
            htmlFor="kb-file-input"
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              setDragActive(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              const file = event.dataTransfer.files?.[0];
              if (file) void uploadFile(file);
            }}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl2 border border-dashed px-4 py-5 text-center transition ${
              dragActive
                ? "border-brand-400 bg-brand-900/40"
                : "border-charcoal-600 bg-charcoal-850/80 hover:border-brand-400/70"
            }`}
          >
            <input
              id="kb-file-input"
              type="file"
              accept={ACCEPTED_FILES}
              className="sr-only"
              disabled={upload?.status === "uploading"}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void uploadFile(file);
              }}
            />
            {upload?.status === "uploading" ? (
              <Loader2 className="h-6 w-6 animate-spin text-brand-300" />
            ) : (
              <UploadCloud className="h-6 w-6 text-brand-300" />
            )}
            <p className="mt-2 text-xs font-medium text-cream-100">
              {dragActive
                ? "Drop to index into the RAG vector DB"
                : "Drag & drop a company file, or click to browse"}
            </p>
            <p className="mt-1 text-[10px] uppercase tracking-wider text-ash-400">
              .PDF · .TXT · .MD · .CSV — up to 2 MB
            </p>
          </label>

          {/* --------------------------- Indexing toast --------------------------- */}
          {upload ? (
            <div
              role="status"
              aria-live="polite"
              className={`mt-3 flex items-start gap-2.5 rounded-xl border px-3 py-2.5 ${
                upload.status === "error"
                  ? "border-charcoal-600 bg-charcoal-800/90"
                  : "border-brand-400/40 bg-brand-900/40"
              }`}
            >
              <span className="mt-0.5 shrink-0">
                {upload.status === "uploading" ? (
                  <Loader2 className="h-4 w-4 animate-spin text-brand-300" />
                ) : upload.status === "done" ? (
                  <Database className="h-4 w-4 text-cream-200" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-brand-300" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold text-cream-50">
                  {upload.status === "uploading"
                    ? `Indexing ${upload.fileName}…`
                    : upload.status === "done"
                      ? `Indexed ${upload.chunkCount} chunks into RAG Vector DB`
                      : `Could not index ${upload.fileName}`}
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-ash-300">
                  {upload.status === "done"
                    ? `${upload.fileName} · ${upload.chars?.toLocaleString("en-IN")} characters · 500-char windows with 100-char overlap`
                    : upload.status === "error"
                      ? upload.message
                      : "Extracting text, splitting into overlapping chunks and writing vectors…"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setUpload(null)}
                aria-label="Dismiss indexing message"
                className="focus-ring shrink-0 rounded-full text-ash-300 transition hover:text-cream-50"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}

          <div className="mt-4">
            <PanelHeading
              icon={BookOpen}
              title="Knowledge base documents"
              meta={`${filteredDocs.length} of ${kbDocs.length}`}
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ash-400" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by title, policy text or category…"
                aria-label="Search knowledge base articles"
                className="focus-ring w-full rounded-xl border border-charcoal-600 bg-charcoal-900/80 py-2 pl-9 pr-3 text-sm text-cream-100 placeholder:text-ash-400/70"
              />
            </div>
            <button
              type="button"
              onClick={openNewArticle}
              className="focus-ring inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-500 px-3.5 py-2 text-xs font-semibold text-cream-50 transition hover:bg-brand-600"
            >
              <Plus className="h-3.5 w-3.5" />
              New Article
            </button>
          </div>

          {flash ? (
            <div
              role="status"
              className="mt-3 flex items-start gap-2 rounded-xl border border-brand-400/40 bg-brand-900/40 px-3 py-2 text-[11px] text-cream-100"
            >
              <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-cream-200" />
              <span className="flex-1">{flash}</span>
              <button
                type="button"
                onClick={() => setFlash(null)}
                aria-label="Dismiss message"
                className="focus-ring rounded-full text-ash-300 transition hover:text-cream-50"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : null}

          <div className="mt-3 space-y-3">
            {filteredDocs.map((doc) => {
              const isOpen = expandedId === doc.id;
              const entries = history[doc.id] ?? [];
              const chunksOpen = openChunksId === doc.id;
              const indexed = chunksByDoc[doc.id];
              const chunkError = chunkErrors[doc.id];

              return (
                <article
                  key={doc.id}
                  className="panel p-4 transition hover:border-brand-400/60"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-cream-50">
                        {doc.title}
                      </h3>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <span className="pill bg-cream-200 font-mono text-charcoal-900">
                          {doc.version}
                        </span>
                        <span className="pill bg-charcoal-700/70 text-ash-300 ring-1 ring-inset ring-charcoal-600">
                          {doc.category}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[11px] text-ash-400">
                          <BookOpen className="h-3 w-3" />
                          {doc.citationCount} citation
                          {doc.citationCount === 1 ? "" : "s"}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[11px] text-ash-400">
                          <Clock className="h-3 w-3" />
                          Updated {updatedFmt.format(new Date(doc.updatedAt))}
                        </span>
                        {indexed ? (
                          <span className="pill bg-brand-500/15 font-mono text-brand-200 ring-1 ring-inset ring-brand-400/40">
                            {indexed.doc.chunkCount} vectors
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => openEdit(doc)}
                      className="focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-full border border-charcoal-600 bg-charcoal-800 px-3 py-1.5 text-[11px] font-medium text-cream-100 transition hover:border-brand-400 hover:text-cream-50"
                    >
                      <Pencil className="h-3 w-3" />
                      Edit
                    </button>
                  </div>

                  <p className="mt-3 line-clamp-3 text-xs leading-relaxed text-cream-100/85">
                    {doc.content}
                  </p>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-charcoal-700/70 pt-2.5">
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setExpandedId(isOpen ? null : doc.id)}
                        aria-expanded={isOpen}
                        className="focus-ring inline-flex items-center gap-1.5 rounded-full text-[11px] font-medium text-ash-300 transition hover:text-cream-100"
                      >
                        <History className="h-3 w-3" />
                        Version history
                        {entries.length > 0 ? ` (${entries.length})` : ""}
                        <ChevronDown
                          className={`h-3 w-3 transition-transform ${isOpen ? "rotate-180" : ""}`}
                        />
                      </button>

                      <button
                        type="button"
                        onClick={() => void toggleChunks(doc)}
                        aria-expanded={chunksOpen}
                        className={`focus-ring inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                          chunksOpen
                            ? "border-brand-400 bg-brand-900/40 text-cream-50"
                            : "border-charcoal-600 text-ash-300 hover:border-brand-400 hover:text-cream-100"
                        }`}
                      >
                        {chunkLoadingId === doc.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Database className="h-3 w-3" />
                        )}
                        View Indexed Chunks
                        {indexed ? ` (${indexed.doc.chunkCount})` : ""}
                        <ChevronDown
                          className={`h-3 w-3 transition-transform ${chunksOpen ? "rotate-180" : ""}`}
                        />
                      </button>
                    </div>

                    <span className="font-mono text-[10px] uppercase tracking-wider text-ash-400">
                      {doc.id}
                    </span>
                  </div>

                  {isOpen ? (
                    entries.length > 0 ? (
                      <ol className="mt-2.5 space-y-2 border-l border-charcoal-600 pl-3">
                        {entries.map((entry) => (
                          <li key={entry.id} className="text-[11px] text-ash-300">
                            <span className="font-mono text-cream-200">
                              {entry.version}
                            </span>
                            {entry.previousVersion ? (
                              <span className="text-ash-400">
                                {" "}
                                ← {entry.previousVersion}
                              </span>
                            ) : (
                              <span className="text-ash-400"> · initial revision</span>
                            )}
                            <span className="text-ash-400">
                              {" "}
                              · {updatedFmt.format(new Date(entry.savedAt))}
                            </span>
                            <span className="mt-0.5 block text-ash-400/80">
                              {entry.note}
                            </span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="mt-2.5 text-[11px] text-ash-400">
                        No revisions logged yet. Editing this article saves{" "}
                        {bumpMinorVersion(doc.version)} and records an entry here.
                      </p>
                    )
                  ) : null}

                  {chunksOpen ? (
                    <div className="mt-2.5 rounded-xl border border-charcoal-700 bg-charcoal-900/60 p-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-ash-300">
                          <Database className="h-3 w-3 text-brand-300" />
                          RAG vector store
                        </span>
                        <span className="font-mono text-[10px] text-ash-400">
                          {indexed
                            ? `${indexed.doc.chunkCount} chunks · ${indexed.doc.chars.toLocaleString("en-IN")} chars · ${indexed.doc.avgChunkChars} avg`
                            : chunkLoadingId === doc.id
                              ? "chunking…"
                              : "not indexed yet"}
                        </span>
                      </div>

                      {indexed ? (
                        <>
                          <p className="mt-1 text-[10px] text-ash-400">
                            500-character windows · 100-character overlap ·{" "}
                            {indexed.doc.source === "upload"
                              ? "company file upload"
                              : "policy article"}{" "}
                            · indexed {updatedFmt.format(new Date(indexed.doc.indexedAt))}
                          </p>
                          <ol className="mt-2 space-y-2">
                            {indexed.chunks.map((chunk) => (
                              <li
                                key={chunk.id}
                                className="rounded-lg border border-charcoal-700 bg-charcoal-900/80 p-2.5"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-1.5">
                                  <span className="font-mono text-[10px] text-cream-200">
                                    chunk #{chunk.index + 1}
                                  </span>
                                  <span className="text-[10px] text-ash-400">
                                    {chunk.chars} chars · offsets {chunk.start}–
                                    {chunk.end}
                                  </span>
                                  <span className="pill bg-brand-500/15 text-[10px] text-brand-200 ring-1 ring-inset ring-brand-400/40">
                                    <CheckCircle2 className="h-2.5 w-2.5" />
                                    {chunk.vector.status} · {chunk.vector.dim}-d
                                  </span>
                                </div>
                                <p className="mt-1.5 max-h-28 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-cream-100/85">
                                  {chunk.text}
                                </p>
                                <p className="mt-1 font-mono text-[10px] text-ash-400">
                                  vector[{chunk.vector.preview} …] · norm{" "}
                                  {chunk.vector.norm}
                                  {chunk.overlapsNext > 0
                                    ? ` · overlaps next by ${chunk.overlapsNext} chars`
                                    : " · final chunk"}
                                </p>
                              </li>
                            ))}
                          </ol>
                        </>
                      ) : null}

                      {chunkLoadingId === doc.id ? (
                        <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-ash-300">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Splitting into 500-character chunks and writing vectors…
                        </p>
                      ) : null}

                      {chunkError && chunkLoadingId !== doc.id ? (
                        <p className="mt-2 text-[11px] leading-relaxed text-brand-200">
                          {chunkError} Use “Edit” to save, then try again.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}

            {filteredDocs.length === 0 ? (
              <p className="panel px-4 py-8 text-center text-xs text-ash-400">
                No articles match “{query.trim()}”. Create one from scratch, from a
                knowledge gap, or upload a company file.
              </p>
            ) : null}
          </div>
        </section>

        {/* ------------------------------ Right: gaps ----------------------------- */}
        <aside className="min-w-0">
          <PanelHeading
            icon={AlertTriangle}
            title="AI-detected knowledge gaps"
            meta={`${openGapCount} unanswered`}
          />

          <div className="space-y-2.5">
            {sortedGaps.map((gap) => {
              const meta = gapStatusMeta[gap.status];
              const isResolved = gap.status === "resolved";

              return (
                <article
                  key={gap.id}
                  className={`panel p-3.5 ${isResolved ? "opacity-70" : ""}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs leading-relaxed text-cream-100">
                      “{gap.query}”
                    </p>
                    <span className="pill shrink-0 bg-brand-500/15 text-brand-200 ring-1 ring-inset ring-brand-400/40">
                      <TrendingUp className="h-3 w-3" />
                      {gap.frequency}×
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className={`pill ${meta.className}`}>{meta.label}</span>
                    <span className="text-[11px] text-ash-400">
                      {gap.channel} · last {seenFmt.format(new Date(gap.lastSeenAt))}
                    </span>
                  </div>

                  {gap.resolutionNote ? (
                    <p className="mt-2 text-[11px] leading-relaxed text-ash-400">
                      {gap.resolutionNote}
                    </p>
                  ) : null}

                  {isResolved ? (
                    <p className="mt-2.5 inline-flex items-center gap-1.5 text-[11px] font-medium text-cream-200">
                      <CheckCircle2 className="h-3 w-3" />
                      Article published — gap resolved
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openFromGap(gap)}
                      className="focus-ring mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-charcoal-600 bg-charcoal-800 px-3 py-1.5 text-[11px] font-medium text-cream-100 transition hover:border-brand-400 hover:text-cream-50"
                    >
                      <ArrowRight className="h-3 w-3" />
                      Create Article from Gap
                    </button>
                  )}
                </article>
              );
            })}

            {sortedGaps.length === 0 ? (
              <p className="panel px-4 py-8 text-center text-xs text-ash-400">
                The AI has not logged any unanswered questions yet.
              </p>
            ) : null}
          </div>
        </aside>
      </div>

      {draft ? (
        <ArticleModal
          key={draft.key}
          mode={draft.mode}
          initial={{
            title: draft.title,
            category: draft.category,
            content: draft.content,
          }}
          gap={draftGap}
          versionHint={
            draft.mode === "edit"
              ? `${draftDoc?.version ?? "v1.0"} → ${bumpMinorVersion(
                  draftDoc?.version ?? "v1.0",
                )}`
              : "New articles start at v1.0"
          }
          onCancel={() => setDraft(null)}
          onSave={handleSave}
        />
      ) : null}
    </div>
  );
}

function PanelHeading({
  icon: Icon,
  title,
  meta,
}: {
  icon: typeof BookOpen;
  title: string;
  meta?: string;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-ash-300">
        <Icon className="h-3.5 w-3.5 text-brand-300" />
        {title}
      </h2>
      {meta ? <span className="text-[11px] text-ash-400">{meta}</span> : null}
    </div>
  );
}

function ArticleModal({
  mode,
  initial,
  gap,
  versionHint,
  onCancel,
  onSave,
}: {
  mode: "new" | "edit";
  initial: { title: string; category: KbCategory; content: string };
  gap?: KnowledgeGap;
  versionHint: string;
  onCancel: () => void;
  onSave: (values: {
    title: string;
    category: KbCategory;
    content: string;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState(initial.title);
  const [category, setCategory] = useState<KbCategory>(initial.category);
  const [content, setContent] = useState(initial.content);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onCancel();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, saving]);

  const canSave = title.trim().length > 0 && content.trim().length > 0 && !saving;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave({ title, category, content });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-charcoal-950/80 p-4 backdrop-blur-sm sm:items-center"
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="kb-article-modal-title"
        className="panel my-auto w-full max-w-2xl p-5 shadow-glow"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 text-cream-100">
              {mode === "edit" ? (
                <Pencil className="h-4 w-4" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
            </div>
            <div>
              <h2
                id="kb-article-modal-title"
                className="text-sm font-semibold text-cream-50"
              >
                {mode === "edit" ? "Edit article" : "New article"}
              </h2>
              <p className="text-[11px] text-ash-400">
                {gap
                  ? `Pre-filled from knowledge gap · asked ${gap.frequency}× on ${gap.channel}`
                  : versionHint}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            disabled={saving}
            className="focus-ring rounded-full border border-charcoal-600 bg-charcoal-800 p-1.5 text-ash-300 transition hover:text-cream-50 disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div>
            <label
              htmlFor="kb-article-title"
              className="text-[11px] font-medium uppercase tracking-wider text-ash-400"
            >
              Title
            </label>
            <input
              id="kb-article-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Cash on Delivery eligibility"
              autoFocus={!initial.title}
              className="focus-ring mt-1 w-full rounded-xl border border-charcoal-600 bg-charcoal-900 px-3 py-2 text-sm text-cream-100 placeholder:text-ash-400/70"
            />
          </div>

          <div>
            <label
              htmlFor="kb-article-category"
              className="text-[11px] font-medium uppercase tracking-wider text-ash-400"
            >
              Category
            </label>
            <select
              id="kb-article-category"
              value={category}
              onChange={(event) => setCategory(event.target.value as KbCategory)}
              className="focus-ring mt-1 w-full rounded-xl border border-charcoal-600 bg-charcoal-900 px-3 py-2 text-sm text-cream-100"
            >
              {CATEGORIES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="kb-article-content"
              className="text-[11px] font-medium uppercase tracking-wider text-ash-400"
            >
              Policy content
            </label>
            <textarea
              id="kb-article-content"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              rows={7}
              placeholder="Write the policy the AI should quote, in plain customer-facing language…"
              autoFocus={Boolean(initial.title)}
              className="focus-ring mt-1 w-full resize-y rounded-xl border border-charcoal-600 bg-charcoal-900 px-3 py-2 text-sm leading-relaxed text-cream-100 placeholder:text-ash-400/70"
            />
          </div>

          <div className="flex flex-col gap-2 border-t border-charcoal-700/70 pt-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] text-ash-400">
              {mode === "edit"
                ? `Saving bumps the minor version ${versionHint}, logs a history entry and re-indexes the article.`
                : gap
                  ? "Saving writes the policy into the RAG vector DB and marks this gap resolved."
                  : "Saving chunks the article into the RAG vector DB at v1.0."}
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onCancel}
                disabled={saving}
                className="focus-ring rounded-full border border-charcoal-600 px-3.5 py-2 text-xs font-medium text-cream-100 transition hover:border-brand-400 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSave}
                className="focus-ring inline-flex items-center gap-1.5 rounded-full bg-brand-500 px-3.5 py-2 text-xs font-semibold text-cream-50 transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                {saving
                  ? "Indexing…"
                  : mode === "edit"
                    ? "Save new version"
                    : "Publish article"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
