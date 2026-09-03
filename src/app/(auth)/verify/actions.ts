"use server";

import { verificationService } from "@/server/services/verification-service";

export type ResendVerificationState = { error: string | null; sent: boolean };

export async function resendVerificationAction(
  _prev: ResendVerificationState,
  formData: FormData,
): Promise<ResendVerificationState> {
  const email = String(formData.get("email") ?? "");

  if (!email) {
    return { error: "Enter your email address.", sent: false };
  }

  // One single state value regardless of what the service reports — it
  // already collapses no-account, pending, active and cooldown-refused
  // behind one return value, and this action must not reintroduce a
  // distinction the service deliberately removed.
  await verificationService.resendVerification(email);

  return { error: null, sent: true };
}
