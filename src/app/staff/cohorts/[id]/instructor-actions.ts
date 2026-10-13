"use server";

/**
 * The cohort Overview tab's instructor-assignment Server Actions (D-27).
 *
 * Before this file, nothing in the app could ever write a `CohortInstructor`
 * row except `prisma/seed.ts` — the readiness panel's "Instructors" check
 * had a reader (`cohort-service.ts`'s aggregate) but no writer, so a
 * staff-created instructor-led/blended cohort could never be published.
 *
 * Follows the `session-actions.ts` shape: zod-validate, delegate to the
 * permission-gated service, map its errors to UI copy, revalidate the
 * cohort page. A user is picked by id (the same "id, not a search picker"
 * escape hatch `SessionFormFields`'s Facilitator field and the roster tab's
 * Transfer/Add-enrolment modals already use in this phase) — an id can be
 * found via `/staff/users`.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthenticationError, AuthorizationError, refusalMessage } from "@/server/permissions";
import {
  assignCohortInstructor,
  removeCohortInstructor,
  InstructorUserNotFoundError,
  InstructorNotStaffError,
} from "@/server/services/cohort-service";
import { listInstructorCandidates } from "@/server/services/instructor-candidate-service";

export type InstructorActionResult =
  | { ok: true }
  | { ok: false; message: string };

function toFailure(error: unknown): Extract<InstructorActionResult, { ok: false }> {
  if (error instanceof z.ZodError) {
    return { ok: false, message: error.issues[0]?.message ?? "Enter a valid user id." };
  }
  if (error instanceof InstructorUserNotFoundError) {
    return { ok: false, message: "No user with that id exists." };
  }
  if (error instanceof InstructorNotStaffError) {
    return { ok: false, message: error.message };
  }
  if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
    return {
      ok: false,
      message: refusalMessage(error, "Your role does not permit managing instructors for this cohort."),
    };
  }
  throw error;
}

function revalidateCohort(cohortId: string): void {
  revalidatePath(`/staff/cohorts/${cohortId}`, "page");
}

const candidatesSchema = z
  .object({
    cohortId: z.string().min(1),
    query: z.string().max(100).optional(),
  })
  .strict();

export type InstructorCandidateOption = { id: string; name: string; email: string; roles: string[]; assigned: boolean };

/**
 * The staff who can be offered as an instructor for this cohort, for the picker that replaced the
 * typed user id. Gated in the service by `cohorts.manage` on the cohort, like the assignment itself.
 */
export async function listInstructorCandidatesAction(
  input: z.input<typeof candidatesSchema>,
): Promise<{ ok: true; people: InstructorCandidateOption[] } | { ok: false; message: string }> {
  const parsed = candidatesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "The list could not be loaded." };
  try {
    return { ok: true, people: await listInstructorCandidates(parsed.data) };
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
      return { ok: false, message: refusalMessage(error, "Your role does not permit managing instructors for this cohort.") };
    }
    throw error;
  }
}

const schema = z
  .object({
    cohortId: z.string().min(1),
    userId: z.string().trim().min(1, "Enter a user id."),
  })
  .strict();

export async function assignInstructorAction(
  input: z.input<typeof schema>,
): Promise<InstructorActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Enter a valid user id." };
  }
  try {
    await assignCohortInstructor(parsed.data);
    revalidateCohort(parsed.data.cohortId);
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}

export async function removeInstructorAction(
  input: z.input<typeof schema>,
): Promise<InstructorActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Enter a valid user id." };
  }
  try {
    await removeCohortInstructor(parsed.data);
    revalidateCohort(parsed.data.cohortId);
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}
