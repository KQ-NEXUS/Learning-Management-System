"use server";

import { z } from "zod";
import { withPermission, AuthenticationError, AuthorizationError } from "@/server/permissions";
import { validateUpload, UPLOAD_URL_TTL_SECONDS } from "@/lib/upload-limits";
import {
  buildStagedTemplateAssetStorageKey,
  finalTemplateAssetKeyFor,
  presignTemplateAssetUploadUrl,
  inspectLessonObject,
  promoteLessonObject,
  deleteLessonObject,
} from "@/server/services/storage-service";

/**
 * Server actions for a certificate-template image element's asset (D-09,
 * T-11-11, plan 11-12 Task 3).
 *
 * Both actions are gated by `certificates.manage` — the same permission
 * `certificate-template-service.ts` requires for every template write
 * (11-DECISIONS.md) — checked directly with `withPermission` rather than
 * through a service-layer function: there is no `TemplateAsset` Prisma
 * model to gate through (an image element's `assetKey` lives only inside
 * the template's JSON layout), so this file IS the permission boundary,
 * matching the same direct-`withPermission` shape
 * `api/lesson-resources/upload-intent/route.ts` uses for the identical
 * reason. Templates are a single, global library (D-10) — the scope
 * resolver always returns `{}`, mirroring `certificateTemplateScope()`.
 *
 * The flow is the existing three-step one `lesson-resource-service.ts`
 * already proves out, unchanged in substance: presign a staged key → the
 * browser PUTs directly to the object store → the server INSPECTS the
 * uploaded object's real content-type and byte length → promote to the
 * final key. The client's declared MIME type is never trusted as the
 * verification — `confirmTemplateAssetUploadAction` re-validates the
 * server-OBSERVED type/size against the same `upload-limits.ts` allow-list
 * `presignTemplateAssetUploadAction` checked the client-claimed ones
 * against, so a spoofed `Content-Type` on the presign request cannot slip a
 * type that same shared allow-list excludes (T-04-25) past the real check.
 *
 * Every failure path returns a fixed, generic `{ ok: false, message }` —
 * never a raw caught `error.message` — matching `grading-actions.ts` /
 * `attendance-actions.ts`'s established shape for this codebase.
 */

const DENIED_MESSAGE = "Your role does not permit uploading certificate template images.";
const VERIFICATION_FAILED_MESSAGE =
  "This image could not be verified. Choose a PNG, JPEG, WebP or GIF under 10 MB and try again.";

/** The verified stored object did not match its declared upload — the
 * client's claim was wrong, or the object failed the real allow-list check. */
class UploadVerificationError extends Error {}

type PresignResult =
  | { ok: true; stagedKey: string; uploadUrl: string; expiresIn: number }
  | { ok: false; message: string };

const presignSchema = z
  .object({
    templateId: z.string().trim().min(1).max(100),
    filename: z.string().trim().min(1).max(500),
    mimeType: z.string().trim().min(1).max(255),
    sizeBytes: z.number().int().nonnegative(),
  })
  .strict();

/**
 * Step 1: authorize, validate the CLIENT-CLAIMED metadata against the shared
 * IMAGE allow-list (courtesy only — `confirmTemplateAssetUploadAction` is
 * the real gate), and hand back a short-lived presigned `PUT` bound to one
 * staged key and one `Content-Type`.
 */
