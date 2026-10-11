"use server";

/**
 * The learner privacy screens' Server Actions (plan 15-22; D-12, NFR-11, RBAC-06).
 *
 * Every export here is a public POST endpoint — the rendered buttons and the
 * typed email check on the record page are presentation courtesies, not the
 * access control. Both actions validate their own input shape with a strict
 * `zod` object and delegate straight to the privacy services (15-16, 15-21),
 * which re-check `privacy.manage` at Global scope, the reason length and the
 * target themselves: a direct POST from a caller without the permission, with
 * a short reason, or naming a staff account or an unknown id is refused here
 * exactly as it would be from the rendered dialog.
 *
 * Every failure collapses to one fixed message per action, and no caught
 * exception's own text is ever sent back to the browser, so neither action
 * becomes an oracle for which accounts exist. The one exception is the lost
 * race of two staff members anonymising the same learner at once, which gets
 * the reload copy because the next step for that person is different.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { LICENCE_REFUSAL_MESSAGE } from "@/server/licence/policy";
import { LicenceRestrictedError } from "@/server/permissions";
import {
  AnonymiseConflictError,
  MIN_ANONYMISE_REASON_LENGTH,
  privacyAnonymiseService,
} from "@/server/services/privacy-anonymise-service";
import {
  MAX_EXPORT_REASON_LENGTH,
  MIN_EXPORT_REASON_LENGTH,
  privacyExportService,
} from "@/server/services/privacy-export-service";

const EXPORT_FAILED_MESSAGE =
  "The export was not requested. Try again; if it fails again, contact an administrator.";
const ANONYMISE_FAILED_MESSAGE =
  "The account was not changed. Try again; if it fails again, contact an administrator.";
const ANONYMISE_CONFLICT_MESSAGE =
  "This account changed while you were working. Reload the page and check it before trying again.";

function revalidateRecord(userId: string): void {
  revalidatePath(`/staff/privacy/${userId}`, "page");
}

// ---------------------------------------------------------------------------
// requestLearnerExportAction
// ---------------------------------------------------------------------------

const exportSchema = z
  .object({
    userId: z.string().trim().min(1).max(128),
    reason: z.string().trim().min(MIN_EXPORT_REASON_LENGTH).max(MAX_EXPORT_REASON_LENGTH),
  })
  .strict();

export type RequestLearnerExportActionResult = { ok: true; status: string } | { ok: false; message: string };

export async function requestLearnerExportAction(input: unknown): Promise<RequestLearnerExportActionResult> {
  const parsed = exportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: EXPORT_FAILED_MESSAGE };

  try {
    const result = await privacyExportService.requestLearnerExport(parsed.data);
    revalidateRecord(parsed.data.userId);
    return { ok: true, status: result.status };
  } catch {
    // No permission, an unknown id, a staff account, an anonymised learner and a
    // pipeline failure all read the same.
    return { ok: false, message: EXPORT_FAILED_MESSAGE };
  }
}

// ---------------------------------------------------------------------------
// anonymiseLearnerAction
// ---------------------------------------------------------------------------

const anonymiseSchema = z
  .object({
    userId: z.string().trim().min(1).max(128),
    reason: z.string().trim().min(MIN_ANONYMISE_REASON_LENGTH).max(2000),
  })
  .strict();

export type AnonymiseLearnerActionResult = { ok: true } | { ok: false; message: string };

export async function anonymiseLearnerAction(input: unknown): Promise<AnonymiseLearnerActionResult> {
  const parsed = anonymiseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: ANONYMISE_FAILED_MESSAGE };

  try {
    await privacyAnonymiseService.anonymiseLearner(parsed.data);
    revalidateRecord(parsed.data.userId);
    return { ok: true };
  } catch (error) {
    // Checked before the generic branches: a restricted deployment gets the calm
    // licence note the modal already knows how to draw.
    if (error instanceof LicenceRestrictedError) return { ok: false, message: LICENCE_REFUSAL_MESSAGE };
    if (error instanceof AnonymiseConflictError) return { ok: false, message: ANONYMISE_CONFLICT_MESSAGE };
    return { ok: false, message: ANONYMISE_FAILED_MESSAGE };
  }
}
