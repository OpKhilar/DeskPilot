import {
  extractDocumentText,
  indexDocument,
  isSupportedFile,
  MAX_FILE_BYTES,
  MAX_INDEX_CHARS,
  MAX_TEXT_CHARS,
  summarize,
  toDocId,
} from "@/lib/rag";

// POST /api/kb/upload — index a company file into the RAG vector store.
//
// multipart/form-data:
//   file   — .PDF, .TXT, .MD or .CSV (max 2 MB)
//   docId  — optional knowledge base document id to index under
//   title  — optional display title (defaults to the file name)
//
// Responds with { ok, doc, chunks, text, truncated }. The chunks are the
// 500-character overlapping windows actually stored in the index.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(status: number, error: string, message: string): Response {
  return Response.json({ error, message }, { status });
}

export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(
      400,
      "INVALID_FORM",
      "Send the file as multipart/form-data with a 'file' field.",
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return fail(400, "MISSING_FILE", "Attach a file in the 'file' field.");
  }

  if (file.size === 0) {
    return fail(400, "EMPTY_FILE", `${file.name} is empty.`);
  }

  if (file.size > MAX_FILE_BYTES) {
    return fail(
      413,
      "FILE_TOO_LARGE",
      `${file.name} is ${(file.size / (1024 * 1024)).toFixed(1)} MB. The limit is 2 MB.`,
    );
  }

  if (!isSupportedFile(file.name)) {
    return fail(
      415,
      "UNSUPPORTED_FILE",
      `${file.name} is not supported. Upload a .PDF, .TXT, .MD or .CSV file.`,
    );
  }

  const docIdField = form.get("docId");
  const titleField = form.get("title");
  const docId =
    typeof docIdField === "string" && docIdField.trim()
      ? docIdField.trim()
      : toDocId(file.name);
  const title =
    typeof titleField === "string" && titleField.trim()
      ? titleField.trim()
      : file.name.replace(/\.[^.]+$/, "");

  const bytes = Buffer.from(await file.arrayBuffer());

  let extracted: { text: string; kind: "text" | "pdf" };
  try {
    extracted = extractDocumentText(file.name, bytes);
  } catch (error) {
    return fail(
      415,
      "UNSUPPORTED_FILE",
      error instanceof Error ? error.message : "Could not read that file.",
    );
  }

  const text = extracted.text.trim();
  if (text.length < 24) {
    return fail(
      422,
      "NO_TEXT",
      extracted.kind === "pdf"
        ? "No selectable text found in that PDF — it may be scanned. Upload a text-based PDF, or a .TXT/.MD/.CSV file."
        : "That file has almost no text to index.",
    );
  }

  const document = indexDocument({
    id: docId,
    title,
    source: "upload",
    text: text.slice(0, MAX_INDEX_CHARS),
  });

  return Response.json({
    ok: true,
    doc: summarize(document),
    chunks: document.chunks,
    text: text.slice(0, MAX_TEXT_CHARS),
    truncated: text.length > MAX_TEXT_CHARS,
  });
}
