"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { courseService } from "@/server/services/course-service";
import { createModule, moduleService } from "@/server/services/module-service";
import { lessonService } from "@/server/services/lesson-service";
import {
  ArrangementMismatchError,
  commitLessonOrder,
  commitModuleOrder,
  parseOrderToken,
  serialiseOrderToken,
  StaleOrderError,
} from "@/server/services/reorder-service";

/**
 * The arrange screen's Server Actions.
 *
 * Every export here is a public POST endpoint (Next.js "Server Actions" guide)
 * — the `Origin`/`Host` CSRF check is NOT authorization. So each action:
 *   1. validates its input shape with `zod` (`.strict()` rejects extras —
 *      most importantly a client-supplied `position`, T-04-36b), then
 *   2. delegates to a service in `src/server/services/**`, which re-resolves
 *      the Course scope from the row and gates on `courses.edit`.
 *
 * Positions are NEVER written from here — `createModule` computes its own
 * (plan 04-04 `<position_rule>`) and the transactional renumber lives in
 * `reorder-service.ts`. This folder imports no `@prisma/client`.
 */

export type ModuleActionResult = { ok: true } | { ok: false; message: string };

export type OrderActionResult =
  | { ok: true; token: string }
  | { ok: false; reason: "STALE" | "MISMATCH" | "DENIED"; message: string };

function revalidateCourse(courseId: string): void {
  revalidatePath(`/staff/courses/${courseId}/arrange`);
  revalidatePath(`/staff/courses/${courseId}`);
}

/** Maps a thrown service error onto the discriminated order result. */
function toOrderFailure(error: unknown): Extract<OrderActionResult, { ok: false }> {
  if (error instanceof StaleOrderError) {
    return {
      ok: false,
      reason: "STALE",
      // D-23: the loser is told plainly and offered a reload.
      message:
        "Someone else reordered this course while you were working. Reload to pick up the current order, then reapply your change.",
    };
  }
  if (error instanceof ArrangementMismatchError) {
    return {
      ok: false,
      reason: "MISMATCH",
      message:
        "This arrangement no longer matches the course's live lessons. Reload and try again.",
    };
  }
  if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
    return {
      ok: false,
      reason: "DENIED",
      message: "Your role does not permit changing this course's structure.",
    };
  }
  throw error;
}

function toModuleFailure(error: unknown): Extract<ModuleActionResult, { ok: false }> {
  if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
    return { ok: false, message: "Your role does not permit editing this course." };
  }
  if (error instanceof z.ZodError) {
    return { ok: false, message: error.issues[0]?.message ?? "That is not valid." };
  }
  throw error;
}

/** A freshly serialised D-23 token so the client can save again without a reload. */
async function freshToken(courseId: string): Promise<string> {
  const course = (await courseService.get(courseId)) as unknown as {
    updatedAt: Date;
  } | null;
  if (!course) throw new ArrangementMismatchError();
  return serialiseOrderToken(course.updatedAt);
}

// ---------------------------------------------------------------------------
// Module creation & rename — the phase's ONLY Module creation path.
// ---------------------------------------------------------------------------

const createModuleSchema = z
  .object({
    courseId: z.string().min(1),
    title: z.string().trim().min(1).max(200),
    summary: z.string().trim().max(2000).optional(),
  })
  .strict();

export async function createModuleAction(
  input: z.input<typeof createModuleSchema>,
): Promise<ModuleActionResult> {
  try {
    const parsed = createModuleSchema.parse(input);
    await createModule(parsed);
    revalidateCourse(parsed.courseId);
    return { ok: true };
  } catch (error) {
    return toModuleFailure(error);
  }
}

const renameModuleSchema = z
  .object({
    courseId: z.string().min(1),
    moduleId: z.string().min(1),
    title: z.string().trim().min(1).max(200),
  })
  .strict();

export async function renameModuleAction(
  input: z.input<typeof renameModuleSchema>,
): Promise<ModuleActionResult> {
  try {
    const parsed = renameModuleSchema.parse(input);
    await moduleService.update(parsed.moduleId, { title: parsed.title });
    revalidateCourse(parsed.courseId);
    return { ok: true };
  } catch (error) {
    return toModuleFailure(error);
  }
}

