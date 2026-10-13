"use server";

import { headers } from "next/headers";
import { verificationService } from "@/server/services/verification-service";
import { rateLimitService } from "@/server/services/rate-limit-service";
import { clientIpFrom } from "@/server/auth/sign-in-throttle";

export type ResendVerificationState = { error: string | null; sent: boolean };

export async function resendVerificationAction(
  _prev: ResendVerificationState,
  formData: FormData,
): Promise<ResendVerificationState> {
  const email = String(formData.get("email") ?? "");

  if (!email) {
    return { error: "Enter your email address.", sent: false };
  }

  // D-11 — per-device limit. The message names the device and is the same
  // for every address (P4); the per-address 60-second cooldown inside the
  // service stays silent. A limiter failure is one more internal outcome and
  // collapses to the neutral state below, like a service failure.
  try {
    const limit = await rateLimitService.consume("resendVerification", {
      ip: clientIpFrom(await headers()),
      email,
    });
    if (limit.limited) {
      return {
        error: `Too many requests for a new link from this device. Wait ${limit.windowMinutes} minutes, then try again.`,
        sent: false,
      };
    }
  } catch {
    return { error: null, sent: true };
  }

  // One single state value regardless of what the service reports — it
  // already collapses no-account, pending, active and cooldown-refused
  // behind one return value, and this action must not reintroduce a
  // distinction the service deliberately removed. The try/catch extends that
  // guarantee to the throw case (G-03-3): a failure below this line is one
  // more internal outcome and must not look different from any other — this
  // is a response-shape guarantee, not error suppression, since the failure
  // already surfaces in the server log (and, for a send failure specifically,
  // in EmailDispatch's FAILED row).
  try {
    await verificationService.resendVerification(email);
  } catch {
    return { error: null, sent: true };
  }

  return { error: null, sent: true };
}
