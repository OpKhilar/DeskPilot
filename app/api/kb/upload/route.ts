import pdfParse from "pdf-parse";
import { getRagStore, ingestDocument } from "@/lib/ragEngine";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([".pdf", ".txt", ".md", ".csv"]);

interface ArticleInput {
  title: string;
  version: string;
  text: string;
}

function isFile(value: FormDataEntryValue | null): value is File {
  return typeof value === "object" && value !== null && "arrayBuffer" in value;
}

function getStringField(form: FormData, ...keys: string[]): string {
  for (const key of keys) {
    const value = form.get(key);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function invalidRequest(message: string, status = 400): Response {
  return Response.json({ success: false, error: message }, { status });
}

function articleFromJson(value: unknown): ArticleInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const title =
    typeof body.title === "string"
      ? body.title
      : typeof body.docTitle === "string"
        ? body.docTitle
        : "";
  const text =
    typeof body.text === "string"
      ? body.text
      : typeof body.article === "string"
        ? body.article
        : typeof body.content === "string"
          ? body.content
          : "";

  return {
    title: title.trim(),
    version: typeof body.version === "string" ? body.version.trim() : "v1.0",
    text,
  };
}

async function extractUpload(file: File): Promise<ArticleInput> {
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error("Unsupported file type. Upload a PDF, TXT, MD, or CSV file.");
  }
  if (file.size === 0) throw new Error("The uploaded file is empty.");
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("Upload exceeds the 10 MB limit.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const text =
    extension === ".pdf"
      ? (await pdfParse(buffer)).text
      : new TextDecoder("utf-8", { fatal: true }).decode(buffer);

  return {
    title: file.name.slice(0, -extension.length).trim(),
    version: "v1.0",
    text,
  };
}

export async function POST(request: Request): Promise<Response> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
    return invalidRequest("Upload exceeds the 10 MB limit.", 413);
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  let article: ArticleInput | null = null;

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const fileField = form.get("file");
      const fileEntry = isFile(fileField)
        ? fileField
        : [...form.values()].find((value): value is File => isFile(value)) ?? null;

      if (isFile(fileEntry)) {
        article = await extractUpload(fileEntry);
        article.title =
          getStringField(form, "title", "docTitle") || article.title;
        article.version = getStringField(form, "version") || article.version;
      } else {
        article = {
          title: getStringField(form, "title", "docTitle"),
          version: getStringField(form, "version") || "v1.0",
          text: getStringField(form, "text", "article", "content"),
        };
      }
    } else if (contentType.includes("application/json")) {
      article = articleFromJson(await request.json());
    } else if (
      contentType.startsWith("text/") ||
      contentType === "" ||
      contentType.includes("application/octet-stream")
    ) {
      const buffer = Buffer.from(await request.arrayBuffer());
      if (buffer.length > MAX_UPLOAD_BYTES) {
        return invalidRequest("Article exceeds the 10 MB limit.", 413);
      }
      article = {
        title: request.headers.get("x-document-title")?.trim() || "Uploaded article",
        version: request.headers.get("x-document-version")?.trim() || "v1.0",
        text: new TextDecoder("utf-8", { fatal: true }).decode(buffer),
      };
    } else {
      return invalidRequest(
        "Send multipart/form-data, application/json, or plain text.",
        415,
      );
    }

    if (!article) return invalidRequest("No file or article content was provided.");
    if (!article.title) return invalidRequest("A document title is required.");
    if (!article.text.trim()) {
      return invalidRequest("No text could be extracted from the upload.");
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The upload could not be read.";
    return invalidRequest(message, message.includes("10 MB") ? 413 : 400);
  }

  try {
    const result = await ingestDocument(
      article.title,
      article.version || "v1.0",
      article.text,
    );
    const store = await getRagStore();
    const sampleChunks = store.chunks
      .filter(
        (chunk) =>
          chunk.docId === result.docId && chunk.version === result.version,
      )
      .sort((a, b) => a.chunkIndex - b.chunkIndex)
      .slice(0, 3)
      .map((chunk) => chunk.text);

    return Response.json({
      success: true,
      docTitle: result.title,
      version: result.version,
      chunksCreated: result.chunkCount,
      sampleChunks,
    });
  } catch (error) {
    console.error("[kb/upload] Could not index uploaded document:", error);
    return Response.json(
      { success: false, error: "The document could not be indexed." },
      { status: 500 },
    );
  }
}
