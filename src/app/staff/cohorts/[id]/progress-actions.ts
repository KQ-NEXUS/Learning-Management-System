"use server";

/**
 * The staff progress-override Server Action (D-14, DD-31).
 *
 * Modelled on this same directory's `attendance-actions.ts` / `enrolment-actions.ts`
 * mandatory-reason staff actions, and on `src/app/staff/users/actions.ts`'s
 * `createStaffAccountAction` for the FormData-reading shape specifically —
 * every field is read via `formData.get(...)`, never a typed object argument.
 * Every export here is a public POST endpoint (Next.js "Server Functions"
 * guide, `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md`,
 * confirmed against the pinned Next.js 16.3.4 — the Origin/Host CSRF check is
 * not authorization.
 *
 * This action NEVER reads an actor/user id from the form (T-09-06's own
 * mitigation table) — the acting staff member is derived entirely inside
 * `overrideLessonProgress`'s `withPermission("enrolments.manage",
 * enrolmentCohortScope)` wrapper from the session. The mandatory reason
 * (D-14) is enforced in the SERVICE (`OverrideReasonRequiredError`), not
 * here — a reason check written in this file would be a courtesy duplicate:
 * it could be bypassed by a direct POST that skips the client entirely,
 * while the service's check, which runs against data resolved from the
 * database inside the permission choke point, cannot be.
 *
 * `AuthorizationError` / `AuthenticationError` map to `notFound()`, matching
 * the staff area's existing page-level denial convention (`courses/[id]/page.tsx`
 * et al.) — a denial must not confirm the enrolment/cohort exists (T-09-45).
 * Every other typed refusal (a missing reason, a cross-course lesson id)
 * returns a form error instead of redirecting, so the confirmation modal
 * stays open and can render the specific message.
 */

import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import {
  overrideLessonProgress,
  OverrideReasonRequiredError,
  LessonNotOpenableError,
} from "@/server/services/lesson-progress-service";

export type OverrideProgressActionResult = { ok: true } | { ok: false; message: string };

function revalidateProgress(cohortId: string, enrolmentId: string): void {
  if (!cohortId) return;
  revalidatePath(`/staff/cohorts/${cohortId}`, "page");
  revalidatePath(`/staff/cohorts/${cohortId}/learners/${enrolmentId}`, "page");
}

export async function overrideLessonProgressAction(
  formData: FormData,
): Promise<OverrideProgressActionResult> {
  const cohortId = String(formData.get("cohortId") ?? "");
  const enrolmentId = String(formData.get("enrolmentId") ?? "");
  const lessonId = String(formData.get("lessonId") ?? "");
  const complete = String(formData.get("complete") ?? "") === "true";
  const reason = String(formData.get("reason") ?? "");

  try {
    await overrideLessonProgress({ enrolmentId, lessonId, complete, reason });
    revalidateProgress(cohortId, enrolmentId);
    return { ok: true };
  } catch (error) {
    if (error instanceof OverrideReasonRequiredError) {
      return { ok: false, message: error.message };
    }
    if (error instanceof LessonNotOpenableError) {
      // "not-found" is the only reason `overrideLessonProgress` itself ever
      // throws this for (D-14 gates on path membership only, never the lock
      // or access window) — a generic message, never echoing the id.
      return {
        ok: false,
        message: "This lesson could not be found on this learner's enrolled path.",
      };
    }
    if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
      notFound();
    }
    throw error;
  }
}
