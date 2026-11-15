import { indexDocument, summarize } from "@/lib/rag";

// POST /api/kb/index — index (or re-index) a policy article into the RAG store.
//
// Body: { docId, title, content }
//
// Used when a new article is published from a knowledge gap, when an edited
// article is saved, and to inspect the chunks of a seeded policy on demand.
// Indexing is an upsert: the same docId replaces its previous vectors.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { error: "INVALID_JSON", message: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return Response.json(
      { error: "INVALID_BODY", message: "Request body must be a JSON object." },
      { status: 400 },
    );
  }

  const body = payload as Record<string, unknown>;
  const docId = typeof body.docId === "string" ? body.docId.trim() : "";
  const content = typeof body.content === "string" ? body.content : "";
  const title =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim()
      : "Untitled policy";

  if (!docId) {
    return Response.json(
      { error: "MISSING_DOC_ID", message: "docId is required." },
      { status: 400 },
    );
  }

  if (content.trim().length < 24) {
    return Response.json(
      {
        error: "EMPTY_CONTENT",
        message: "Policy text is too short to chunk — add at least a sentence.",
      },
      { status: 422 },
    );
  }

  const document = indexDocument({
    id: docId,
    title,
    source: "article",
    text: content,
  });

  return Response.json({ ok: true, doc: summarize(document), chunks: document.chunks });
}
