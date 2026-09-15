"use server";

/**
 * The grade-entry screen's Server Actions (ASM-05, ASM-06, D-07).
 *
 * Every export here is a public POST endpoint (Next.js "Server Functions"
 * guide, `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md`)
 * — the Origin/Host CSRF check is not authorization. Each action zod-parses
 * its input and delegates straight to `grading-service.ts` (plan 10-07) or
 * `grade-override-service.ts` (plan 10-09): NO score/reason validation
 * happens here beyond the zod boundary itself. `cohortId`/`assessmentId`
 * ride along purely for `revalidatePath` targeting — mirroring
 * `enrolment-actions.ts`'s and `attendance-actions.ts`'s D-10 convention —
 * every mutation re-resolves its OWN scope from the submission/grade row
 * (T-10-23), never from these two values.
 *
 * The override schema's `reason` requires at least 10 trimmed characters —
 * the SAME `minReasonLength={10}` the confirmation modal enforces and the
 * SAME floor `grade-override-service.ts`'s own `OverrideReasonRequiredError`
 * check applies. Three independent gates (modal, this zod schema, the
 * service) is deliberate: the modal guards the ordinary path, this schema
 * guards a client that skips the modal, and the service guards a caller
 * that skips this action entirely.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import {
  saveDraftGrade,
  releaseGrade,
  GradeAlreadyReleasedError,
  GradeNotFoundError,
  InvalidScoreError,
  type GradeRow,
} from "@/server/services/grading-service";
import {
  overrideGrade,
  GradeNotReleasedError,
  OverrideReasonRequiredError,
  GradeChangedError,
  type GradeOverrideResult,
} from "@/server/services/grade-override-service";

export type GradeActionResult =
  | { ok: true; grade: GradeRow }
  | { ok: false; message: string };

export type OverrideActionResult =
  | { ok: true; result: GradeOverrideResult }
  | { ok: false; message: string; field?: "reason" };

function revalidateGradeEntry(cohortId: string, assessmentId: string, submissionId: string): void {
  revalidatePath(`/staff/cohorts/${cohortId}/grading/${assessmentId}/${submissionId}`, "page");
  revalidatePath(`/staff/cohorts/${cohortId}/grading/${assessmentId}`, "page");
  revalidatePath(`/staff/cohorts/${cohortId}`, "layout");
}

// ---------------------------------------------------------------------------
// saveDraftGradeAction
// ---------------------------------------------------------------------------

const saveDraftSchema = z
  .object({
    cohortId: z.string().min(1), // revalidation only — the service re-resolves scope from submissionId
    assessmentId: z.string().min(1), // revalidation only
    submissionId: z.string().min(1),
    score: z.number().int(),
    feedback: z.string().trim().max(4000).nullable(),
  })
  .strict();

export async function saveDraftGradeAction(
  input: z.input<typeof saveDraftSchema>,
): Promise<GradeActionResult> {
  const parsed = saveDraftSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "The score or feedback was invalid." };
  }
  try {
    const grade = await saveDraftGrade({
      submissionId: parsed.data.submissionId,
      score: parsed.data.score,
      feedback: parsed.data.feedback,
    });
    revalidateGradeEntry(parsed.data.cohortId, parsed.data.assessmentId, parsed.data.submissionId);
    return { ok: true, grade };
  } catch (error) {
    if (error instanceof GradeAlreadyReleasedError) {
      return {
        ok: false,
        message: "This grade has already been released and must be corrected through an override.",
      };
    }
    if (error instanceof InvalidScoreError) {
      return { ok: false, message: error.message };
    }
    if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
      return { ok: false, message: "Your role does not permit grading this submission." };
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// releaseGradeAction
// ---------------------------------------------------------------------------

const releaseSchema = z
  .object({
    cohortId: z.string().min(1), // revalidation only
    assessmentId: z.string().min(1), // revalidation only
    submissionId: z.string().min(1), // revalidation only
    gradeId: z.string().min(1),
  })
  .strict();

export async function releaseGradeAction(
  input: z.input<typeof releaseSchema>,
): Promise<GradeActionResult> {
  const parsed = releaseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "This grade could not be released." };
  }
  try {
    const grade = await releaseGrade({ gradeId: parsed.data.gradeId });
    revalidateGradeEntry(parsed.data.cohortId, parsed.data.assessmentId, parsed.data.submissionId);
    return { ok: true, grade };
  } catch (error) {
    if (error instanceof GradeNotFoundError) {
      return { ok: false, message: "This grade could not be found." };
    }
    if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
      return { ok: false, message: "Your role does not permit releasing this grade." };
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// overrideGradeAction — D-07, mandatory reason, RELEASED grades only
// ---------------------------------------------------------------------------

const overrideSchema = z
  .object({
    cohortId: z.string().min(1), // revalidation only
    assessmentId: z.string().min(1), // revalidation only
    submissionId: z.string().min(1), // revalidation only
    gradeId: z.string().min(1),
    newScore: z.number().int(),
    reason: z.string().trim().min(10, "Explain the correction using at least 10 characters."),
  })
  .strict();

export async function overrideGradeAction(
  input: z.input<typeof overrideSchema>,
): Promise<OverrideActionResult> {
  const parsed = overrideSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path[0] === "reason" ? ("reason" as const) : undefined;
    return { ok: false, message: issue?.message ?? "This override was invalid.", field };
  }
  try {
    const result = await overrideGrade({
      gradeId: parsed.data.gradeId,
      newScore: parsed.data.newScore,
      reason: parsed.data.reason,
    });
    revalidateGradeEntry(parsed.data.cohortId, parsed.data.assessmentId, parsed.data.submissionId);
    return { ok: true, result };
  } catch (error) {
    if (error instanceof OverrideReasonRequiredError) {
      return { ok: false, message: error.message, field: "reason" };
    }
    if (error instanceof GradeNotReleasedError) {
      return { ok: false, message: "Only a released grade can be corrected. Use Save on a draft grade." };
    }
    if (error instanceof GradeChangedError) {
      return { ok: false, message: error.message };
    }
    if (error instanceof RangeError) {
      return { ok: false, message: error.message };
    }
    if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
      return { ok: false, message: "Your role does not permit overriding this grade." };
    }
    throw error;
  }
}
