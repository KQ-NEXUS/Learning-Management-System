/**
 * Step 1 of the direct upload flow (CAT-04 / D-28, D-36).
 *
 * The browser posts the file's metadata as JSON — never the bytes. This
 * handler authorizes `courses.edit` on the parent lesson, checks the declared
 * type and size against the lesson's own LessonType, then hands back a
 * short-lived presigned `PUT` URL bound to one staged key and one
 * `Content-Type`. The browser uploads straight to private storage with it,
 * bypassing the platform request-body limit, and then calls the completion
 * route.
 *
 * A denial or an unknown lesson returns 404 with an empty body — never 403,
 * never a message that distinguishes "no such lesson" from "not yours"
 * (CAT-07 enumeration control). A file-rule failure is 422; malformed JSON is
 * 400.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import * as permissions from "@/server/permissions";
import { lessonScope, getLessonTypeById } from "@/server/services/lesson-service";
import { validateUpload, UPLOAD_URL_TTL_SECONDS } from "@/lib/upload-limits";
import {
  buildStagedStorageKey,
  presignLessonUploadUrl,
} from "@/server/services/storage-service";
import { beginLessonResourceUpload } from "@/server/services/lesson-resource-service";
import { toLessonResourceView } from "@/server/presenters/lesson-resource-view";

const metadataSchema = z.object({
  lessonId: z.string().min(1),
  title: z.string().min(1).max(300),
  filename: z.string().min(1).max(500),
  mimeType: z.string().min(1).max(255),
  sizeBytes: z.number().int().nonnegative(),
});

/** A declared-metadata failure — mapped to 422 with the reason. */
class UploadValidationError extends Error {}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body is not valid JSON." }, { status: 400 });
  }

  const parsed = metadataSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Missing or malformed upload metadata." }, { status: 400 });
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

      const storageKey = buildStagedStorageKey({ lessonId: meta.lessonId });
      const uploadUrl = await presignLessonUploadUrl({
        key: storageKey,
        contentType: meta.mimeType,
      });
      const resource = await beginLessonResourceUpload({
        lessonId: meta.lessonId,
        title: meta.title,
        storageKey,
        filename: meta.filename,
        mimeType: meta.mimeType,
        sizeBytes: BigInt(meta.sizeBytes),
      });

      return { resource, uploadUrl };
    });

    const { resource, uploadUrl } = await authorized(null);
    return NextResponse.json(
      {
        resource: toLessonResourceView(resource),
        upload: {
          url: uploadUrl,
          method: "PUT",
          headers: { "Content-Type": meta.mimeType },
          expiresIn: UPLOAD_URL_TTL_SECONDS,
        },
      },
      { status: 201, headers: { "cache-control": "private, no-store" } },
    );
  } catch (err) {
    if (
      err instanceof permissions.AuthenticationError ||
      err instanceof permissions.AuthorizationError
    ) {
      return new NextResponse(null, { status: 404 });
    }
    if (err instanceof UploadValidationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    throw err;
  }
}
