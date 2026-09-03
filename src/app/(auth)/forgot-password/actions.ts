"use server";

import { passwordResetService } from "@/server/services/password-reset-service";

export type ForgotPasswordState = { error: string | null; sent: boolean };

export async function forgotPasswordAction(
  _prev: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const email = String(formData.get("email") ?? "");

  if (!email) {
    return { error: "Enter your email address.", sent: false };
  }

  // One single state value regardless of what the service reports — it
  // already collapses every account state and the cooldown refusal behind
  // one return value, and this action must not reintroduce a distinction.
  await passwordResetService.requestReset(email);

  return { error: null, sent: true };
}
