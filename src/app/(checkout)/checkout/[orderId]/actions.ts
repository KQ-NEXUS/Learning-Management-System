"use server";

import { redirect } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current-actor";
import {
  initiateStripePayment,
  getOwnOrder,
  HoldExpiredError,
  OrderNotFoundError,
  OrderNotPayableError,
  EmailNotVerifiedError,
  PolicyConsentRequiredError,
} from "@/server/services/checkout-service";

/**
 * The Pay button's Server Action. On success this redirects the browser to
 * Stripe's own hosted Checkout page (D-01) — never to any app-owned
 * in-app card field.
 *
 * Each typed refusal from `initiateStripePayment` translates to the state
 * plan 06-07 renders, rather than to a generic error:
 *  - `HoldExpiredError` -> back to the order-summary page, which decides
 *    the expired panel itself from server data on every render (D-10) —
 *    this action's job is only to land the learner back there.
 *  - `EmailNotVerifiedError` -> back to the order-summary page, which
 *    renders the D-13 verification banner from its own fresh read.
 *  - `PolicyConsentRequiredError` -> back to the form. Task 1's server gate
 *    is what actually enforces REG-04; this redirect is a courtesy for a
 *    request that skipped the UI, not a security control of its own.
 *  - `OrderNotPayableError` -> the receipt page, for an order that is
 *    already paid.
 */
export async function payAction(formData: FormData): Promise<void> {
  const orderId = String(formData.get("orderId") ?? "");
  if (!orderId) redirect("/courses");

  const actor = await getCurrentActor();
  if (!actor) redirect("/signin");

  const acceptedTerms = formData.get("acceptedTerms") === "true";
  const acceptedRefundCancellation = formData.get("acceptedRefundCancellation") === "true";
  const acceptedMarketing = formData.get("acceptedMarketing") === "true";

  let url: string;
  try {
    ({ url } = await initiateStripePayment(actor, orderId, {
      acceptedTerms,
      acceptedRefundCancellation,
      acceptedMarketing,
    }));
  } catch (err) {
    if (
      err instanceof HoldExpiredError ||
      err instanceof EmailNotVerifiedError ||
      err instanceof PolicyConsentRequiredError
    ) {
      redirect(`/checkout/${orderId}`);
    }
    if (err instanceof OrderNotPayableError) {
      const order = await getOwnOrder(actor, orderId);
      redirect(order ? `/orders/${order.reference}` : "/courses");
    }
    if (err instanceof OrderNotFoundError) {
      redirect("/courses");
    }
    throw err;
  }

  redirect(url);
}
