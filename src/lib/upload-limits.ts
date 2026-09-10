/**
 * Per-LessonType upload rules and per-content-type download lifetimes.
 *
 * CAT-04 / D-28. This module is the single home for every per-type storage
 * rule — the byte caps, the MIME allow-list, and the presigned-URL lifetime —
 * so a value that governs one cannot drift out of step with the others.
 *
 * The MIME list is an ALLOW-list, not a deny-list (T-04-25). `image/svg+xml`
 * and `text/html` are absent on purpose: both are script-capable when served
 * from an origin a browser trusts, and no `Content-Disposition` header makes
 * that safe in every client. An unrecognised LessonType is a rejection.
 */

export type LessonType =
  | "TEXT"
  | "FILE"
  | "IMAGE"
  | "VIDEO"
  | "EMBED"
  | "LINK"
  | "QUIZ"
  | "ASSIGNMENT";

/** LessonType values that carry an uploadable resource. */
export type UploadableLessonType = "FILE" | "IMAGE" | "VIDEO";

export type UploadLimit = {
  readonly maxBytes: number;
  readonly mimeTypes: readonly string[];
};

const MB = 1024 * 1024;
const GB = 1024 * MB;

/**
 * Frozen, keyed only by the types that accept a resource. `TEXT`, `EMBED`,
 * `LINK`, `QUIZ` and `ASSIGNMENT` are deliberately absent — a lookup miss is
 * how `validateUpload` rejects them.
 */
export const UPLOAD_LIMITS: Readonly<Record<UploadableLessonType, UploadLimit>> = Object.freeze({
  IMAGE: Object.freeze({
    maxBytes: 10 * MB,
    // Raster only. image/svg+xml is NOT here — SVG carries <script> and
    // SMIL/animation vectors.
    mimeTypes: Object.freeze([
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
    ]),
  }),
  FILE: Object.freeze({
    maxBytes: 50 * MB,
    // Documents and text. text/html, image/svg+xml, generic application/zip and
    // any application/x-* are NOT here — HTML served from the app origin is an
    // XSS vector even behind Content-Disposition, and a bare ZIP hides anything.
    mimeTypes: Object.freeze([
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
      "text/plain",
      "text/csv",
    ]),
  }),
  VIDEO: Object.freeze({
    maxBytes: 2 * GB,
    mimeTypes: Object.freeze(["video/mp4", "video/webm"]),
  }),
});

/**
 * Presigned-PUT lifetime, in seconds, for a direct browser upload to a staged
 * key (D-36). Fifteen minutes covers a 2 GB video on a slow connection while
 * keeping the window short enough that a leaked URL expires quickly. The URL is
 * additionally bound to one staged key and one `Content-Type`.
 */
export const UPLOAD_URL_TTL_SECONDS = 900;

export type ValidateUploadInput = {
  lessonType: string;
  mimeType: string;
  sizeBytes: number;
};

export type ValidateUploadResult = { ok: true } | { ok: false; message: string };

/**
 * Checks a declared upload against its LessonType's allow-list and byte cap.
 * Every field is caller-declared and therefore untrusted; the byte cap is
 * re-checked as bytes actually stream in the upload Route Handler.
 */
export function validateUpload(input: ValidateUploadInput): ValidateUploadResult {
  const limit = (UPLOAD_LIMITS as Record<string, UploadLimit | undefined>)[input.lessonType];

  if (!limit) {
    return {
      ok: false,
      message: `A ${input.lessonType} lesson does not carry an uploadable resource.`,
    };
  }

  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes < 0) {
    return { ok: false, message: "Declared file size is not a valid byte count." };
  }

  if (!limit.mimeTypes.includes(input.mimeType)) {
    return {
      ok: false,
      message: `${input.mimeType} is not an accepted type for a ${input.lessonType} lesson.`,
    };
  }

  if (input.sizeBytes > limit.maxBytes) {
    const cap = limit.maxBytes >= GB
      ? `${Math.round(limit.maxBytes / GB)} GB`
      : `${Math.round(limit.maxBytes / MB)} MB`;
    return { ok: false, message: `File exceeds the ${cap} limit for a ${input.lessonType} lesson.` };
  }

  return { ok: true };
}

/**
 * Presigned-GET lifetime, in seconds, per content type (D-37).
 *
 * FILE and IMAGE resolve in a single request, so the tight 60-second window
 * is enough. VIDEO gets 4 hours: a `<video>` element follows the download
 * redirect ONCE, caches the resolved URL, and issues every subsequent Range
 * request straight against it — so the lifetime has to outlast the whole
 * viewing session. A 2 GB file behind a 60-second URL stalls partway through;
 * that is arithmetic, not a risk. Do NOT collapse these back into one shared
 * constant — a value that serves a PDF cannot serve a full-length video.
 */
export const DOWNLOAD_TTL_SECONDS: Readonly<Record<UploadableLessonType, number>> = Object.freeze({
  FILE: 60,
  IMAGE: 60,
  VIDEO: 14_400,
});

/**
 * The presign lifetime for a lesson type. An unrecognised type gets the tight
 * 60-second window — never the generous one.
 */
export function downloadTtlFor(lessonType: string): number {
  return (DOWNLOAD_TTL_SECONDS as Record<string, number | undefined>)[lessonType] ?? 60;
}
