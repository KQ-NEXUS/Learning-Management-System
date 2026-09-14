"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current-actor";
import { startCheckout, CurrencyUnavailableError } from "@/server/services/checkout-service";
import { isSupportedCurrency } from "@/server/payments/routing";
import {
  AlreadyEnrolledError,
  CapacityExceededError,
  CohortClosedError,
  CohortNotFoundError,
} from "@/server/services/seat-accounting";
import { CHECKOUT_INTENT_COOKIE, CHECKOUT_INTENT_MAX_AGE_SECONDS } from "@/server/auth/landing";

/**
 * The Enroll CTA's Server Action (D-09 — the seat hold happens here, on the
 * click, before the order-summary page ever renders).
 *
 * The `currency` field is read from the submitted form and narrowed with
 * `isSupportedCurrency` (07-03) — an absent or unsupported value redirects
 * to `/courses` rather than defaulting to either rail (D-07). When the actor
 * is unauthenticated, this records the cohort AND currency selection as
 * `${cohortId}.${currency}` in the D-14 checkout-intent cookie before
 * sending the visitor to sign-in — a bare pair, never a path or URL, so the
 * post-auth redirect it later feeds `checkoutReturnPathFor` can never be
 * steered by anything this request supplies (T-06-20). `sameSite: "lax"` is
 * required, not incidental: it is what lets the cookie survive the
 * top-level navigation back from an emailed verification link opened in a
 * fresh tab.
 */
export async function enrollAction(formData: FormData): Promise<void> {
  const cohortId = String(formData.get("cohortId") ?? "");
  if (!cohortId) redirect("/courses");

  const currencyInput = String(formData.get("currency") ?? "");
  if (!isSupportedCurrency(currencyInput)) redirect("/courses");
  const currency = currencyInput;

  const actor = await getCurrentActor();
  if (!actor) {
    const jar = await cookies();
    jar.set(CHECKOUT_INTENT_COOKIE, `${cohortId}.${currency}`, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: CHECKOUT_INTENT_MAX_AGE_SECONDS,
    });
    redirect("/signin");
  }

  let orderId: string;
  try {
    ({ orderId } = await startCheckout(actor, cohortId, currency));
  } catch (err) {
    if (
      err instanceof AlreadyEnrolledError ||
      err instanceof CapacityExceededError ||
      err instanceof CohortClosedError ||
      err instanceof CohortNotFoundError ||
      err instanceof CurrencyUnavailableError
    ) {
      redirect("/courses");
    }
    throw err;
  }

  redirect(`/checkout/${orderId}`);
}
