"use client";

// Knowledge base workspace: policy articles on the left, AI-detected gaps on the
// right. Editing an article bumps its minor version (v1.2 -> v1.3) and records a
// revision entry, so versioning can be demonstrated live. A gap can spawn a new
// article, which resolves the gap in the store.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Clock,
  History,
  Pencil,
  Plus,
  Search,
  Sparkles,
  TrendingUp,
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

  function guessCategory(gap: KnowledgeGap): KbCategory {
    const suggested = kbDocs.find(
      (doc) => doc.id === gap.suggestedKbDocId,
    )?.category;
    if (suggested) return suggested;
    const hint = categoryHints.find(({ pattern }) => pattern.test(gap.query));
    return hint?.category ?? "Returns";
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

  function handleSave(values: { title: string; category: KbCategory; content: string }) {
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

      setExpandedId(doc.id);
      setFlash(`${title} saved as ${nextVersion} — version history logged.`);
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

    if (draft.gapId) {
      setKnowledgeGapStatus(draft.gapId, "resolved");
      updateKnowledgeGap(draft.gapId, {
        resolutionNote: `Resolved by “${title}” (${doc.version})`,
        suggestedKbDocId: docId,
      });
      setFlash(`“${title}” published · knowledge gap marked RESOLVED.`);
    } else {
      setFlash(`“${title}” created at v1.0.`);
    }

    setExpandedId(docId);
    setDraft(null);
  }

  const draftGap = draft?.gapId
    ? knowledgeGaps.find((gap) => gap.id === draft.gapId)
    : undefined;
  const draftDoc = draft?.docId
    ? kbDocs.find((doc) => doc.id === draft.docId)
    : undefined;

  return (
    <main className="mx-auto w-full max-w-7xl px-5 py-8 sm:px-8">
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
              {openGapCount} open gaps
            </p>
          </div>
        </div>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,65fr)_minmax(0,35fr)]">
        {/* ---------------------------- Left: documents --------------------------- */}
        <section className="min-w-0">
          <PanelHeading
            icon={BookOpen}
            title="Knowledge base documents"
            meta={`${filteredDocs.length} of ${kbDocs.length}`}
          />

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

                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-charcoal-700/70 pt-2.5">
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
                </article>
              );
            })}

            {filteredDocs.length === 0 ? (
              <p className="panel px-4 py-8 text-center text-xs text-ash-400">
                No articles match “{query.trim()}”. Create one from scratch or from a
                knowledge gap.
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
    </main>
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
  }) => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [category, setCategory] = useState<KbCategory>(initial.category);
  const [content, setContent] = useState(initial.content);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const canSave = title.trim().length > 0 && content.trim().length > 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave) return;
    onSave({ title, category, content });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-charcoal-950/80 p-4 backdrop-blur-sm sm:items-center"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
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
            className="focus-ring rounded-full border border-charcoal-600 bg-charcoal-800 p-1.5 text-ash-300 transition hover:text-cream-50"
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
                ? `Saving bumps the minor version ${versionHint} and logs a history entry.`
                : gap
                  ? "Saving publishes the article and marks this gap resolved."
                  : versionHint}
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="focus-ring rounded-full border border-charcoal-600 px-3.5 py-2 text-xs font-medium text-cream-100 transition hover:border-brand-400"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSave}
                className="focus-ring rounded-full bg-brand-500 px-3.5 py-2 text-xs font-semibold text-cream-50 transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {mode === "edit" ? "Save new version" : "Publish article"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
