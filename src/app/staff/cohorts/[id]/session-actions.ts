"use server";

/**
 * The cohort Sessions tab's Server Actions (COH-03).
 *
 * Every export here is a public POST endpoint (Next.js "Server Functions"
 * guide, `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md`)
 * — the Origin/Host CSRF check is not authorization. Each action zod-validates
 * its input and delegates to the plan-05-06 `scheduled-session-service`,
 * which re-resolves the session's/cohort's own scope from the database and
 * gates on `cohorts.manage`. Nothing here re-implements that check.
 *
 * The date/time inputs are a plain date plus start/end time strings, entered
 * in the cohort's own timezone — this file never computes a UTC instant
 * itself. `createSessionFromWallTime` / `repeatWeeklySessions` do that
 * conversion server-side via `wallTimeToUtc` (D-23), which is exactly why a
 * client-computed instant would be wrong: the browser's local zone has
 * nothing to do with the cohort's declared one.
 *
 * Revalidation follows the `publish-actions.ts:110-117` lesson: a resolved
 * path like `/staff/cohorts/${cohortId}` does not strictly need the `type`
 * argument, but passing it is deliberate and cheap insurance — a lesson this
 * codebase already paid for once (a dynamic segment silently no-op'd without
 * it).
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { StaleOrderError } from "@/server/services/reorder-service";
import {
  createSessionFromWallTime,
  repeatWeeklySessions,
  cancelSession,
  InvalidTimeZoneError,
  SessionCourseNotInCohortError,
  SessionTimeRangeError,
  ReasonRequiredError,
  RepeatOccurrencesError,
  SessionNotFoundError,
} from "@/server/services/scheduled-session-service";

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

export type SessionActionResult =
  | { ok: true; sessionId: string }
  | { ok: true; sessionIds: string[] }
  | { ok: false; message: string };

function toFailure(error: unknown): Extract<SessionActionResult, { ok: false }> {
  if (error instanceof z.ZodError) {
    return { ok: false, message: error.issues[0]?.message ?? "The session details were invalid." };
  }
  if (error instanceof SessionCourseNotInCohortError) {
    return { ok: false, message: error.message };
  }
  if (error instanceof InvalidTimeZoneError) {
    return { ok: false, message: error.message };
  }
  if (error instanceof SessionTimeRangeError) {
    return { ok: false, message: error.message };
  }
  if (error instanceof RepeatOccurrencesError) {
    return { ok: false, message: error.message };
  }
  if (error instanceof ReasonRequiredError) {
    return { ok: false, message: "A reason is required to cancel a session." };
  }
  if (error instanceof SessionNotFoundError) {
    return { ok: false, message: "This session could not be found." };
  }
  if (error instanceof StaleOrderError) {
    return {
      ok: false,
      message: "Someone else changed this cohort while you were working. Reload and try again.",
    };
  }
  if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
    return {
      ok: false,
      message: "Your role does not permit scheduling sessions for this cohort.",
    };
  }
  throw error;
}

function revalidateCohort(cohortId: string): void {
  // The `type` argument is deliberate — see the file header note.
  revalidatePath(`/staff/cohorts/${cohortId}`, "page");
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const sessionFieldsSchema = z
  .object({
    cohortId: z.string().min(1),
    title: z.string().trim().min(1, "Enter a session title.").max(200),
    date: z.string().trim().min(1, "Choose a date."),
    startTime: z.string().trim().min(1, "Choose a start time."),
    endTime: z.string().trim().min(1, "Choose an end time."),
    location: z.string().trim().max(200).optional(),
    meetingUrl: z.string().trim().max(500).optional(),
    linkVisibleFromMinutes: z.coerce.number().int().min(0).optional(),
    facilitatorId: z.string().trim().optional(),
    attendanceExpected: z.boolean().optional(),
    // D-24 — a session on a Programme cohort may optionally tag a member
    // Course. The service refuses this on a standalone-Course cohort or a
    // non-member id (SessionCourseNotInCohortError).
    courseId: z.string().trim().optional(),
  })
  .strict();

const repeatWeeklySchema = sessionFieldsSchema
  .extend({
    // T-05-90 — bounded 1-52 both here and in the service.
    occurrences: z.coerce
      .number()
      .int("Enter a whole number of occurrences.")
      .min(1, "Create at least 1 session.")
      .max(52, "Create at most 52 sessions."),
  })
  .strict();

const cancelSchema = z
  .object({
    sessionId: z.string().min(1),
    reason: z.string().trim().min(10, "Give a reason of at least 10 characters.").max(500),
  })
  .strict();

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export async function createSessionAction(
  input: z.input<typeof sessionFieldsSchema>,
): Promise<SessionActionResult> {
  const parsed = sessionFieldsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "The session details were invalid." };
  }
  try {
    const created = await createSessionFromWallTime(parsed.data);
    revalidateCohort(parsed.data.cohortId);
    return { ok: true, sessionId: created.id };
  } catch (error) {
    return toFailure(error);
  }
}

export async function repeatWeeklyAction(
  input: z.input<typeof repeatWeeklySchema>,
): Promise<SessionActionResult> {
  const parsed = repeatWeeklySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "The session details were invalid." };
  }
  try {
    const created = await repeatWeeklySessions(parsed.data);
    revalidateCohort(parsed.data.cohortId);
    return { ok: true, sessionIds: created.map((row) => row.id) };
  } catch (error) {
    return toFailure(error);
  }
}

export async function cancelSessionAction(
  input: z.input<typeof cancelSchema>,
): Promise<SessionActionResult> {
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Give a reason of at least 10 characters.",
    };
  }
  try {
    const cancelled = await cancelSession({
      sessionId: parsed.data.sessionId,
      reason: parsed.data.reason,
    });
    revalidateCohort(cancelled.cohortId);
    return { ok: true, sessionId: cancelled.id };
  } catch (error) {
    return toFailure(error);
  }
}
