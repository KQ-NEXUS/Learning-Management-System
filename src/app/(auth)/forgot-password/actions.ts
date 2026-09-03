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
  // The try/catch extends that guarantee to the throw case (G-03-3): a
  // dropped DB connection or any other failure below this line is one more
  // internal outcome, and it must not be the one that looks different — this
  // is a response-shape guarantee, not error suppression, since the failure
  // already surfaces in the server log (and, for a send failure specifically,
  // in EmailDispatch's FAILED row).
  try {
    await passwordResetService.requestReset(email);
  } catch {
    return { error: null, sent: true };
  }

  return { error: null, sent: true };
}
