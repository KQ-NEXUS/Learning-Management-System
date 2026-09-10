"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current-actor";
import { startCheckout } from "@/server/services/checkout-service";
import {
  CapacityExceededError,
  CohortClosedError,
  CohortNotFoundError,
} from "@/server/services/seat-accounting";
import { CHECKOUT_INTENT_COOKIE, CHECKOUT_INTENT_MAX_AGE_SECONDS } from "@/server/auth/landing";

/**
 * The Enroll CTA's Server Action (D-09 — the seat hold happens here, on the
 * click, before the order-summary page ever renders).
 *
 * When the actor is unauthenticated, this records the cohort selection in
 * the D-14 checkout-intent cookie before sending the visitor to sign-in — a
 * *bare cohort id*, never a path or URL, so the post-auth redirect it later
 * feeds `checkoutReturnPathFor` can never be steered by anything this
 * request supplies (T-06-20). `sameSite: "lax"` is required, not incidental:
 * it is what lets the cookie survive the top-level navigation back from an
 * emailed verification link opened in a fresh tab.
 */
export async function enrollAction(formData: FormData): Promise<void> {
  const cohortId = String(formData.get("cohortId") ?? "");
  if (!cohortId) redirect("/courses");

  const actor = await getCurrentActor();
  if (!actor) {
    const jar = await cookies();
    jar.set(CHECKOUT_INTENT_COOKIE, cohortId, {
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
    ({ orderId } = await startCheckout(actor, cohortId));
  } catch (err) {
    if (
      err instanceof CapacityExceededError ||
      err instanceof CohortClosedError ||
      err instanceof CohortNotFoundError
    ) {
      redirect("/courses");
    }
    throw err;
  }

  redirect(`/checkout/${orderId}`);
}
