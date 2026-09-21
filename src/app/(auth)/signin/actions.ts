"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/server/services/auth-service";
import { SESSION_COOKIE, SESSION_TTL_DAYS } from "@/server/auth/lockout";
import { checkoutReturnPathFor, CHECKOUT_INTENT_COOKIE } from "@/server/auth/landing";

export type SignInState = { error: string | null };

export async function signInAction(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email address and password." };
  }

  const result = await signIn(email, password);

  if (!result.ok) {
    return {
      error:
        result.reason === "LOCKED"
          ? "Too many attempts. Try again in 15 minutes."
          : "Those details do not match an account.",
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
  if (token) await signOut(token);
  jar.delete(SESSION_COOKIE);
  redirect("/signin");
}
