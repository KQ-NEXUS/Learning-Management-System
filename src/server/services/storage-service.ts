/**
 * Object storage — environment-driven S3 client, key generation, staged
 * direct-upload operations, and presigned GET.
 *
 * D-35: Cloudflare R2 in production, MinIO in dev and CI. Both speak the S3
 * API, so every line here is identical across environments — only the
 * `S3_*` environment variables differ. Nothing in this file may hardcode
 * either backend, and application code reads `S3_*` only (never `MINIO_*`).
 *
 * D-36: the browser uploads the bytes directly to a private staged key with a
 * short-lived presigned `PUT`; the server authorizes the request, signs the
 * URL, then verifies and promotes the object. No file body ever traverses the
 * app, so nothing here streams request bodies.
 *
 * This module MUST NOT import the request-scoped permission module
 * (`src/server/permissions/*`) or anything that reads the request session
 * cookie. The scheduled cleanup function reaches this module from a context
 * that has no request; keep it that way.
 */

import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { Upload } from "@aws-sdk/lib-storage";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  downloadTtlFor,
  UPLOAD_URL_TTL_SECONDS,
  validateUpload,
} from "@/lib/upload-limits";

function makeClient(endpoint: string | undefined): S3Client {
  return new S3Client({
    endpoint,
    region: "auto",
    // Environment-driven, never hardcoded (D-35). MinIO needs `true` or the
    // SDK issues bucket-as-subdomain requests it rejects; R2 wants `false`.
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    },
  });
}

/** Reaches storage from the server (inside Compose this is `http://minio:9000`). */
const s3 = makeClient(process.env.S3_ENDPOINT);

/**
 * The client used to presign URLs. A presigned URL is only valid for the host
 * it was computed against, and that host must be the one the BROWSER resolves —
 * not the internal one the server uses to reach storage. When
 * `S3_PUBLIC_ENDPOINT` is set, presign against a client bound to it.
 */
const presignClient = process.env.S3_PUBLIC_ENDPOINT
  ? makeClient(process.env.S3_PUBLIC_ENDPOINT)
  : s3;

function bucketName(): string {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("S3_BUCKET is not configured.");
  return bucket;
}

/**
 * `lessons/<lessonId>/<randomUUID()>` — the original filename is NEVER part
 * of the key (NFR-06: no predictable object paths, no path-traversal
 * surface). The filename is stored in `LessonResource.filename` instead, for
 * display and for the download's `Content-Disposition`.
 */
export function buildStorageKey({ lessonId }: { lessonId: string }): string {
  return `lessons/${lessonId}/${randomUUID()}`;
}

/**
 * `lesson-uploads/<lessonId>/<randomUUID()>` — the key the browser is allowed
 * to `PUT` to. It is never the final `lessons/` key, so a leaked upload URL
 * can only overwrite an unpromoted staging object.
 */
export function buildStagedStorageKey({ lessonId }: { lessonId: string }): string {
  return `lesson-uploads/${lessonId}/${randomUUID()}`;
}

/**
 * The deterministic final key for a staged upload. Deterministic so completion
 * is retry-safe if the database update fails after the copy. Only a staged key
 * can be promoted — passing anything else is a programming error.
 */
