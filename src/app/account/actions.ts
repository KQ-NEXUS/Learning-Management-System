"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current-actor";
import { profileService } from "@/server/services/profile-service";

const GENERIC_ERROR = "Something went wrong. Nothing was saved — try again.";

// G-03-6c / T-03-57 — reverses T-03-39's generic mapping (03-05-PLAN.md).
// That plan chose the generic copy so this form could not become a
// password oracle for an attacker holding a stolen session. That reasoning
// does not hold up: an attacker who already holds the session can already
// read this account's email address off this very page and test candidate
// passwords against it at /signin, which grants no less than this form
// does and is lockout-protected besides. The generic copy therefore closed
// no real channel while leaving the legitimate owner with no way to tell
// why their own change was refused — UAT recorded exactly that. The
// service's own comment on EMAIL_CHANGE_STEP_UP_FAILED already records that
// this failure depends solely on the caller's own current password and
// never on the target address, which is what makes it safe to name here.
//
// Deliberately NOT counted against the sign-in lockout counter (T-03-58):
// that counter also gates /signin, and wiring a profile-page typo into it
// would let a learner lock themselves out of the whole product from a
// mistake on their own account page.
const STEP_UP_FAILED_ERROR =
  "That password wasn't right. Your email address was not changed — try again.";

export type UpdateProfileState = {
  error: string | null;
  saved: boolean;
  saveCount: number;
  savedProfile: { name: string; phone: string | null } | null;
};

export async function updateProfileAction(
  _prev: UpdateProfileState,
  formData: FormData,
): Promise<UpdateProfileState> {
  const actor = await getCurrentActor();
  if (!actor) redirect("/signin");

  const name = String(formData.get("name") ?? "");
  const phone = String(formData.get("phone") ?? "");

  const result = await profileService.updateOwnProfile(actor, { name, phone });
  if (!result.ok) {
    return { error: GENERIC_ERROR, saved: false, saveCount: _prev.saveCount, savedProfile: _prev.savedProfile };
  }

  // G-03-6b — revalidate the route so any later render (a reload, or a
  // navigation back to /account) reads fresh, AND echo the saved profile
  // back in state below. Revalidation alone is not enough: the name/phone
  // inputs are uncontrolled and React 19 resets an uncontrolled form after
  // a form action completes, restoring `defaultValue` — an already-mounted
  // input does not follow a changed prop. updateOwnProfile already returns
  // the saved profile; it was previously discarded and is the fix's data
  // source, so this costs no extra read.
  revalidatePath("/account");

  return {
    error: null,
    saved: true,
    saveCount: _prev.saveCount + 1,
    savedProfile: { name: result.profile.name, phone: result.profile.phone },
  };
}

export type RequestEmailChangeState = { error: string | null; requested: boolean; newEmail?: string };

export async function requestEmailChangeAction(
  _prev: RequestEmailChangeState,
  formData: FormData,
): Promise<RequestEmailChangeState> {
  const actor = await getCurrentActor();
  if (!actor) redirect("/signin");

  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newEmail = String(formData.get("newEmail") ?? "");

  if (!currentPassword || !newEmail) {
    return { error: "Enter your current password and a new email address.", requested: false };
  }

  const result = await profileService.requestEmailChange(actor, { currentPassword, newEmail });
  if (!result.ok) {
    // STEP_UP_FAILED is the one distinguishable failure reason this service
    // returns (see the comment above STEP_UP_FAILED_ERROR) — every other
    // failure arm still returns the shared generic error.
    if (result.reason === "STEP_UP_FAILED") {
      return { error: STEP_UP_FAILED_ERROR, requested: false };
    }
    return { error: GENERIC_ERROR, requested: false };
  }

  // G-03-6b — the page renders the pending address; without this, a
  // reload right after requesting the change would still serve the
  // pre-request cached render and hide the pending state the learner just
  // created.
  revalidatePath("/account");

  return { error: null, requested: true, newEmail };
}

export type SetMarketingPreferenceState = { error: string | null; accepted: boolean };

export async function setMarketingPreferenceAction(
  _prev: SetMarketingPreferenceState,
  formData: FormData,
): Promise<SetMarketingPreferenceState> {
  const actor = await getCurrentActor();
  if (!actor) redirect("/signin");

  const accepted = formData.get("marketingOptIn") === "on";

  try {
    await profileService.setMarketingPreference(actor, accepted);
  } catch {
    // Revert to the pre-toggle state — a control left showing the new
    // position after a failed save tells the learner a consent was
    // recorded that was not.
    return { error: GENERIC_ERROR, accepted: !accepted };
  }

  return { error: null, accepted };
}
