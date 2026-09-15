"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getCurrentActor } from "@/server/auth/current-actor";
import { sanitizeLessonBody } from "@/lib/sanitize";
import {
  beginSubmissionUpload,
  completeSubmissionUpload,
  failSubmissionUpload,
  getOwnAssignmentView,
  SubmissionNotAllowedError,
  SubmissionConstraintError,
} from "@/server/services/submission-service";

/**
 * The Assignment submission pane's three Server Actions plus a view-builder
 * (ASM-03, ASM-04, 10-14 Task 1) — a third sibling module beside `actions.ts`
 * and `assessment-actions.ts` in this same route directory.
 *
 * T-10-33 (Tampering — client-fabricated receipt facts): none of the three
 * schemas below accept `receiptId`, `isLate`, `enrolmentId` or `storageKey`.
 * `.strict()` rejects any of those if a caller plants them, and every one of
 * those facts is derived server-side by `submission-service.ts` from the
 * session actor and the stored object, never from the request body — the
 * same "derive identity from the session, look up by ownership" shape
 * `node_modules/next/dist/docs/01-app/02-guides/server-actions.md`'s
 * `completeItem` example uses, applied here to lateness/receipt facts
 * instead of identity.
 *
 * T-10-02 (Information Disclosure): every action resolves the actor with
 * `getCurrentActor` and delegates straight to the ownership-scoped service
 * — no action accepts an `enrolmentId` to disambiguate with, so there is no
 * parameter through which a caller could even attempt to name another
 * learner's enrolment.
 *
 * Revalidation: the complete step is the only one that changes learner-
 * visible state (a verified receipt). Because no action here carries an
 * `enrolmentId`/`lessonId`, the literal single-path form the doc's
 * "Choosing a cache update" section shows is unavailable — this instead uses
 * the doc's own "Revalidating a Page path" pattern (`revalidatePath` with a
 * route-pattern string plus `type: "page"`) to invalidate every lesson page
 * matching this route shape, so the caller's own next read carries the
 * receipt without a follow-up client fetch.
 */

const LESSON_PAGE_PATTERN = "/learn/[enrolmentId]/lessons/[lessonId]";

const UPLOAD_FAILURE = {
  message: "Your file couldn't be uploaded",
  body: "Nothing was submitted. Check your connection and try again.",
} as const;

const beginSchema = z
  .object({
    assessmentId: z.string().min(1),
    enrolmentId: z.string().min(1).optional(),
    filename: z.string().trim().min(1),
    mimeType: z.string().trim().min(1),
    sizeBytes: z.number().int().positive(),
  })
  .strict();

const completeSchema = z.object({ submissionId: z.string().min(1) }).strict();

const failSchema = z
  .object({ submissionId: z.string().min(1), detail: z.string().trim().min(1) })
  .strict();

export async function beginSubmissionUploadAction(input: unknown) {
  const parsed = beginSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "The upload request was incomplete." };

  const actor = await getCurrentActor();
  if (!actor) return { ok: false as const, message: "Sign in to submit this assignment." };

  try {
    const begun = await beginSubmissionUpload(actor, parsed.data);
    return { ok: true as const, ...begun };
  } catch (error) {
    if (error instanceof SubmissionNotAllowedError) return { ok: false as const, message: error.message };
    if (error instanceof SubmissionConstraintError) return { ok: false as const, message: error.message };
    return { ok: false as const, ...UPLOAD_FAILURE };
  }
}

export async function completeSubmissionUploadAction(input: unknown) {
  const parsed = completeSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, ...UPLOAD_FAILURE };

  const actor = await getCurrentActor();
  if (!actor) return { ok: false as const, message: "Sign in to submit this assignment." };

  try {
    const receipt = await completeSubmissionUpload(actor, parsed.data);
    // The receipt only becomes displayable once the server has verified the
    // stored object — revalidating here, not on begin, is what keeps that
    // invariant true of the rendered page too (ASM-04).
    revalidatePath(LESSON_PAGE_PATTERN, "page");
    return { ok: true as const, receipt };
  } catch (error) {
    if (error instanceof SubmissionNotAllowedError) return { ok: false as const, message: error.message };
    // SubmissionUploadValidationError and anything else from the complete
    // step: the technical detail (`UNVERIFIED_DETAIL`/`MISMATCH_DETAIL`) is
    // never the learner-facing copy — ASM-04's invariant is stated in
    // learner language here, verbatim, never softened.
    return { ok: false as const, ...UPLOAD_FAILURE };
  }
}

export async function failSubmissionUploadAction(input: unknown) {
  const parsed = failSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, ...UPLOAD_FAILURE };

  const actor = await getCurrentActor();
  if (!actor) return { ok: false as const, message: "Sign in to submit this assignment." };

  try {
    await failSubmissionUpload(actor, parsed.data);
    return { ok: true as const };
  } catch {
    return { ok: false as const, ...UPLOAD_FAILURE };
  }
}

/**
 * The client-safe shape of `SubmissionAssignmentView` — dates converted to
 * ISO strings before crossing into `AssignmentSubmissionPanel`'s props,
 * matching `learner-quiz-service.ts`'s `availableFrom`/`availableUntil`
 * convention rather than relying on Flight's own Date passthrough.
 */
export type AssignmentSubmissionClientView = {
  assessmentId: string;
  enrolmentId: string;
  title: string;
  instructions: string | null;
  dueAt: string | null;
  availableUntil: string | null;
  allowedFileTypes: string[];
  maxFileSizeBytes: number | null;
  allowResubmission: boolean;
  submissions: Array<{
    submissionId: string;
    receiptId: string;
    attemptNumber: number;
    filename: string;
    sizeBytes: number;
    submittedAt: string;
    isLate: boolean;
    uploadStatus: "UPLOADING" | "READY" | "ERROR";
  }>;
};

/**
 * The panel's pre-submit view-builder (ASM-03) — a plain async function, not
 * an action, called directly from the Server Component page the same way
 * `loadLearnerQuiz` is. Returns `null` for a signed-out caller, an
 * unpublished/non-Assignment assessment, or an actor with no covering
 * enrolment — the page must not render the panel at all in that case.
 */
export async function loadAssignmentSubmissionView(
  input: { assessmentId: string; enrolmentId: string },
): Promise<AssignmentSubmissionClientView | null> {
  const actor = await getCurrentActor();
  if (!actor) return null;

  const view = await getOwnAssignmentView(actor, input);
  if (!view) return null;

  return {
    assessmentId: view.assessmentId,
    enrolmentId: input.enrolmentId,
    title: view.title,
    // Sanitised here, server-side, with the SAME allow-list `LessonContent`'s
    // `BodyProse` uses (T-10-34) — the client panel renders this string
    // as-is, never re-sanitising (and never bundling `sanitize-html`) client-side.
    instructions: view.instructions ? sanitizeLessonBody(view.instructions) : null,
    dueAt: view.dueAt?.toISOString() ?? null,
    availableUntil: view.availableUntil?.toISOString() ?? null,
    allowedFileTypes: view.allowedFileTypes,
    maxFileSizeBytes: view.maxFileSizeBytes,
    allowResubmission: view.allowResubmission,
    submissions: view.submissions.map((s) => ({
      submissionId: s.submissionId,
      receiptId: s.receiptId,
      attemptNumber: s.attemptNumber,
      filename: s.filename,
      sizeBytes: s.sizeBytes,
      submittedAt: s.submittedAt.toISOString(),
      isLate: s.isLate,
      uploadStatus: s.uploadStatus,
    })),
  };
}
