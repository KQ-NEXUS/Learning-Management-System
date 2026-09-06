"use server";

/**
 * The cohort detail page's publish / cancel Server Actions (COH-04, COH-05, D-31).
 *
 * Every export here is a public POST endpoint (Next.js "Server Functions"
 * guide) — the Origin/Host CSRF check is not authorization. Each action
 * validates its input shape with `zod` and delegates straight to
 * `publishCohort` / `cancelCohort` (`cohort-service.ts`), which re-resolve
 * the cohort's scope from the row and gate on the right permission. The
 * rendered controls in `CohortDetailActions` hide a button the viewer
 * cannot use, but that is a courtesy — these actions refuse regardless
 * (T-05-99, T-05-100).
 *
 * D-27 / T-05-103: this file does NOT evaluate readiness itself — only
 * `publishCohort` does, by calling the one shared pure evaluator declared in
 * `readiness-service.ts`. A second copy of the rules here would let the
 * panel and the server-side refusal drift apart. `CohortReadinessRefusedError`
 * already carries the failing items evaluated server-side; this file only
 * maps them to display copy.
 *
 * `expectedUpdatedAt` is carried as an ISO string with millisecond
 * precision and parsed to a `Date` — `toISOString()` truncation is exactly
 * why `reorder-service.ts:74-82` warns about round-tripping this value
 * through anything less precise (T-05-102).
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { StaleOrderError } from "@/server/services/reorder-service";
import { CohortClosedError } from "@/server/services/seat-accounting";
import { ReasonRequiredError } from "@/server/services/enrolment-service";
import type { ReadinessItem } from "@/server/services/readiness-service";
import {
  publishCohort,
  cancelCohort,
  CohortReadinessRefusedError,
  NoPublishedOfferError,
  CohortCancelBlockedError,
} from "@/server/services/cohort-service";

// ---------------------------------------------------------------------------
// Result shapes — discriminated so the UI can name what refused it.
// ---------------------------------------------------------------------------

type CommonFailure =
  | { ok: false; reason: "NOT_READY"; message: string; failures: ReadinessItem[] }
  | { ok: false; reason: "NO_OFFER"; message: string }
  | { ok: false; reason: "STALE"; message: string }
  | { ok: false; reason: "ALREADY_CANCELLED"; message: string }
  | { ok: false; reason: "REASON_REQUIRED"; message: string }
  | { ok: false; reason: "DENIED"; message: string }
  | { ok: false; reason: "INVALID"; message: string };

export type PublishCohortActionResult =
  | { ok: true; status: string; publicationId: string | null }
  | CommonFailure;

export type CancelCohortActionResult =
  | {
      ok: true;
      status: string;
      withdrawnCount: number;
      cancelledCount: number;
      sessionsCancelled: number;
    }
  | CommonFailure;

// ---------------------------------------------------------------------------
// Error -> result mapping. An authz failure is one generic line — never one
// that distinguishes "no such cohort" from "not yours" (T-05-101).
// ---------------------------------------------------------------------------

function toFailure(error: unknown): CommonFailure {
  if (error instanceof CohortClosedError) {
    return { ok: false, reason: "INVALID", message: error.message };
  }
  if (error instanceof CohortReadinessRefusedError) {
    const n = error.failures.length;
    return {
      ok: false,
      reason: "NOT_READY",
      message: `This cohort has ${n} check${n === 1 ? "" : "s"} that must pass before it can be published. See Publication readiness below.`,
      failures: error.failures,
    };
  }
  if (error instanceof NoPublishedOfferError) {
    return {
      ok: false,
      reason: "NO_OFFER",
      message:
        "This cohort must be pinned to a published course or programme first. " +
        error.message,
    };
  }
  if (error instanceof StaleOrderError) {
    return {
      ok: false,
      reason: "STALE",
      message:
        "Someone else changed this cohort while you had it open. Reload to see their version, " +
        "then reapply your changes.",
    };
  }
  if (error instanceof CohortCancelBlockedError) {
    return {
      ok: false,
      reason: "ALREADY_CANCELLED",
      message: "This cohort is already cancelled.",
    };
  }
  if (error instanceof ReasonRequiredError) {
    return { ok: false, reason: "REASON_REQUIRED", message: "A reason is required." };
  }
  if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
    return {
      ok: false,
      reason: "DENIED",
      message: "Your role does not permit this action on this cohort.",
    };
  }
  throw error;
}

function revalidateCohort(cohortId: string): void {
  revalidatePath("/staff/cohorts", "page");
  revalidatePath(`/staff/cohorts/${cohortId}`, "page");
  revalidatePath("/staff/enrolments", "page");
}

/**
 * An ISO string parsed to a `Date` with millisecond precision preserved —
 * never truncated through a lossier round trip (T-05-102).
 */
function parseExpectedUpdatedAt(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// ---------------------------------------------------------------------------
// publishCohortAction
// ---------------------------------------------------------------------------

const publishSchema = z
  .object({
    cohortId: z.string().min(1),
    expectedUpdatedAt: z.string().min(1),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export async function publishCohortAction(
  input: z.input<typeof publishSchema>,
): Promise<PublishCohortActionResult> {
  const parsed = publishSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "INVALID", message: "The publish request was malformed." };
  }
  const expectedUpdatedAt = parseExpectedUpdatedAt(parsed.data.expectedUpdatedAt);
  if (!expectedUpdatedAt) {
    return { ok: false, reason: "STALE", message: "Reload the page and try again." };
  }

  try {
    // T-05-99 / T-05-103: the gate lives in `publishCohort`, which evaluates
    // readiness itself, server-side, from the same pure evaluator the panel
    // renders — never a second copy of the rules here.
    const result = await publishCohort({
      cohortId: parsed.data.cohortId,
      expectedUpdatedAt,
      reason: parsed.data.reason,
    });
    revalidateCohort(parsed.data.cohortId);
    return { ok: true, status: result.status, publicationId: result.publicationId };
  } catch (error) {
    return toFailure(error);
  }
}

// ---------------------------------------------------------------------------
// cancelCohortAction
// ---------------------------------------------------------------------------

const cancelSchema = z
  .object({
    cohortId: z.string().min(1),
    expectedUpdatedAt: z.string().min(1),
    reason: z.string().trim().min(10).max(500),
  })
  .strict();

export async function cancelCohortAction(
  input: z.input<typeof cancelSchema>,
): Promise<CancelCohortActionResult> {
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "REASON_REQUIRED",
      message: "Give a reason of at least 10 characters.",
    };
  }
  const expectedUpdatedAt = parseExpectedUpdatedAt(parsed.data.expectedUpdatedAt);
  if (!expectedUpdatedAt) {
    return { ok: false, reason: "STALE", message: "Reload the page and try again." };
  }

  try {
    const result = await cancelCohort({
      cohortId: parsed.data.cohortId,
      reason: parsed.data.reason,
      expectedUpdatedAt,
    });
    revalidateCohort(parsed.data.cohortId);
    return {
      ok: true,
      status: result.status,
      withdrawnCount: result.withdrawnCount,
      cancelledCount: result.cancelledCount,
      sessionsCancelled: result.sessionsCancelled,
    };
  } catch (error) {
    return toFailure(error);
  }
}