export async function presignTemplateAssetUploadAction(input: unknown): Promise<PresignResult> {
  const parsed = presignSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Choose a valid image file to upload." };
  }

  const check = validateUpload({
    lessonType: "IMAGE",
    mimeType: parsed.data.mimeType,
    sizeBytes: parsed.data.sizeBytes,
  });
  if (!check.ok) return { ok: false, message: check.message };

  try {
    const authorized = withPermission<null>(
      "certificates.manage",
      () => ({}),
    )(async () => {
      const stagedKey = buildStagedTemplateAssetStorageKey({ templateId: parsed.data.templateId });
      const uploadUrl = await presignTemplateAssetUploadUrl({
        key: stagedKey,
        contentType: parsed.data.mimeType,
        contentLength: parsed.data.sizeBytes,
      });
      return { stagedKey, uploadUrl };
    });
    const { stagedKey, uploadUrl } = await authorized(null);
    return { ok: true, stagedKey, uploadUrl, expiresIn: UPLOAD_URL_TTL_SECONDS };
  } catch (error) {
    if (error instanceof AuthenticationError || error instanceof AuthorizationError) {
      return { ok: false, message: DENIED_MESSAGE };
    }
    return { ok: false, message: "This upload could not be started. Reload the page and try again." };
  }
}

type ConfirmResult = { ok: true; assetKey: string } | { ok: false; message: string };

const confirmSchema = z
  .object({
    stagedKey: z.string().trim().min(1).max(500),
    // Carried only so the mismatch check below has something to compare the
    // INSPECTED object against — never trusted on its own (T-11-11).
    contentType: z.string().trim().min(1).max(255),
    sizeBytes: z.number().int().nonnegative(),
  })
  .strict();

/**
 * Step 2: authorize, INSPECT the real stored object (never the client's
 * claim), reject anything that does not match both the declared metadata
 * AND the shared allow-list, then promote the verified object to its final
 * key. Mirrors `completeLessonResourceUpload`'s inspect → compare → promote
 * → cleanup-staged shape exactly.
 */
export async function confirmTemplateAssetUploadAction(input: unknown): Promise<ConfirmResult> {
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "This upload could not be confirmed. Try again." };
  }

  try {
    const authorized = withPermission<null>(
      "certificates.manage",
      () => ({}),
    )(async () => {
      const stagedKey = parsed.data.stagedKey;
      // Only a staged template-asset key may be promoted — throws for
      // anything else, closing off a cross-domain key-confusion path the
      // same way `finalStorageKeyFor`/`finalSubmissionKeyFor` do for their
      // own domains (T-10-06's sibling for this domain).
      const finalKey = finalTemplateAssetKeyFor(stagedKey);

      let stored: { sizeBytes: bigint; contentType: string | null };
      try {
        stored = await inspectLessonObject(stagedKey);
      } catch {
        throw new UploadVerificationError();
      }

      const declaredType = parsed.data.contentType.trim().toLowerCase();
      const declaredBytes = BigInt(parsed.data.sizeBytes);
      const cleanupStaged = async () => {
        try {
          await deleteLessonObject(stagedKey);
        } catch (cleanupError) {
          console.error(`[template-asset] staged cleanup failed for ${stagedKey}`, cleanupError);
        }
      };

      if (stored.sizeBytes !== declaredBytes || stored.contentType !== declaredType) {
        await cleanupStaged();
        throw new UploadVerificationError();
      }

      // The real, server-OBSERVED type/size against the same allow-list —
      // this, not the presign step's courtesy check, is the actual gate
      // (T-11-11): a spoofed `Content-Type` header on the presign request
      // cannot get an excluded type (T-04-25) promoted, because what is
      // checked here is what the object store actually stored.
      const verified = validateUpload({
        lessonType: "IMAGE",
        mimeType: stored.contentType ?? "",
        sizeBytes: Number(stored.sizeBytes),
      });
      if (!verified.ok) {
        await cleanupStaged();
        throw new UploadVerificationError();
      }

      await promoteLessonObject({ stagedKey, finalKey });
      await cleanupStaged();
      return finalKey;
    });

    const assetKey = await authorized(null);
    return { ok: true, assetKey };
  } catch (error) {
    if (error instanceof AuthenticationError || error instanceof AuthorizationError) {
      return { ok: false, message: DENIED_MESSAGE };
    }
    if (error instanceof UploadVerificationError) {
      return { ok: false, message: VERIFICATION_FAILED_MESSAGE };
    }
    return { ok: false, message: "This upload could not be confirmed. Try again." };
  }
}
