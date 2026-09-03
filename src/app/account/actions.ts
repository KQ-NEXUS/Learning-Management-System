"use server";

import { redirect } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current-actor";
import { profileService } from "@/server/services/profile-service";

const GENERIC_ERROR = "Something went wrong. Nothing was saved — try again.";

export type UpdateProfileState = { error: string | null; saved: boolean };

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
    return { error: GENERIC_ERROR, saved: false };
  }

  return { error: null, saved: true };
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
    // Generic — never names the password specifically, so this form is not
    // a password oracle for a session an attacker already holds.
    return { error: GENERIC_ERROR, requested: false };
  }

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
