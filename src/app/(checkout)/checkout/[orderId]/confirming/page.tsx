import { notFound, redirect } from "next/navigation";
import { Loader2 } from "lucide-react";
import { getCurrentActor } from "@/server/auth/current-actor";
import { getOwnOrder } from "@/server/services/checkout-service";
import { PollForPayment } from "@/app/(checkout)/checkout/[orderId]/confirming/PollForPayment";

// Rendered per request, never prerendered, never cached — this page's whole
// job is to observe a value another process (the Stripe webhook) is
// changing, so any caching would defeat it (D-05).
export const dynamic = "force-dynamic";

export default async function ConfirmingPaymentPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;

  // TOP-LEVEL await, BEFORE any streaming boundary — "not mine" and "does
  // not exist" must produce the identical response (T-06-13's IDOR guard),
  // same discipline as the sibling order-summary page.
  const actor = await getCurrentActor();
  const order = actor ? await getOwnOrder(actor, orderId) : null;
  if (!order) notFound();

  // Once the Order has left PENDING, the receipt page decides which
  // sub-state to render — both PAID and EXCEPTION go to the SAME
  // destination. Building a second "something went wrong" screen here would
  // give the learner two different accounts of the same event.
  if (order.status === "PAID" || order.status === "EXCEPTION") {
    redirect(`/orders/${order.reference}`);
  }

  return (
    <div className="flex flex-col items-start gap-6">
      <PollForPayment />
      <Loader2 aria-hidden className="size-8 animate-spin text-accent" />
    </div>
  );
}