export function finalStorageKeyFor(stagedKey: string): string {
  if (!stagedKey.startsWith("lesson-uploads/")) {
    throw new Error("A final key can only be derived from a staged lesson upload.");
  }
  return stagedKey.replace(/^lesson-uploads\//, "lessons/");
}

/**
 * `submissions/<enrolmentId>/<assessmentId>/<randomUUID()>` — Submission's
 * final key. Mirrors `buildStorageKey`'s no-predictable-path rationale
 * (NFR-06) in the Submission domain (ASM-04). Kept as a separate function
 * from the Lesson builders above (not a shared parameterised helper) so a
 * Lesson staged key can never be promoted into `submissions/` and vice versa
 * (T-10-06).
 */
export function buildSubmissionStorageKey({
  enrolmentId,
  assessmentId,
}: {
  enrolmentId: string;
  assessmentId: string;
}): string {
  return `submissions/${enrolmentId}/${assessmentId}/${randomUUID()}`;
}

/**
 * `submission-uploads/<enrolmentId>/<assessmentId>/<randomUUID()>` — the key
 * the browser is allowed to `PUT` to. It is never the final `submissions/`
 * key, so a leaked upload URL can only overwrite an unpromoted staging
 * object (T-10-06).
 */
export function buildStagedSubmissionStorageKey({
  enrolmentId,
  assessmentId,
}: {
  enrolmentId: string;
  assessmentId: string;
}): string {
  return `submission-uploads/${enrolmentId}/${assessmentId}/${randomUUID()}`;
}

/**
 * The deterministic final key for a staged Submission upload. Only a staged
 * `submission-uploads/` key can be promoted — passing anything else
 * (including a Lesson `lesson-uploads/` key) is a programming error and
 * throws, the same shape `finalStorageKeyFor` uses for Lesson keys. This
 * function is deliberately NOT a generalisation of `finalStorageKeyFor` — a
 * Lesson staged key must remain incapable of promoting into `submissions/`
 * (T-10-06).
 */
export function finalSubmissionKeyFor(stagedKey: string): string {
  if (!stagedKey.startsWith("submission-uploads/")) {
    throw new Error("A final key can only be derived from a staged submission upload.");
  }
  return stagedKey.replace(/^submission-uploads\//, "submissions/");
}

/**
 * A presigned `PUT` URL bound to one staged key and one `Content-Type`, valid
 * for `UPLOAD_URL_TTL_SECONDS`. The browser sends the file straight to private
 * storage with this URL, bypassing the platform request-body limit.
 */
export async function presignLessonUploadUrl(input: {
  key: string;
  contentType: string;
}): Promise<string> {
  return getSignedUrl(
    presignClient,
    new PutObjectCommand({
      Bucket: bucketName(),
      Key: input.key,
      ContentType: input.contentType,
    }),
    { expiresIn: UPLOAD_URL_TTL_SECONDS },
  );
}

/**
 * Reads the stored object's byte count and content type so completion can
 * require them to equal the metadata the browser declared at intent time.
 */
export async function inspectLessonObject(
  key: string,
): Promise<{ sizeBytes: bigint; contentType: string | null }> {
  const result = await s3.send(
    new HeadObjectCommand({ Bucket: bucketName(), Key: key }),
  );
  if (result.ContentLength === undefined) {
    throw new Error("Stored object has no byte length.");
  }
  return {
    sizeBytes: BigInt(result.ContentLength),
    contentType: result.ContentType?.split(";", 1)[0]?.trim().toLowerCase() ?? null,
  };
}

function encodedCopySource(bucket: string, key: string): string {
  return `${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * Copies a verified staged object to its deterministic final key. The staged
 * object is deleted separately so a failure between copy and delete leaves a
 * harmless orphan the lifecycle rule reaps, never a missing final object.
 */
export async function promoteLessonObject(input: {
  stagedKey: string;
  finalKey: string;
}): Promise<void> {
  const bucket = bucketName();
  await s3.send(
    new CopyObjectCommand({
      Bucket: bucket,
      CopySource: encodedCopySource(bucket, input.stagedKey),
      Key: input.finalKey,
    }),
  );
}

/** Deletes one object. Callers treat a missing object as already deleted. */
export async function deleteLessonObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: bucketName(), Key: key }));
}

export type PresignLessonObjectInput = {
  key: string;
  lessonType: string;
  filename?: string;
  contentType?: string;
};

/**
 * A presigned GET URL whose `expiresIn` is the per-type lifetime from
 * `downloadTtlFor` (D-37) — never a numeric literal. `ResponseContentDisposition`
 * and `ResponseContentType` are baked into the presigned command: with a 302
 * redirect the app no longer controls the response headers, so a stored HTML
 * file would otherwise render in the storage origin (T-04-27c).
 */
export async function presignLessonObjectUrl(
  input: PresignLessonObjectInput,
): Promise<string> {
  const safeName = (input.filename ?? "download").replace(/["\r\n]/g, "");
  const command = new GetObjectCommand({
    Bucket: bucketName(),
    Key: input.key,
    ResponseContentDisposition: `attachment; filename="${safeName}"`,
    ResponseContentType: input.contentType ?? "application/octet-stream",
  });

  return getSignedUrl(presignClient, command, {
    expiresIn: downloadTtlFor(input.lessonType),
  });
}

// ---------------------------------------------------------------------------
// Certificate PDFs and certificate-template assets
// ---------------------------------------------------------------------------

/**
 * The generated PDF key includes fresh randomness even when the certificate
 * id is known, matching the no-predictable-path rule used by submissions.
 */
export function buildCertificateStorageKey({
  certificateId,
}: {
  certificateId: string;
}): string {
  return `certificates/${certificateId}/${randomUUID()}`;
}

/** A final private key for an image used by a certificate template. */
export function buildTemplateAssetStorageKey({
  templateId,
}: {
  templateId: string;
}): string {
  return `certificate-template-assets/${templateId}/${randomUUID()}`;
}

/** A browser-writable staging key kept separate from final template assets. */
export function buildStagedTemplateAssetStorageKey({
  templateId,
}: {
  templateId: string;
}): string {
  return `certificate-template-asset-uploads/${templateId}/${randomUUID()}`;
}

/** Derives a retry-safe final template-asset key only from its own staging domain. */
export function finalTemplateAssetKeyFor(stagedKey: string): string {
  if (!stagedKey.startsWith("certificate-template-asset-uploads/")) {
    throw new Error("A final key can only be derived from a staged certificate-template asset upload.");
  }
  return stagedKey.replace(
    /^certificate-template-asset-uploads\//,
    "certificate-template-assets/",
  );
}

/** Writes a server-generated certificate directly to private object storage. */
export async function putGeneratedCertificateObject(input: {
  key: string;
  body: Uint8Array;
  contentType: string;
}): Promise<void> {
  if (input.contentType !== "application/pdf") {
    throw new Error("Generated certificate objects must use application/pdf.");
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName(),
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
    }),
  );
}

/** Creates a short-lived download URL for one generated certificate PDF. */
export async function presignCertificateObjectUrl(input: {
  key: string;
}): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: bucketName(),
    Key: input.key,
    ResponseContentDisposition: "attachment",
    ResponseContentType: "application/pdf",
  });

  return getSignedUrl(presignClient, command, {
    expiresIn: downloadTtlFor("FILE"),
  });
}

/**
 * Fetches a private object's full bytes directly, server-side only. Added for
 * `certificate-issuance-service.ts`'s live `resolveTemplateAsset` binding
 * (plan 11-07) — the PDF renderer never touches object storage itself
 * (T-11-14, `certificate-pdf-renderer.ts`'s header); this is the one call
 * site that resolves a template's image `assetKey` into bytes on its behalf
 * so a logo/signature/background can be embedded into the rendered PDF. Not
 * part of any browser-reachable flow — a browser only ever receives a
 * presigned URL (`presignTemplateAssetUploadUrl`, `presignLessonObjectUrl`).
 */
export async function getObjectBytes(key: string): Promise<Uint8Array> {
  const result = await s3.send(
    new GetObjectCommand({ Bucket: bucketName(), Key: key }),
  );
  if (!result.Body) {
    throw new Error(`No object body for key ${key}.`);
  }
  return result.Body.transformToByteArray();
}

/** How long a template-image preview link stays valid: long enough to keep an editor open. */
const TEMPLATE_ASSET_VIEW_TTL_SECONDS = 300;

/**
 * Creates a short-lived, inline view link for one stored template image, so the template editor
 * can show a design it has already saved. It signs only keys inside the FINAL template-asset
 * folder: not staged uploads, generated certificates, submissions or anything else, and not a key
 * that tries to climb out with `..`. Callers authorize (`certificates.manage`) before asking.
 */
export async function presignTemplateAssetViewUrl(input: { key: string }): Promise<string> {
  const prefix = "certificate-template-assets/";
  if (
    !input.key.startsWith(prefix) ||
    input.key.length === prefix.length ||
    input.key.split("/").some((part) => part === "..")
  ) {
    throw new Error("Only a stored certificate template image can be previewed.");
  }

  const command = new GetObjectCommand({
    Bucket: bucketName(),
    Key: input.key,
    ResponseContentDisposition: "inline",
  });

  return getSignedUrl(presignClient, command, { expiresIn: TEMPLATE_ASSET_VIEW_TTL_SECONDS });
}

/**
 * Presigns a template image upload after applying the shared IMAGE MIME and
 * size rules. The asset stays staged until the existing generic inspect and
 * promote operations verify it.
 */
export async function presignTemplateAssetUploadUrl(input: {
  key: string;
  contentType: string;
  contentLength: number;
}): Promise<string> {
  const validation = validateUpload({
    lessonType: "IMAGE",
    mimeType: input.contentType,
    sizeBytes: input.contentLength,
  });
  if (!validation.ok) throw new Error(validation.message);

  return getSignedUrl(
    presignClient,
    new PutObjectCommand({
      Bucket: bucketName(),
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.contentLength,
    }),
    { expiresIn: UPLOAD_URL_TTL_SECONDS },
  );
}

const EXPORT_KEY_PATTERN = /^exports\/[A-Za-z0-9_-]{8,128}\/[A-Za-z0-9._-]{1,32}\.csv$/;

/** Stable across background retries, with no learner or original filename data. */
export function buildExportStorageKey(jobId: string, datasetVersion: string): string {
  const key = `exports/${jobId}/${datasetVersion}.csv`;
  if (!EXPORT_KEY_PATTERN.test(key)) throw new Error("Invalid export storage identity.");
  return key;
}

function assertExportKey(key: string): void {
  if (!EXPORT_KEY_PATTERN.test(key)) throw new Error("Invalid export storage key.");
}

export async function uploadExportObject(input: { key: string; body: Readable }): Promise<void> {
  assertExportKey(input.key);
  const upload = new Upload({
    client: s3,
    params: {
      Bucket: bucketName(),
      Key: input.key,
      Body: input.body,
      ContentType: "text/csv; charset=utf-8",
    },
    queueSize: 2,
    partSize: 5 * 1024 * 1024,
    leavePartsOnError: false,
  });
  await upload.done();
}

export async function deleteExportObject(key: string): Promise<void> {
  assertExportKey(key);
  await s3.send(new DeleteObjectCommand({ Bucket: bucketName(), Key: key }));
}

function exportDownloadTtl(): number {
  const configured = Number(process.env.EXPORT_DOWNLOAD_TTL_SECONDS ?? 60);
  return Number.isInteger(configured) ? Math.min(120, Math.max(30, configured)) : 60;
}

/** Called only after the download service rechecks current grants and expiry. */
export async function presignExportObjectUrl(input: { key: string; filename: string }): Promise<string> {
  assertExportKey(input.key);
  const safeName = input.filename.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 100) || "export.csv";
  const command = new GetObjectCommand({
    Bucket: bucketName(),
    Key: input.key,
    ResponseContentDisposition: `attachment; filename="${safeName}"`,
    ResponseContentType: "text/csv; charset=utf-8",
  });
  return getSignedUrl(presignClient, command, { expiresIn: exportDownloadTtl() });
}