// ---------------------------------------------------------------------------
// Whole-arrangement saves — delegated to the transactional reorder service.
// ---------------------------------------------------------------------------

const moduleOrderSchema = z
  .object({
    courseId: z.string().min(1),
    token: z.string().min(1),
    moduleIds: z.array(z.string().min(1)).min(1),
  })
  .strict();

export async function saveModuleOrderAction(
  input: z.input<typeof moduleOrderSchema>,
): Promise<OrderActionResult> {
  try {
    const parsed = moduleOrderSchema.parse(input);
    await commitModuleOrder({
      courseId: parsed.courseId,
      expectedUpdatedAt: parseOrderToken(parsed.token),
      moduleIds: parsed.moduleIds,
    });
    revalidateCourse(parsed.courseId);
    return { ok: true, token: await freshToken(parsed.courseId) };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { ok: false, reason: "MISMATCH", message: "The request was malformed." };
    }
    return toOrderFailure(error);
  }
}

const lessonArrangementSchema = z
  .object({
    courseId: z.string().min(1),
    token: z.string().min(1),
    arrangement: z
      .array(
        z.object({
          moduleId: z.string().min(1),
          lessonIds: z.array(z.string().min(1)),
        }),
      )
      .min(1),
  })
  .strict();

export async function saveLessonArrangementAction(
  input: z.input<typeof lessonArrangementSchema>,
): Promise<OrderActionResult> {
  try {
    const parsed = lessonArrangementSchema.parse(input);
    await commitLessonOrder({
      courseId: parsed.courseId,
      expectedUpdatedAt: parseOrderToken(parsed.token),
      arrangement: parsed.arrangement,
    });
    revalidateCourse(parsed.courseId);
    return { ok: true, token: await freshToken(parsed.courseId) };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { ok: false, reason: "MISMATCH", message: "The request was malformed." };
    }
    return toOrderFailure(error);
  }
}

// ---------------------------------------------------------------------------
// Withdraw / restore (D-17, D-34). Withdrawal is `withdrawnAt`, never a delete.
// ---------------------------------------------------------------------------

const withdrawSchema = z
  .object({
    courseId: z.string().min(1),
    kind: z.enum(["module", "lesson"]),
    id: z.string().min(1),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export async function withdrawItemAction(
  input: z.input<typeof withdrawSchema>,
): Promise<ModuleActionResult> {
  try {
    const parsed = withdrawSchema.parse(input);
    const reason = parsed.reason?.trim() || "Withdrawn from the arrange screen.";
    if (parsed.kind === "module") await moduleService.archive(parsed.id, reason);
    else await lessonService.archive(parsed.id, reason);
    revalidateCourse(parsed.courseId);
    return { ok: true };
  } catch (error) {
    return toModuleFailure(error);
  }
}

const restoreSchema = z
  .object({
    courseId: z.string().min(1),
    kind: z.enum(["module", "lesson"]),
    id: z.string().min(1),
  })
  .strict();

/**
 * `moduleService` / `lessonService` gain `.restore` at runtime because their
 * config supplies `restoreData`, but the inferred exported type does not carry
 * the conditional — the established codebase idiom (see
 * `tests/module-lesson-service.test.ts`) is to cast at the call site.
 */
type Restorable = { restore: (id: string, reason: string) => Promise<unknown> };

export async function restoreItemAction(
  input: z.input<typeof restoreSchema>,
): Promise<ModuleActionResult> {
  try {
    const parsed = restoreSchema.parse(input);
    const reason = "Restored from the arrange screen.";
    // D-34: restore appends to the end of the live order — the service's
    // restoreData computes the append slot; we never pass a position.
    const service = parsed.kind === "module" ? moduleService : lessonService;
    await (service as unknown as Restorable).restore(parsed.id, reason);
    revalidateCourse(parsed.courseId);
    return { ok: true };
  } catch (error) {
    return toModuleFailure(error);
  }
}
