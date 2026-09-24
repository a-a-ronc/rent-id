/**
 * Document file storage over the private Supabase `documents` bucket.
 *
 * Object paths are `<organization_id>/<uuid>-<safe file name>`. The storage
 * RLS policies (migration 20260903191108) scope reads/writes by that first
 * path segment: organization members can upload/delete under their own
 * organization, and a tenant can read an object only when a `documents` row
 * with that `storage_path` is `visible_to_tenant` on one of their tenancies.
 * Files are always served through short-lived signed URLs — the bucket is
 * never public.
 */
import { db } from "@/lib/db";
import type { UUID } from "@/lib/types";

export const DOCUMENTS_BUCKET = "documents";

/** 25 MB — larger uploads are refused client-side before any bytes move. */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/**
 * Accepted content types. The type comes from the browser's sniffed
 * `file.type`, never from the file extension the client chose.
 */
export const ALLOWED_DOCUMENT_MIME_TYPES: readonly string[] = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

/**
 * A `documents` row created without file bytes (older callers only send
 * metadata) carries this placeholder path. It never matches a storage object,
 * so signed-URL requests for it short-circuit to `null`.
 */
export const PENDING_UPLOAD_PREFIX = "pending-upload/";

export function isPlaceholderPath(storagePath: string | null | undefined): boolean {
  return !storagePath || storagePath.startsWith(PENDING_UPLOAD_PREFIX);
}

export function placeholderStoragePath(): string {
  return `${PENDING_UPLOAD_PREFIX}${crypto.randomUUID()}`;
}

export type UploadedDocumentFile = {
  /** Object key inside the `documents` bucket — store it as `documents.storage_path`. */
  path: string;
  /** Content type the object was stored with (from `file.type`). */
  mime: string;
  /** Size in bytes. */
  size: number;
};

/** Content type from the browser-sniffed file type; never from the file name. */
export function resolveMimeType(file: File | Blob): string {
  const type = (file.type || "").trim().toLowerCase();
  return type || "application/octet-stream";
}

/**
 * Turn a user-supplied file name into a single safe path segment: strips
 * directories, control and path characters, collapses whitespace and caps the
 * length while keeping the extension.
 */
export function safeFileName(name: string | null | undefined, fallback = "document"): string {
  const base = (name ?? "")
    .split(/[\\/]/)
    .pop()!
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"|?*%#]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  const cleaned = base || fallback;
  if (cleaned.length <= 120) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const ext = dot > 0 && cleaned.length - dot <= 12 ? cleaned.slice(dot) : "";
  return `${cleaned.slice(0, 120 - ext.length)}${ext}`;
}

function describeMime(mime: string): string {
  const known: Record<string, string> = {
    "application/pdf": "PDF",
    "image/png": "PNG",
    "image/jpeg": "JPEG",
    "image/jpg": "JPEG",
    "image/webp": "WebP",
    "image/heic": "HEIC",
    "image/heif": "HEIF",
    "application/msword": "Word (.doc)",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word (.docx)",
  };
  return known[mime] ?? mime;
}

/** Throws a user-facing Error when the file cannot be stored. */
export function validateDocumentFile(file: File | Blob): { mime: string; size: number } {
  const mime = resolveMimeType(file);
  const size = file.size;
  if (size <= 0) throw new Error("That file is empty.");
  if (size > MAX_DOCUMENT_BYTES) {
    throw new Error(`That file is ${(size / (1024 * 1024)).toFixed(1)} MB — the limit is 25 MB.`);
  }
  if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(mime)) {
    throw new Error(
      mime === "application/octet-stream"
        ? "We couldn't tell what kind of file that is. Upload a PDF, image (PNG, JPEG, WebP, HEIC) or Word document."
        : `${describeMime(mime)} files aren't supported. Upload a PDF, image (PNG, JPEG, WebP, HEIC) or Word document.`,
    );
  }
  return { mime, size };
}

function storageErrorMessage(error: { message: string }, fallback: string): string {
  const message = error.message || "";
  if (/row-level security|not authorized|unauthorized|permission/i.test(message)) {
    return "You don't have permission to do that.";
  }
  if (/already exists|duplicate/i.test(message))
    return "A file with that name already exists — try again.";
  if (/payload too large|exceeded the maximum allowed size/i.test(message))
    return "That file is too large to store.";
  return message || fallback;
}

/**
 * Upload a document into the organization's folder of the private bucket.
 * Validates size and type first, derives the content type from `file.type`
 * (falling back to `application/octet-stream`, which is then rejected) and
 * never overwrites an existing object.
 */
export async function uploadDocumentFile(
  orgId: UUID,
  file: File | Blob,
  fileName?: string | null,
): Promise<UploadedDocumentFile> {
  if (!orgId) throw new Error("Choose a workspace before uploading.");
  const { mime, size } = validateDocumentFile(file);
  const originalName =
    fileName ?? ("name" in file && typeof file.name === "string" ? file.name : null);
  const path = `${orgId}/${crypto.randomUUID()}-${safeFileName(originalName)}`;

  const { error } = await db.storage.from(DOCUMENTS_BUCKET).upload(path, file, {
    contentType: mime,
    upsert: false,
    cacheControl: "3600",
  });
  if (error) throw new Error(storageErrorMessage(error, "The file could not be uploaded."));
  return { path, mime, size };
}

/**
 * Short-lived signed URL for a stored document, or `null` when the row only
 * carries a placeholder path (no bytes were ever uploaded).
 */
export async function getDocumentUrl(
  storagePath: string | null | undefined,
  expiresInSeconds = 300,
): Promise<string | null> {
  if (isPlaceholderPath(storagePath)) return null;
  const { data, error } = await db.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath as string, expiresInSeconds);
  if (error) throw new Error(storageErrorMessage(error, "The file could not be opened."));
  return data.signedUrl;
}

/** Remove a stored object. Placeholder paths are a no-op. */
export async function deleteDocumentFile(path: string | null | undefined): Promise<void> {
  if (isPlaceholderPath(path)) return;
  const { error } = await db.storage.from(DOCUMENTS_BUCKET).remove([path as string]);
  if (error) throw new Error(storageErrorMessage(error, "The file could not be deleted."));
}
