"use server";

/**
 * The attendance-marking screen's Server Actions (ATT-01, ATT-03).
 *
 * Every export here is a public POST endpoint (Next.js "Server Functions"
 * guide, `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md`)
 * — the Origin/Host CSRF check is not authorization. Both actions
 * zod-validate the shape of their input and delegate straight to the plan
 * 05-08 `attendance-service`: NO roster lookup and NO timing check happens
 * in this file. A check written here could be bypassed by a direct POST
 * that skips the client entirely; the service's checks cannot be, because
 * they run inside `withPermission` against data resolved from the database
 * (T-05-83, T-05-84).
 *
 * `saveAttendanceAction` is the bulk "commit once" path used while the
 * marking window is open. `correctAttendanceAction` is the single-learner,
 * mandatory-reason path used once the window has closed (ATT-03) — the
 * marking screen calls it once per changed learner rather than batching,
 * so each correction carries its own reason in the audit trail.
 *
 * Error mapping intentionally never echoes a rejected id back to the
 * client (T-05-87): `LearnerNotOnRosterError` becomes one generic
 * "reload and try again" line regardless of which id was rejected or why.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import {
  saveSessionAttendance,
  markAttendance,
  PreMarkingStateError,
  CorrectionReasonRequiredError,
  LearnerNotOnRosterError,
  SessionNotFoundError,
  SessionCancelledError,
} from "@/server/services/attendance-service";

const ATTENDANCE_STATES = ["PRESENT", "ABSENT", "LATE", "EXCUSED", "NOT_RECORDED"] as const;

export type AttendanceActionResult = { ok: true } | { ok: false; message: string };

function toFailure(error: unknown): Extract<AttendanceActionResult, { ok: false }> {
  if (error instanceof z.ZodError) {
    return { ok: false, message: error.issues[0]?.message ?? "The attendance change was invalid." };
  }
  if (error instanceof PreMarkingStateError) {
    return {
      ok: false,
      message:
        "You can only mark excused or not-recorded before the session starts. " +
        "Present, absent and late need the session to have begun.",
    };
  }
  if (error instanceof CorrectionReasonRequiredError) {
    return { ok: false, message: error.message };
  }
  if (error instanceof LearnerNotOnRosterError) {
    // Never echo the offending id or the reason it was rejected (T-05-87) —
    // a leading id from another cohort must not be confirmable this way.
    return { ok: false, message: "This register changed. Reload and try again." };
  }
  if (error instanceof SessionNotFoundError) {
    return { ok: false, message: "This session could not be found." };
  }
  if (error instanceof SessionCancelledError) {
    return { ok: false, message: "This session was cancelled and can no longer take attendance." };
  }
  if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
    return {
      ok: false,
      message: "Your role does not permit marking attendance for this session.",
    };
  }
  throw error;
}

function revalidateAttendance(cohortId: string, sessionId: string): void {
  revalidatePath(`/staff/cohorts/${cohortId}/sessions/${sessionId}/attendance`, "page");
  revalidatePath(`/staff/cohorts/${cohortId}`, "page");
}

// ---------------------------------------------------------------------------
// saveAttendanceAction — bulk, commit-once (ATT-01)
// ---------------------------------------------------------------------------

const bulkEntrySchema = z
  .object({
    enrolmentId: z.string().min(1),
    state: z.enum(ATTENDANCE_STATES),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

const bulkSchema = z
  .object({
    // Carried only for revalidation — the service resolves the roster from
    // the session's own cohortId, never from this value (D-10).
    cohortId: z.string().min(1),
    sessionId: z.string().min(1),
    entries: z.array(bulkEntrySchema).min(1),
  })
  .strict();

export async function saveAttendanceAction(
  input: z.input<typeof bulkSchema>,
): Promise<AttendanceActionResult> {
  const parsed = bulkSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "The attendance changes were invalid.",
    };
  }
  try {
    await saveSessionAttendance({
      sessionId: parsed.data.sessionId,
      entries: parsed.data.entries,
    });
    revalidateAttendance(parsed.data.cohortId, parsed.data.sessionId);
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}

// ---------------------------------------------------------------------------
// correctAttendanceAction — single learner, mandatory reason (ATT-03)
// ---------------------------------------------------------------------------

const correctionSchema = z
  .object({
    cohortId: z.string().min(1),
    sessionId: z.string().min(1),
    enrolmentId: z.string().min(1),
    state: z.enum(ATTENDANCE_STATES),
    note: z.string().trim().max(500).optional(),
    reason: z.string().trim().min(10, "Give a reason of at least 10 characters.").max(500),
  })
  .strict();

export async function correctAttendanceAction(
  input: z.input<typeof correctionSchema>,
): Promise<AttendanceActionResult> {
  const parsed = correctionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Give a reason of at least 10 characters.",
    };
  }
  try {
    await markAttendance({
      sessionId: parsed.data.sessionId,
      enrolmentId: parsed.data.enrolmentId,
      state: parsed.data.state,
      note: parsed.data.note,
      reason: parsed.data.reason,
    });
    revalidateAttendance(parsed.data.cohortId, parsed.data.sessionId);
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}
