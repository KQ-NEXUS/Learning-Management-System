"use server";

/**
 * The course detail page's publish / listing / archive Server Actions.
 *
 * Every export here is a public POST endpoint (Next.js "Server Actions" guide) —
 * the Origin/Host CSRF check is not authorization. So each action validates its
 * input shape with `zod` and delegates to the matching `publish-service`
 * operation, which re-resolves the Course scope from the row and gates on the
 * right permission. The rendered controls in `CourseDetailActions` hide a button
 * the viewer cannot use, but that is a courtesy — these actions refuse
 * regardless (T-04-53).
 *
 * D-27: the readiness decision is `publish-service`'s, re-run server-side inside
 * each operation. The panel's props are never the gate.
 *
 * Public-route revalidation is deliberately NOT wired here — plan 04-15 owns the
 * public pages and adds those `revalidatePath` calls to this same file. A
 * `revalidatePath` for a route that does not exist yet is dead code.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { StaleOrderError } from "@/server/services/reorder-service";
import { RunningCohortError, type BlockingCohort } from "@/server/services/catalogue-guards";
import type { ReadinessItem } from "@/server/services/readiness-service";
import {
  archiveCatalogueRecord,
  ListingNotReadyError,
  publishCourse,
  ReadinessRefusedError,
  ReasonRequiredError,
  PublishTargetNotFoundError,
  setPublicListing,
  unarchiveCatalogueRecord,
  UnknownMigrationTargetError,
  unpublishContent,
} from "@/server/services/publish-service";

// ---------------------------------------------------------------------------
// Result shapes — discriminated so the UI can name what it would affect.
// ---------------------------------------------------------------------------

type CommonFailure =
  | { ok: false; reason: "COHORTS_RUNNING"; message: string; cohorts: BlockingCohort[] }
  | { ok: false; reason: "NOT_READY"; message: string; failures: ReadinessItem[] }
  | { ok: false; reason: "STALE"; message: string }
  | { ok: false; reason: "REASON_REQUIRED"; message: string }
  | { ok: false; reason: "DENIED"; message: string }
  | { ok: false; reason: "NOT_FOUND"; message: string }
  | { ok: false; reason: "INVALID"; message: string };

export type PublishActionResult =
  | { ok: true; version: number; migratedCohortIds: string[] }
  | CommonFailure;

export type CatalogueActionResult = { ok: true } | CommonFailure;

// ---------------------------------------------------------------------------
// Error → result mapping. An authz failure is one generic line — never one
// that distinguishes "no such course" from "not yours".
// ---------------------------------------------------------------------------

function toFailure(error: unknown): CommonFailure {
  if (error instanceof RunningCohortError) {
    return { ok: false, reason: "COHORTS_RUNNING", message: error.message, cohorts: error.cohorts };
  }
  if (error instanceof ReadinessRefusedError || error instanceof ListingNotReadyError) {
    return {
      ok: false,
      reason: "NOT_READY",
      message: "This course is not ready. Clear the blocking items first.",
      failures: error.failures,
    };
  }
  if (error instanceof StaleOrderError) {
    return {
      ok: false,
      reason: "STALE",
      message: "Someone else changed this course while you were working. Reload and try again.",
    };
  }
  if (error instanceof ReasonRequiredError) {
    return { ok: false, reason: "REASON_REQUIRED", message: "A reason is required." };
  }
  if (error instanceof UnknownMigrationTargetError) {
    return {
      ok: false,
      reason: "INVALID",
      message: "One of the selected cohorts is not affected by this change. Reload and try again.",
    };
  }
  if (error instanceof PublishTargetNotFoundError) {
    return { ok: false, reason: "NOT_FOUND", message: "This course could not be found." };
  }
  if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
    return {
      ok: false,
      reason: "DENIED",
      message: "Your role does not permit this action on this course.",
    };
  }
  throw error;
}

function revalidateCourse(courseId: string): void {
  revalidatePath(`/staff/courses/${courseId}`);
  revalidatePath(`/staff/courses/${courseId}/arrange`);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const publishSchema = z
  .object({
    courseId: z.string().min(1),
    expectedUpdatedAt: z.string().min(1),
    reason: z.string().trim().max(500).optional(),
    migrateCohortIds: z.array(z.string().min(1)).default([]),
  })
  .strict();

export async function publishCourseAction(
  input: z.input<typeof publishSchema>,
): Promise<PublishActionResult> {
  const parsed = publishSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "INVALID", message: "The publish request was malformed." };
  }
  const when = new Date(parsed.data.expectedUpdatedAt);
  if (Number.isNaN(when.getTime())) {
    return { ok: false, reason: "STALE", message: "Reload the page and try again." };
  }

  try {
    const result = await publishCourse({
      courseId: parsed.data.courseId,
      expectedUpdatedAt: when,
      reason: parsed.data.reason,
      migrateCohortIds: parsed.data.migrateCohortIds,
    });
    revalidateCourse(parsed.data.courseId);
    return { ok: true, version: result.version, migratedCohortIds: result.migratedCohortIds };
  } catch (error) {
    return toFailure(error);
  }
}

const listingSchema = z
  .object({
    courseId: z.string().min(1),
    listed: z.boolean(),
  })
  .strict();

export async function setListingAction(
  input: z.input<typeof listingSchema>,
): Promise<CatalogueActionResult> {
  const parsed = listingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "INVALID", message: "The listing request was malformed." };
  }
  try {
    await setPublicListing({ kind: "Course", id: parsed.data.courseId, listed: parsed.data.listed });
    revalidateCourse(parsed.data.courseId);
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}

const reasonedSchema = z
  .object({
    courseId: z.string().min(1),
    reason: z.string().trim().min(10).max(500),
  })
  .strict();

export async function unpublishCourseAction(
  input: z.input<typeof reasonedSchema>,
): Promise<CatalogueActionResult> {
  const parsed = reasonedSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "REASON_REQUIRED", message: "Give a reason of at least 10 characters." };
  }
  try {
    await unpublishContent({ kind: "Course", id: parsed.data.courseId, reason: parsed.data.reason });
    revalidateCourse(parsed.data.courseId);
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}

export async function archiveCourseAction(
  input: z.input<typeof reasonedSchema>,
): Promise<CatalogueActionResult> {
  const parsed = reasonedSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "REASON_REQUIRED", message: "Give a reason of at least 10 characters." };
  }
  try {
    await archiveCatalogueRecord({ kind: "Course", id: parsed.data.courseId, reason: parsed.data.reason });
    revalidateCourse(parsed.data.courseId);
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}

export async function unarchiveCourseAction(
  input: z.input<typeof reasonedSchema>,
): Promise<CatalogueActionResult> {
  const parsed = reasonedSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "REASON_REQUIRED", message: "Give a reason of at least 10 characters." };
  }
  try {
    await unarchiveCatalogueRecord({
      kind: "Course",
      id: parsed.data.courseId,
      reason: parsed.data.reason,
    });
    revalidateCourse(parsed.data.courseId);
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}
