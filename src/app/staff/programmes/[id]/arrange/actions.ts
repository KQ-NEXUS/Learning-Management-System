"use server";

/**
 * The Programme composition screen's Server Actions.
 *
 * Same shape and stale-handling as the course arrange actions
 * (`src/app/staff/courses/[id]/arrange/actions.ts`). Positions are never
 * written from here — `addCourseToProgramme` computes its own and the
 * transactional renumber lives in `reorder-service.ts`. Nothing in this folder
 * reaches the database except through a service.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import {
  commitProgrammeCourseOrder,
  parseOrderToken,
  serialiseOrderToken,
  ArrangementMismatchError,
  StaleOrderError,
} from "@/server/services/reorder-service";
import {
  addCourseToProgramme,
  removeCourseFromProgramme,
  DuplicateMembershipError,
  MembershipNotFoundError,
  programmeService,
} from "@/server/services/programme-service";

export type MembershipActionResult = { ok: true } | { ok: false; reason: "DUPLICATE" | "DENIED" | "INVALID" | "NOT_FOUND"; message: string };

export type OrderActionResult =
  | { ok: true; token: string }
  | { ok: false; reason: "STALE" | "MISMATCH" | "DENIED"; message: string };

function revalidateProgramme(programmeId: string): void {
  revalidatePath(`/staff/programmes/${programmeId}/arrange`);
  revalidatePath(`/staff/programmes/${programmeId}`);
}

/** A freshly serialised D-23 token so the client can save again without a reload. */
async function freshToken(programmeId: string): Promise<string> {
  const programme = (await programmeService.get(programmeId)) as unknown as {
    updatedAt: Date;
  } | null;
  if (!programme) throw new ArrangementMismatchError();
  return serialiseOrderToken(programme.updatedAt);
}

function toOrderFailure(error: unknown): Extract<OrderActionResult, { ok: false }> {
  if (error instanceof StaleOrderError) {
    return {
      ok: false,
      reason: "STALE",
      message:
        "Someone else changed this programme while you were working. Reload to pick up the current order, then reapply your change.",
    };
  }
  if (error instanceof ArrangementMismatchError) {
    return {
      ok: false,
      reason: "MISMATCH",
      message: "This arrangement no longer matches the programme's current courses. Reload and try again.",
    };
  }
  if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
    return { ok: false, reason: "DENIED", message: "Your role does not permit composing this programme." };
  }
  throw error;
}

function toMembershipFailure(error: unknown): Extract<MembershipActionResult, { ok: false }> {
  if (error instanceof DuplicateMembershipError) {
    return { ok: false, reason: "DUPLICATE", message: "That course is already in this programme." };
  }
  if (error instanceof MembershipNotFoundError) {
    return { ok: false, reason: "NOT_FOUND", message: "That course is not in this programme." };
  }
  if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
    return { ok: false, reason: "DENIED", message: "Your role does not permit composing this programme." };
  }
  if (error instanceof z.ZodError) {
    return { ok: false, reason: "INVALID", message: "The request was malformed." };
  }
  throw error;
}

const orderSchema = z
  .object({
    programmeId: z.string().min(1),
    token: z.string().min(1),
    membershipIds: z.array(z.string().min(1)),
  })
  .strict();

export async function saveProgrammeCourseOrderAction(
  input: z.input<typeof orderSchema>,
): Promise<OrderActionResult> {
  try {
    const parsed = orderSchema.parse(input);
    await commitProgrammeCourseOrder({
      programmeId: parsed.programmeId,
      expectedUpdatedAt: parseOrderToken(parsed.token),
      programmeCourseIds: parsed.membershipIds,
    });
    revalidateProgramme(parsed.programmeId);
    return { ok: true, token: await freshToken(parsed.programmeId) };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { ok: false, reason: "MISMATCH", message: "The request was malformed." };
    }
    return toOrderFailure(error);
  }
}

const membershipSchema = z
  .object({ programmeId: z.string().min(1), courseId: z.string().min(1) })
  .strict();

export async function addCourseAction(
  input: z.input<typeof membershipSchema>,
): Promise<MembershipActionResult> {
  try {
    const parsed = membershipSchema.parse(input);
    await addCourseToProgramme(parsed);
    revalidateProgramme(parsed.programmeId);
    return { ok: true };
  } catch (error) {
    return toMembershipFailure(error);
  }
}

export async function removeCourseAction(
  input: z.input<typeof membershipSchema>,
): Promise<MembershipActionResult> {
  try {
    const parsed = membershipSchema.parse(input);
    await removeCourseFromProgramme(parsed);
    revalidateProgramme(parsed.programmeId);
    return { ok: true };
  } catch (error) {
    return toMembershipFailure(error);
  }
}
