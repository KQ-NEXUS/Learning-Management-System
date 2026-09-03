"use server";

/**
 * The Programme detail page's publish / listing / archive Server Actions.
 *
 * The Programme mirror of `src/app/staff/courses/[id]/publish-actions.ts` and
 * the same discriminated result shapes. Content publish and public listing are
 * both `programmes.publish`; archive and un-archive are `programmes.manage`
 * (enforced inside `publish-service`). Public-route revalidation is left to
 * plan 04-15.
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
  publishProgramme,
  ReadinessRefusedError,
  ReasonRequiredError,
  PublishTargetNotFoundError,
  setPublicListing,
  unarchiveCatalogueRecord,
  UnknownMigrationTargetError,
  unpublishContent,
} from "@/server/services/publish-service";

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

function toFailure(error: unknown): CommonFailure {
  if (error instanceof RunningCohortError) {
    return { ok: false, reason: "COHORTS_RUNNING", message: error.message, cohorts: error.cohorts };
  }
  if (error instanceof ReadinessRefusedError || error instanceof ListingNotReadyError) {
    return {
      ok: false,
      reason: "NOT_READY",
      message: "This programme is not ready. Clear the blocking items first.",
      failures: error.failures,
    };
  }
  if (error instanceof StaleOrderError) {
    return {
      ok: false,
      reason: "STALE",
      message: "Someone else changed this programme while you were working. Reload and try again.",
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
    return { ok: false, reason: "NOT_FOUND", message: "This programme could not be found." };
  }
  if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
    return { ok: false, reason: "DENIED", message: "Your role does not permit this action on this programme." };
  }
  throw error;
}

function revalidateProgramme(programmeId: string): void {
  revalidatePath(`/staff/programmes/${programmeId}`);
  revalidatePath(`/staff/programmes/${programmeId}/arrange`);
}

const publishSchema = z
  .object({
    programmeId: z.string().min(1),
    expectedUpdatedAt: z.string().min(1),
    reason: z.string().trim().max(500).optional(),
    migrateCohortIds: z.array(z.string().min(1)).default([]),
  })
  .strict();

export async function publishProgrammeAction(
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
    const result = await publishProgramme({
      programmeId: parsed.data.programmeId,
      expectedUpdatedAt: when,
      reason: parsed.data.reason,
      migrateCohortIds: parsed.data.migrateCohortIds,
    });
    revalidateProgramme(parsed.data.programmeId);
    return { ok: true, version: result.version, migratedCohortIds: result.migratedCohortIds };
  } catch (error) {
    return toFailure(error);
  }
}

const listingSchema = z
  .object({ programmeId: z.string().min(1), listed: z.boolean() })
  .strict();

export async function setProgrammeListingAction(
  input: z.input<typeof listingSchema>,
): Promise<CatalogueActionResult> {
  const parsed = listingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "INVALID", message: "The listing request was malformed." };
  }
  try {
    await setPublicListing({ kind: "Programme", id: parsed.data.programmeId, listed: parsed.data.listed });
    revalidateProgramme(parsed.data.programmeId);
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}

const reasonedSchema = z
  .object({ programmeId: z.string().min(1), reason: z.string().trim().min(10).max(500) })
  .strict();

export async function unpublishProgrammeAction(
  input: z.input<typeof reasonedSchema>,
): Promise<CatalogueActionResult> {
  const parsed = reasonedSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "REASON_REQUIRED", message: "Give a reason of at least 10 characters." };
  }
  try {
    await unpublishContent({ kind: "Programme", id: parsed.data.programmeId, reason: parsed.data.reason });
    revalidateProgramme(parsed.data.programmeId);
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}

export async function archiveProgrammeAction(
  input: z.input<typeof reasonedSchema>,
): Promise<CatalogueActionResult> {
  const parsed = reasonedSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "REASON_REQUIRED", message: "Give a reason of at least 10 characters." };
  }
  try {
    await archiveCatalogueRecord({ kind: "Programme", id: parsed.data.programmeId, reason: parsed.data.reason });
    revalidateProgramme(parsed.data.programmeId);
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}

export async function unarchiveProgrammeAction(
  input: z.input<typeof reasonedSchema>,
): Promise<CatalogueActionResult> {
  const parsed = reasonedSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "REASON_REQUIRED", message: "Give a reason of at least 10 characters." };
  }
  try {
    await unarchiveCatalogueRecord({
      kind: "Programme",
      id: parsed.data.programmeId,
      reason: parsed.data.reason,
    });
    revalidateProgramme(parsed.data.programmeId);
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}
