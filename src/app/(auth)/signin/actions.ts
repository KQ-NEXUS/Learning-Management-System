"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { signIn, signOut } from "@/server/services/auth-service";
import { verificationService } from "@/server/services/verification-service";
import { SESSION_COOKIE, SESSION_TTL_DAYS } from "@/server/auth/lockout";
import { clientIpFrom } from "@/server/auth/sign-in-throttle";
import { checkoutReturnPathFor, CHECKOUT_INTENT_COOKIE } from "@/server/auth/landing";

/**
 * UI-SPEC S4 (D-16, U-11) — one message for a wrong password, an unknown
 * address and an unverified account alike, so nothing on screen says whether
 * an account exists.
 */
const SIGN_IN_FAILED =
  "Those details do not match an account. If you've registered but not verified your email yet, use the link in the verification email we sent you, then sign in.";
const SIGN_IN_THROTTLED =
  "Too many sign-in attempts from this device. Wait 15 minutes, or reset your password.";

export type SignInState = {
  error: string | null;
  /** What was typed, so a failed attempt does not blank the field. Never the password. */
  email?: string;
  /** Counts refusals; it remounts the email field so React's form reset cannot blank it. */
  attempt?: number;
};

export async function signInAction(
  prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email address and password.", email, attempt: (prev.attempt ?? 0) + 1 };
  }

  // F-14b — throttled per device, from a trusted client-IP header only.
  const result = await signIn(email, password, { ip: clientIpFrom(await headers()) });

  if (!result.ok) {
    // D-16 — the details matched an account that is not verified yet: send the
    // link again, but only after the response, so neither the reply nor its
    // timing differs from any other failure. resendVerification's 60-second
    // per-address cooldown bounds the mail volume.
    if (result.reason === "INVALID" && result.unverified) {
      after(async () => {
        try {
          await verificationService.resendVerification(email);
        } catch (error) {
          // Name only: the message could carry the address.
          console.error("Sign-in verification resend failed:", error instanceof Error ? error.name : "unknown");
        }
      });
    }
    return {
      email,
      attempt: (prev.attempt ?? 0) + 1,
      error: result.reason === "THROTTLED" ? SIGN_IN_THROTTLED : SIGN_IN_FAILED,
    };
  }

  const jar = await cookies();
  jar.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 86_400,
  });

  // D-14: consume the checkout-intent cookie, if any, on THIS response — the
  // delete happens unconditionally and before the redirect so the intent is
  // single-use. An abandoned checkout must not silently resurrect itself on
  // an unrelated sign-in days later (T-06-21).
  const intent = jar.get(CHECKOUT_INTENT_COOKIE)?.value;
  jar.delete(CHECKOUT_INTENT_COOKIE);

  redirect(checkoutReturnPathFor(result, intent));
}

export async function signOutAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await signOut(token, { ip: clientIpFrom(await headers()) });
  jar.delete(SESSION_COOKIE);
  redirect("/signin");
}
