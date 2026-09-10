"use server";

import { redirect } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current-actor";
import {
  initiateStripePayment,
  HoldExpiredError,
  OrderNotFoundError,
  OrderNotPayableError,
} from "@/server/services/checkout-service";

/**
 * The Pay button's Server Action. On success this redirects the browser to
 * Stripe's own hosted Checkout page (D-01) — never to any app-owned
 * in-app card field.
 *
 * `HoldExpiredError`/`OrderNotPayableError` redirect back to the order
 * summary; plan 06-07 turns that into the D-10 panel and the D-04 banner.
 */
export async function payAction(formData: FormData): Promise<void> {
  const orderId = String(formData.get("orderId") ?? "");
  if (!orderId) redirect("/courses");

  const actor = await getCurrentActor();
  if (!actor) redirect("/signin");

  let url: string;
  try {
    ({ url } = await initiateStripePayment(actor, orderId));
  } catch (err) {
    if (err instanceof HoldExpiredError || err instanceof OrderNotPayableError) {
      redirect(`/checkout/${orderId}`);
    }
    if (err instanceof OrderNotFoundError) {
      redirect("/courses");
    }
    throw err;
  }

  redirect(url);
}
