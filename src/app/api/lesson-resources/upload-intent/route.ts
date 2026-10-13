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
 * NFR-09 (plan 15-24): the same flow carries a WebVTT caption for a video. A
 * request with `kind: "CAPTION"` must name `captionForResourceId` (the video
 * resource it captions); the language, label, file type and size, and "the parent
 * is a video of the SAME lesson" are enforced by `beginLessonResourceUpload`, and a
 * refusal comes back as a plain 422 message. The caption fields are rejected (400)
 * on any other kind, so an ordinary upload cannot smuggle them in.
 *
 * A denial or an unknown lesson returns 404 with an empty body — never 403,
 * never a message that distinguishes "no such lesson" from "not yours"
 * (CAT-07 enumeration control). A file-rule failure is 422; malformed JSON is
 * 400.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import * as permissions from "@/server/permissions";
import { LICENCE_REFUSAL_MESSAGE } from "@/server/licence/policy";
import { lessonScope, getLessonTypeById } from "@/server/services/lesson-service";
import { validateUpload, UPLOAD_URL_TTL_SECONDS } from "@/lib/upload-limits";
import {
  buildStagedStorageKey,
  presignLessonUploadUrl,
} from "@/server/services/storage-service";
import {
  beginLessonResourceUpload,
  CaptionAttachmentError,
} from "@/server/services/lesson-resource-service";
import { CAPTION_PARENT_MESSAGE } from "@/lib/upload-limits";
import { toLessonResourceView } from "@/server/presenters/lesson-resource-view";

const metadataSchema = z
  .object({
    lessonId: z.string().min(1),
    title: z.string().min(1).max(300),
    filename: z.string().min(1).max(500),
    mimeType: z.string().min(1).max(255),
    sizeBytes: z.number().int().nonnegative(),
    // NFR-09 — caption upload. Language and label are validated by the service so
    // a bad value is a plain 422 message rather than a generic 400.
    kind: z.literal("CAPTION").optional(),
    captionForResourceId: z.string().min(1).max(200).optional(),
    captionLanguage: z.string().max(200).optional(),
    captionLabel: z.string().max(200).optional(),
  })
  .refine(
    (value) =>
      value.kind === "CAPTION"
        ? value.captionForResourceId !== undefined
        : value.captionForResourceId === undefined &&
          value.captionLanguage === undefined &&
          value.captionLabel === undefined,
  );

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

      const isCaption = meta.kind === "CAPTION";
      if (isCaption) {
        // Only a video lesson carries captions; the service additionally checks
        // the parent resource and every caption field.
        if (lessonType !== "VIDEO") throw new UploadValidationError(CAPTION_PARENT_MESSAGE);
      } else {
        const check = validateUpload({
          lessonType,
          mimeType: meta.mimeType,
          sizeBytes: meta.sizeBytes,
        });
        if (!check.ok) throw new UploadValidationError(check.message);
      }

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
        ...(isCaption && meta.captionForResourceId !== undefined
          ? {
              caption: {
                forResourceId: meta.captionForResourceId,
                language: meta.captionLanguage ?? "",
                label: meta.captionLabel ?? "",
              },
            }
          : {}),
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
    // Licence refusal (LIC-05): the caller already passed authorization, so this
    // reveals state only to them. Every genuine denial keeps the identical 404.
    if (permissions.isLicenceRestricted(err)) {
      return NextResponse.json({ error: LICENCE_REFUSAL_MESSAGE }, { status: 403 });
    }
    if (
      err instanceof permissions.AuthenticationError ||
      err instanceof permissions.AuthorizationError
    ) {
      return new NextResponse(null, { status: 404 });
    }
    if (err instanceof UploadValidationError || err instanceof CaptionAttachmentError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    throw err;
  }
}
