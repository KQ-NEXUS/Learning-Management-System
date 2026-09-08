/**
 * Streaming multipart upload for lesson resources (CAT-04 / D-28).
 *
 * A Route Handler, not a Server Action: Server Actions cap the uploaded
 * payload at 1 MB, and a VIDEO lesson resource may be up to 2 GB. Next imposes
 * no body-size limit on Route Handlers, so the per-type cap is enforced here
 * as bytes stream (see `putLessonObject`).
 *
 * Order of operations is load-bearing:
 *   1. Parse metadata from the query string — never from the payload.
 *   2. Authorize `courses.edit` on the lesson BEFORE the stream is read.
 *   3. Validate the declared type/size against the lesson's own LessonType.
 *   4. Stream to object storage under an unguessable key.
 *   5. Create the row PENDING, enqueue the scan, return 201.
 *
 * A denial or an unknown lesson returns 404 with an empty body — never 403,
 * never a message that distinguishes "no such lesson" from "not yours"
 * (CAT-07 enumeration control).
 */

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { z } from "zod";
import * as permissions from "@/server/permissions";
import { lessonScope, getLessonTypeById } from "@/server/services/lesson-service";
import { UPLOAD_LIMITS, validateUpload } from "@/lib/upload-limits";
import {
  buildStorageKey,
  putLessonObject,
  toNodeStream,
  UploadTooLargeError,
} from "@/server/services/storage-service";
import { createLessonResource } from "@/server/services/lesson-resource-service";
import { enqueueScan } from "@/server/jobs/queue";

const metadataSchema = z.object({
  lessonId: z.string().min(1),
  title: z.string().min(1).max(300),
  filename: z.string().min(1).max(500),
  mimeType: z.string().min(1).max(255),
  sizeBytes: z.coerce.number().int().nonnegative(),
});

/** A declared-metadata failure — mapped to 422 with the reason. */
class UploadValidationError extends Error {}

export async function POST(request: Request): Promise<Response> {
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = metadataSchema.safeParse(query);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Missing or malformed upload metadata." },
      { status: 400 },
    );
  }
  const meta = parsed.data;

  try {
    const authorized = permissions.withPermission<null>(
      "courses.edit",
      () => lessonScope(meta.lessonId),
    )(async () => {
      const lessonType = await getLessonTypeById(meta.lessonId);
      if (lessonType === null) {
        // Indistinguishable from a denial — never confirm existence.
        throw new permissions.AuthorizationError("courses.edit");
      }

      const check = validateUpload({
        lessonType,
        mimeType: meta.mimeType,
        sizeBytes: meta.sizeBytes,
      });
      if (!check.ok) throw new UploadValidationError(check.message);

      const source = request.body;
      if (!source) throw new UploadValidationError("Request carried no body.");

      const storageKey = buildStorageKey({ lessonId: meta.lessonId });
      const maxBytes = (UPLOAD_LIMITS as Record<string, { maxBytes: number }>)[lessonType]
        .maxBytes;

      const { bytesUploaded } = await putLessonObject({
        key: storageKey,
        body: toNodeStream(source),
        contentType: meta.mimeType,
        maxBytes,
      });

      const resource = await createLessonResource({
        lessonId: meta.lessonId,
        title: meta.title,
        storageKey,
        filename: meta.filename,
        mimeType: meta.mimeType,
        sizeBytes: BigInt(bytesUploaded),
      });

      await enqueueScan(resource.id);
      return resource;
    });

    const resource = await authorized(null);
    return NextResponse.json(
      { id: resource.id, scanStatus: "PENDING" },
      { status: 201 },
    );
  } catch (err) {
    if (
      err instanceof permissions.AuthenticationError ||
      err instanceof permissions.AuthorizationError
    ) {
      return new NextResponse(null, { status: 404 });
    }
    if (err instanceof UploadValidationError || err instanceof UploadTooLargeError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    throw err;
  }
}
