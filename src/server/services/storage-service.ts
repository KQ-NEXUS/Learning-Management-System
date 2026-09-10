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
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { downloadTtlFor, UPLOAD_URL_TTL_SECONDS } from "@/lib/upload-limits";

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
