/**
 * Object storage — environment-driven S3 client, key generation, streaming
 * put, and presigned GET.
 *
 * D-35: Cloudflare R2 in production, MinIO in dev and CI. Both speak the S3
 * API, so every line here is identical across environments — only the
 * `S3_*` environment variables differ. Nothing in this file may hardcode
 * either backend, and application code reads `S3_*` only (never `MINIO_*`).
 *
 * WORKER REACH (plan 04-10): the scan worker's handlers import this module.
 * It MUST NOT import `@/server/permissions` or anything that calls
 * `cookies()` from `next/headers` — doing so would drag the request-bound
 * permission stack into a process that has no request. There is no reason
 * for this module to need permissions; keep it that way.
 */

import { Readable, Transform } from "node:stream";
import { randomUUID } from "node:crypto";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { downloadTtlFor } from "@/lib/upload-limits";

/** Thrown when an upload stream exceeds the byte cap for its lesson type. */
export class UploadTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Upload exceeds the ${maxBytes}-byte limit for this lesson type.`);
    this.name = "UploadTooLargeError";
  }
}

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
 * The client used to presign GET URLs. A presigned URL is only valid for the
 * host it was computed against, and that host must be the one the BROWSER
 * resolves — not the internal one the server uses to reach storage. When
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

export type PutLessonObjectInput = {
  key: string;
  body: Readable;
  contentType: string;
  /** Per-type byte cap; the stream is destroyed the moment it is exceeded. */
  maxBytes?: number;
};

/**
 * Streams `body` to object storage with multipart upload — uploads traverse
 * the app because that is where authorization and the scan enqueue happen
 * (D-36). The body is a stream and is never buffered whole into memory.
 */
export async function putLessonObject(
  input: PutLessonObjectInput,
): Promise<{ bytesUploaded: number }> {
  let bytesUploaded = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _enc, callback) {
      bytesUploaded += chunk.length;
      if (input.maxBytes !== undefined && bytesUploaded > input.maxBytes) {
        callback(new UploadTooLargeError(input.maxBytes));
        return;
      }
      callback(null, chunk);
    },
  });

  const upload = new Upload({
    client: s3,
    params: {
      Bucket: bucketName(),
      Key: input.key,
      Body: input.body.pipe(meter),
      ContentType: input.contentType,
    },
  });

  await upload.done();
  return { bytesUploaded };
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

/** Converts a web `ReadableStream` (as on `Request.body`) to a Node stream. */
export function toNodeStream(body: ReadableStream<Uint8Array>): Readable {
  return Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]);
}
