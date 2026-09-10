import { notFound } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current-actor";
import { getOwnOrder } from "@/server/services/checkout-service";
import { payAction } from "@/app/(checkout)/checkout/[orderId]/actions";

// Rendered per request, never prerendered — matches the public course-detail
// page's own reasoning, and this page reads a real Order.
export const dynamic = "force-dynamic";

const DELIVERY_MODE_LABEL: Record<string, string> = {
  SELF_PACED: "Self-paced",
  INSTRUCTOR_LED: "Instructor-led",
  BLENDED: "Blended",
};

function formatDateRange(startsAt: Date, endsAt: Date): string {
  const fmt = (value: Date) =>
    new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  return `${fmt(startsAt)}–${fmt(endsAt)}`;
}

function formatAmount(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amountMinor / 100);
}

export default async function CheckoutOrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;

  // TOP-LEVEL await, BEFORE any streaming boundary — "not mine" and "does
  // not exist" must produce the identical response (T-06-13's IDOR guard).
  const actor = await getCurrentActor();
  const order = actor ? await getOwnOrder(actor, orderId) : null;
  if (!order) notFound();

  const facts: [string, string][] = [
    ["Cohort", order.cohort.title],
    ["Dates", formatDateRange(order.cohort.startsAt, order.cohort.endsAt)],
    ["Mode", DELIVERY_MODE_LABEL[order.cohort.deliveryMode] ?? order.cohort.deliveryMode],
    ["Price", formatAmount(order.amountMinor, order.currency)],
  ];

  return (
    <article className="mx-auto flex w-full max-w-[640px] flex-col gap-6">
      <h1 className="text-[25px] font-semibold leading-[1.2] text-foreground">Review your order</h1>

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {facts.map(([label, value]) => (
          <div
            key={label}
            className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-surface px-4 py-2 shadow-xs"
          >
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {label}
            </dt>
            <dd className="break-words text-sm text-foreground">{value}</dd>
          </div>
        ))}
      </dl>

      <form action={payAction} className="flex">
        <input type="hidden" name="orderId" value={order.id} />
        <button
          type="submit"
          className="w-full rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast hover:opacity-90 sm:w-auto"
        >
          Pay {formatAmount(order.amountMinor, order.currency)}
        </button>
      </form>
    </article>
  );
}
