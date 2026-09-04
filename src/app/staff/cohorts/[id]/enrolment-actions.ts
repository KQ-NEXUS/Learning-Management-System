"use server";

/**
 * The five COH-05 enrolment-transition Server Actions — add, approve,
 * transfer, withdraw, cancel.
 *
 * Every export here is a public POST endpoint (Next.js "Server Functions"
 * guide, `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md`)
 * — the Origin/Host CSRF check is not authorization. Each action zod-validates
 * its input shape (including a mandatory 10-character reason, matching the
 * `EnrolmentActionModals` `minReasonLength: 10` contract) and delegates
 * straight to the plan-05-07 `enrolment-service`, which re-resolves the
 * enrolment's/cohort's own scope from the database and gates on
 * `enrolments.manage`. Nothing here re-implements that check, the transition
 * table, or the seat-accounting recipe.
 *
 * `cohortId` rides along on every schema purely for `revalidatePath`
 * targeting (mirrors `attendance-actions.ts`'s D-10 pattern) — the service
 * call itself never receives it for approve/transfer/withdraw/cancel; the
 * cohort scope is always re-resolved from `enrolmentId` by
 * `enrolmentCohortScope`.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { CapacityExceededError, AlreadyEnrolledError } from "@/server/services/seat-accounting";
import {
  addEnrolment,
  approveEnrolment,
  transferEnrolment,
  withdrawEnrolment,
  cancelEnrolment,
  IllegalTransitionError,
  CrossOfferTransferError,
  EnrolmentNotFoundError,
  ReasonRequiredError,
} from "@/server/services/enrolment-service";

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

export type EnrolmentActionResult =
  | { ok: true; enrolmentId: string }
  | { ok: true; sourceEnrolmentId: string; targetEnrolmentId: string }
  | { ok: false; message: string };

function toFailure(error: unknown): Extract<EnrolmentActionResult, { ok: false }> {
  if (error instanceof z.ZodError) {
    return { ok: false, message: error.issues[0]?.message ?? "The enrolment action was invalid." };
  }
  if (error instanceof CapacityExceededError) {
    return {
      ok: false,
      message:
        "This cohort is full. It reached capacity while you were working. " +
        "Raise capacity or withdraw an enrolment, then try again.",
    };
  }
  if (error instanceof AlreadyEnrolledError) {
    return {
      ok: false,
      message:
        "This learner already has an active enrolment in this cohort. " +
        "Open that enrolment to transfer or withdraw it.",
    };
  }
  if (error instanceof CrossOfferTransferError) {
    return {
      ok: false,
      message:
        "This enrolment can only be transferred to another cohort of the same course or programme.",
    };
  }
  if (error instanceof IllegalTransitionError) {
    return {
      ok: false,
      message: `This enrolment is currently ${error.from.toLowerCase()} and cannot be changed to ${error.to.toLowerCase()}.`,
    };
  }
  if (error instanceof ReasonRequiredError) {
    return { ok: false, message: "A reason is required." };
  }
  if (error instanceof EnrolmentNotFoundError) {
    return { ok: false, message: "This enrolment could not be found." };
  }
  if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
    return {
      ok: false,
      message: "Your role does not permit this action on this enrolment.",
    };
  }
  throw error;
}

function revalidateEnrolmentSurfaces(cohortId: string): void {
  // The `type` argument is deliberate — the same `publish-actions.ts:110-117`
  // / `session-actions.ts` lesson: a dynamic segment can silently no-op
  // without it.
  revalidatePath(`/staff/cohorts/${cohortId}`, "page");
  revalidatePath("/staff/enrolments", "page");
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const reasonSchema = z
  .string()
  .trim()
  .min(10, "Give a reason of at least 10 characters.")
  .max(500);

const addEnrolmentSchema = z
  .object({
    cohortId: z.string().min(1),
    userId: z.string().min(1),
    target: z.enum(["ACTIVE", "PENDING_PAYMENT"]),
    reason: reasonSchema,
  })
  .strict();

const approveEnrolmentSchema = z
  .object({
    cohortId: z.string().min(1), // revalidation only — the service re-resolves scope from enrolmentId
    enrolmentId: z.string().min(1),
    reason: reasonSchema,
  })
  .strict();

const transferEnrolmentSchema = z
  .object({
    cohortId: z.string().min(1), // revalidation only
    enrolmentId: z.string().min(1),
    targetCohortId: z.string().min(1),
    reason: reasonSchema,
  })
  .strict();

const terminalEnrolmentSchema = z
  .object({
    cohortId: z.string().min(1), // revalidation only
    enrolmentId: z.string().min(1),
    reason: reasonSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export async function addEnrolmentAction(
  input: z.input<typeof addEnrolmentSchema>,
): Promise<EnrolmentActionResult> {
  const parsed = addEnrolmentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "The enrolment details were invalid." };
  }
  try {
    const created = await addEnrolment({
      cohortId: parsed.data.cohortId,
      userId: parsed.data.userId,
      target: parsed.data.target,
      reason: parsed.data.reason,
    });
    revalidateEnrolmentSurfaces(parsed.data.cohortId);
    return { ok: true, enrolmentId: created.id };
  } catch (error) {
    return toFailure(error);
  }
}

export async function approveEnrolmentAction(
  input: z.input<typeof approveEnrolmentSchema>,
): Promise<EnrolmentActionResult> {
  const parsed = approveEnrolmentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "The enrolment details were invalid." };
  }
  try {
    const approved = await approveEnrolment({
      enrolmentId: parsed.data.enrolmentId,
      reason: parsed.data.reason,
    });
    revalidateEnrolmentSurfaces(parsed.data.cohortId);
    return { ok: true, enrolmentId: approved.id };
  } catch (error) {
    return toFailure(error);
  }
}

export async function transferEnrolmentAction(
  input: z.input<typeof transferEnrolmentSchema>,
): Promise<EnrolmentActionResult> {
  const parsed = transferEnrolmentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "The enrolment details were invalid." };
  }
  try {
    const transferred = await transferEnrolment({
      enrolmentId: parsed.data.enrolmentId,
      targetCohortId: parsed.data.targetCohortId,
      reason: parsed.data.reason,
    });
    revalidateEnrolmentSurfaces(parsed.data.cohortId);
    revalidateEnrolmentSurfaces(parsed.data.targetCohortId);
    return {
      ok: true,
      sourceEnrolmentId: transferred.sourceEnrolmentId,
      targetEnrolmentId: transferred.targetEnrolmentId,
    };
  } catch (error) {
    return toFailure(error);
  }
}

export async function withdrawEnrolmentAction(
  input: z.input<typeof terminalEnrolmentSchema>,
): Promise<EnrolmentActionResult> {
  const parsed = terminalEnrolmentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "The enrolment details were invalid." };
  }
  try {
    const withdrawn = await withdrawEnrolment({
      enrolmentId: parsed.data.enrolmentId,
      reason: parsed.data.reason,
    });
    revalidateEnrolmentSurfaces(parsed.data.cohortId);
    return { ok: true, enrolmentId: withdrawn.id };
  } catch (error) {
    return toFailure(error);
  }
}

export async function cancelEnrolmentAction(
  input: z.input<typeof terminalEnrolmentSchema>,
): Promise<EnrolmentActionResult> {
  const parsed = terminalEnrolmentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "The enrolment details were invalid." };
  }
  try {
    const cancelled = await cancelEnrolment({
      enrolmentId: parsed.data.enrolmentId,
      reason: parsed.data.reason,
    });
    revalidateEnrolmentSurfaces(parsed.data.cohortId);
    return { ok: true, enrolmentId: cancelled.id };
  } catch (error) {
    return toFailure(error);
  }
}
