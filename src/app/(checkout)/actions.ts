"use server";

import { redirect } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current-actor";
import { startCheckout } from "@/server/services/checkout-service";
import {
  CapacityExceededError,
  CohortClosedError,
  CohortNotFoundError,
} from "@/server/services/seat-accounting";

/**
 * The Enroll CTA's Server Action (D-09 — the seat hold happens here, on the
 * click, before the order-summary page ever renders).
 *
 * When the actor is unauthenticated this redirects straight to sign-in for
 * now — plan 06-04 replaces this branch with the D-14/D-15 intent-cookie
 * detour and is the only plan that should touch it.
 */
export async function enrollAction(formData: FormData): Promise<void> {
  const cohortId = String(formData.get("cohortId") ?? "");
  if (!cohortId) redirect("/courses");

  const actor = await getCurrentActor();
  if (!actor) redirect("/signin");

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
