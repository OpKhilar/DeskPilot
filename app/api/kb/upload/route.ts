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
// Also accepts JSON or plain text bodies for compatibility with the main branch.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

declare const Buffer: {
  from(data: ArrayBuffer | Uint8Array | string): Uint8Array;
};

function fail(status: number, error: string, message: string): Response {
  return Response.json({ error, message }, { status });
}

function getStringField(form: FormData, ...keys: string[]): string {
  for (const key of keys) {
    const value = form.get(key);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function getJsonStringField(payload: unknown, ...keys: string[]): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "";
  }

  const body = payload as Record<string, unknown>;
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return "";
}

function getPayloadText(payload: unknown): string {
  if (typeof payload === "string") return payload.trim();
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "";
  }

  const body = payload as Record<string, unknown>;
  const candidate =
    typeof body.text === "string"
      ? body.text
      : typeof body.article === "string"
        ? body.article
        : typeof body.content === "string"
          ? body.content
          : "";

  return candidate.trim();
}

function toUploadResponse(document: ReturnType<typeof indexDocument>) {
  const sampleChunks = document.chunks.slice(0, 3).map((chunk) => chunk.text);
  return Response.json({
    ok: true,
    success: true,
    doc: summarize(document),
    title: document.title,
    docTitle: document.title,
    version: "v1.0",
    chunks: document.chunks,
    chunksCreated: document.chunkCount,
    sampleChunks,
    text: document.chunks.map((chunk) => chunk.text).join("\n\n").slice(0, MAX_TEXT_CHARS),
    truncated: document.chars > MAX_TEXT_CHARS,
  });
}

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");

      if (file instanceof File) {
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

        return toUploadResponse(document);
      }

      const text = getStringField(form, "text", "article", "content");
      const title = getStringField(form, "title", "docTitle") || "Uploaded article";
      const docId = getStringField(form, "docId") || toDocId(title);

      if (!text.trim()) {
        return fail(422, "EMPTY_CONTENT", "No text was provided to index.");
      }

      const document = indexDocument({
        id: docId,
        title,
        source: "article",
        text: text.slice(0, MAX_INDEX_CHARS),
      });

      return toUploadResponse(document);
    }

    if (contentType.includes("application/json")) {
      const payload = await request.json();
      const title =
        getJsonStringField(payload, "title", "docTitle") || "Uploaded article";
      const text = getPayloadText(payload);
      if (!text) {
        return fail(400, "INVALID_JSON", "Request body must include text or content.");
      }

      const docId =
        getJsonStringField(payload, "docId") || toDocId(title);

      const document = indexDocument({
        id: docId,
        title,
        source: "article",
        text: text.slice(0, MAX_INDEX_CHARS),
      });

      return toUploadResponse(document);
    }

    const raw = await request.text();
    if (!raw.trim()) {
      return fail(400, "EMPTY_CONTENT", "No text content was provided.");
    }

    const title = request.headers.get("x-document-title")?.trim() || "Uploaded article";
    const docId = request.headers.get("x-document-id")?.trim() || toDocId(title);
    const document = indexDocument({
      id: docId,
      title,
      source: "upload",
      text: raw.slice(0, MAX_INDEX_CHARS),
    });

    return toUploadResponse(document);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The upload could not be processed.";
    return fail(400, "UPLOAD_FAILED", message);
  }
}
