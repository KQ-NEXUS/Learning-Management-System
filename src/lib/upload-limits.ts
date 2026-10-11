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

/**
 * Upload kinds. FILE, IMAGE and VIDEO are LessonType values; CAPTION is not a
 * lesson type — it is the kind of a WebVTT caption file attached to a VIDEO
 * resource (NFR-09, plan 15-23). `text/vtt` is accepted for CAPTION only.
 */
export type UploadKind = UploadableLessonType | "CAPTION";

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
export const UPLOAD_LIMITS: Readonly<Record<UploadKind, UploadLimit>> = Object.freeze({
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
  // NFR-09: WebVTT caption files only, small enough to serve same-origin
  // through the authorised captions route. Never accepted for VIDEO/FILE/IMAGE.
  CAPTION: Object.freeze({
    maxBytes: 1 * MB,
    mimeTypes: Object.freeze(["text/vtt"]),
  }),
});

/**
 * Presigned-PUT lifetime, in seconds, for a direct browser upload to a staged
 * key (D-36). Fifteen minutes covers a 2 GB video on a slow connection while
 * keeping the window short enough that a leaked URL expires quickly. The URL is
 * additionally bound to one staged key and one `Content-Type`.
 */
export const UPLOAD_URL_TTL_SECONDS = 900;

/**
 * A caption track's language is a BCP 47 language tag (NFR-09): a 2 or 3 letter
 * primary language, then optional subtags of 2 to 8 letters or digits (en, fr-CA,
 * zh-Hant-TW). Matched case-insensitively and capped at 35 characters. Used by the
 * lesson resource service and the authoring form so the rule cannot drift.
 */
export const CAPTION_LANGUAGE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
export const CAPTION_LANGUAGE_MAX_LENGTH = 35;
export const CAPTION_LABEL_MAX_LENGTH = 60;

/**
 * Plain refusal wording for caption authoring (NFR-09, plan 15-24), shared by the
 * authoring form (as a courtesy check) and the lesson resource service (the real
 * gate) so the two cannot say different things.
 */
export const CAPTION_FILE_MESSAGE = "Captions must be a WebVTT (.vtt) file of 1 MB or less.";
export const CAPTION_LANGUAGE_MESSAGE =
  "Enter the caption language as a language code such as en or fr-CA.";
export const CAPTION_LABEL_MESSAGE = `Enter a caption label of 1 to ${CAPTION_LABEL_MAX_LENGTH} characters.`;
export const CAPTION_PARENT_MESSAGE = "Captions can only be added to a video in the same lesson.";

export function isValidCaptionLanguage(value: string): boolean {
  return value.length <= CAPTION_LANGUAGE_MAX_LENGTH && CAPTION_LANGUAGE_PATTERN.test(value);
}

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
 * Certificate-template image assets (CR-02). Narrower than
 * `UPLOAD_LIMITS.IMAGE` on purpose: the certificate renderer embeds only PNG
 * and JPEG (pdf-lib has no WebP or GIF decoder), so an asset of any other type
 * would be uploaded and "verified" yet never appear on a certificate. Lesson
 * image uploads keep their wider list and are unaffected.
 */
export const CERTIFICATE_TEMPLATE_ASSET_MIME_TYPES: readonly string[] = Object.freeze([
  "image/png",
  "image/jpeg",
]);

export type ValidateTemplateAssetUploadInput = {
  mimeType: string;
  sizeBytes: number;
};

/**
 * Checks a declared (presign) or server-observed (confirm) template asset
 * against the PNG/JPEG allow-list, then delegates the byte-count and size-cap
 * checks to the shared IMAGE limit so the two never drift apart.
 */
export function validateTemplateAssetUpload(
  input: ValidateTemplateAssetUploadInput,
): ValidateUploadResult {
  if (!CERTIFICATE_TEMPLATE_ASSET_MIME_TYPES.includes(input.mimeType)) {
    return {
      ok: false,
      message: "Certificate template images must be a PNG or JPEG file.",
    };
  }
  return validateUpload({
    lessonType: "IMAGE",
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
  });
}

/** Support-ticket attachments are deliberately narrower than lesson files. */
export const TICKET_MAX_ATTACHMENTS_PER_MESSAGE = 3;
export const TICKET_MAX_ATTACHMENT_BYTES = 10 * MB;
export const TICKET_UPLOAD_MIME_TYPES: readonly string[] = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
]);

export type ValidateTicketUploadInput = {
  mimeType: string;
  sizeBytes: number;
};

export function validateTicketUpload(
  input: ValidateTicketUploadInput,
): ValidateUploadResult {
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return { ok: false, message: "Ticket file size must be a positive byte count." };
  }
  if (!TICKET_UPLOAD_MIME_TYPES.includes(input.mimeType)) {
    return {
      ok: false,
      message: "Ticket files must be PNG, JPEG, WebP, or PDF.",
    };
  }
  if (input.sizeBytes > TICKET_MAX_ATTACHMENT_BYTES) {
    return { ok: false, message: "Ticket file exceeds the 10 MB limit." };
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
