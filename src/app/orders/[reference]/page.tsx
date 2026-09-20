import Link from "next/link";
import { LearnerPageHeader } from "@/components/shell/LearnerPageHeader";
import { notFound } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current-actor";
import { getOwnOrderByReference } from "@/server/services/checkout-service";
import { signOutAction } from "@/app/(auth)/signin/actions";
import { LearnerShell, type LearnerNavItem } from "@/components/shell/LearnerShell";
import { StatusPill } from "@/components/primitives/ResourceTable";
import { OrderBreakdownCard } from "@/components/checkout/OrderBreakdownCard";
import { SUPPORT_CONTACT_EMAIL } from "@/server/support-contact";

// Rendered per request, never prerendered — this page reads a real Order.
export const dynamic = "force-dynamic";

const NAV: LearnerNavItem[] = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Courses", href: "/courses" },
  { label: "Account", href: "/account" },
];

export default async function OrderReceiptPage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;

  // TOP-LEVEL await, BEFORE any streaming boundary — "not mine" and "does
  // not exist" must produce the identical response (T-06-13's IDOR guard).
  // An unauthenticated visitor gets the same 404, not a sign-in redirect —
  // there is nothing here for them to confirm exists.
  const actor = await getCurrentActor();
  const order = actor ? await getOwnOrderByReference(actor, reference) : null;
  if (!order) notFound();

  // Read straight off the Order/Enrolment's own recorded state — never a
  // flag. `amountMinor`/`currency`, and (07-09) `baseAmountMinor`/
  // `platformFeeMinor`/`gatewayFeeEstimateMinor`/`selectedProvider`, all come
  // from the Order row exactly as created (D-07/D-13 amount-immutability):
  // re-reading the cohort's current price, or the currently-active
  // GatewayFeeSchedule, here would produce a receipt that silently rewrites
  // its own history the moment someone edits either of those (T-06-51,
  // D-18). This page performs no fee calculation of its own and imports
  // nothing from `pricing.ts` — it renders a snapshot, it does not price
  // anything.
  const enrolmentStatus = order.enrolment?.status ?? null;
  const active = order.status === "PAID" && enrolmentStatus === "ACTIVE";
  const partiallyRefunded = order.status === "PARTIALLY_REFUNDED";
  const refunded = order.status === "REFUNDED";
  const hasRefund = partiallyRefunded || refunded;
  // "Paid" covers both sub-states this page ever intentionally shows: a
  // clean settlement (PAID + ACTIVE) and the Pitfall-4 race (PAID or
  // EXCEPTION, enrolment not yet ACTIVE) — the money moved in both, only the
  // seat side is pending reconciliation. Any other Order status this route
  // is not expected to see (PENDING/CANCELLED — the confirming interstitial
  // only ever redirects here once status has left PENDING) falls back to the
  // same non-claiming "Pending" pill rather than asserting a payment that
  // may not have happened.
  const moneyMoved = order.status === "PAID" || order.status === "EXCEPTION";

  // T-06-55 / this plan's transparency prohibition: the heading and the
  // enrolment pill NEVER say "enrolled" or "Active" unless the Enrolment
  // really is ACTIVE. Everything else — including an EXCEPTION order and a
  // PAID order whose seat never activated — renders the same honest,
  // non-danger-toned "still finishing up" copy, verbatim from UI-SPEC 6.1.
  const heading = refunded
    ? "Payment refunded"
    : partiallyRefunded
      ? "Payment partially refunded"
      : active
        ? "You're enrolled"
        : "Payment received — finishing up";

  const paymentPresentation = refunded
    ? { label: "Refunded", tone: "warning" as const }
    : partiallyRefunded
      ? { label: "Partially refunded", tone: "warning" as const }
      : moneyMoved
        ? { label: "Paid", tone: "success" as const }
        : { label: "Pending", tone: "neutral" as const };

  const refundEnrolmentPresentation =
    enrolmentStatus === "ACTIVE"
      ? { label: "Active", tone: "success" as const }
      : enrolmentStatus === "WITHDRAWN"
        ? { label: "Withdrawn", tone: "neutral" as const }
        : enrolmentStatus === "CANCELLED"
          ? { label: "Cancelled", tone: "neutral" as const }
          : { label: "Pending review", tone: "warning" as const };

  const enrolmentPresentation = hasRefund
    ? refundEnrolmentPresentation
    : active
      ? { label: "Active", tone: "success" as const }
      : { label: "Pending review", tone: "warning" as const };

  // D-13/D-18 — never null for an Order this codebase's own `startCheckout`
  // created; see `OrderSnapshot`'s own doc comment (checkout-service.ts) and
  // the identical guard on `/checkout/[orderId]`. A null value here can only
  // mean a pre-Phase-7 legacy Order, which is a hard invariant violation on
  // a PAID receipt, not a silent fallback UI.
  if (
    order.baseAmountMinor === null ||
    order.platformFeeMinor === null ||
    order.gatewayFeeEstimateMinor === null ||
    order.selectedProvider === null
  ) {
    throw new Error(`Order ${order.id} has no commercial snapshot to render a receipt breakdown from.`);
  }

  const rightSlot = (
    <form action={signOutAction}>
      <button
        type="submit"
        className="rounded-md px-2 py-2 text-sm font-medium text-sidebar-soft hover:text-white"
      >
        Sign out
      </button>
    </form>
  );

  return (
    <LearnerShell nav={NAV} homeHref="/dashboard" rightSlot={rightSlot}>
      <article className="flex flex-col gap-8">
        <LearnerPageHeader title={heading} />

        {!active && !hasRefund && (
          <p className="max-w-prose text-sm text-muted-foreground">
            Your payment succeeded but we need a moment to confirm your seat. We&apos;ll email you
            as soon as it&apos;s done — no action needed. If you don&apos;t hear from us within a
            day, contact support below.
          </p>
        )}

        <section className="flex flex-col gap-2">
          <h2 className="text-[20px] font-semibold tracking-[-0.015em] text-foreground">
            Order details
          </h2>
          <dl className="grid max-w-[720px] grid-cols-1 gap-0">
            <div className="flex min-w-0 flex-col gap-1 border-b border-border py-3">
              <dt className="text-sm text-muted-foreground">
                Order reference
              </dt>
              <dd className="break-words font-mono text-base text-foreground">{order.reference}</dd>
            </div>
            <div className="flex min-w-0 flex-col gap-1 border-b border-border py-3">
              <dt className="text-sm text-muted-foreground">
                Cohort
              </dt>
              <dd className="break-words text-base font-medium text-foreground">{order.cohort.title}</dd>
            </div>
            <div className="flex min-w-0 flex-col gap-1 border-b border-border py-3">
              <dt className="text-sm text-muted-foreground">
                Payment
              </dt>
              <dd className="break-words text-sm">
                <StatusPill
                  label={paymentPresentation.label}
                  tone={paymentPresentation.tone}
                />
              </dd>
            </div>
            <div className="flex min-w-0 flex-col gap-1 border-b border-border py-3">
              <dt className="text-sm text-muted-foreground">
                Enrolment
              </dt>
              <dd className="break-words text-sm">
                <StatusPill
                  label={enrolmentPresentation.label}
                  tone={enrolmentPresentation.tone}
                />
              </dd>
            </div>
          </dl>
        </section>

        {/* D-18 — the same breakdown card the order-summary page rendered
            before payment, in the position the single "Amount" fact used to
            occupy. Read straight from the Order's own snapshot columns
            above; a later Cohort price or GatewayFeeSchedule edit can never
            change what this receipt shows. */}
        <OrderBreakdownCard
          baseAmountMinor={order.baseAmountMinor}
          platformFeeMinor={order.platformFeeMinor}
          gatewayFeeEstimateMinor={order.gatewayFeeEstimateMinor}
          amountMinor={order.amountMinor}
          currency={order.currency}
          provider={order.selectedProvider}
        />

        <p className="text-sm text-muted-foreground">
          Need help with this order? Email{" "}
          <a
            href={`mailto:${SUPPORT_CONTACT_EMAIL}`}
            className="text-accent underline underline-offset-2"
          >
            {SUPPORT_CONTACT_EMAIL}
          </a>{" "}
          — reference {order.reference}.
        </p>

        <Link
          href="/dashboard"
          className="w-fit rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast hover:bg-accent-deep"
        >
          Go to your dashboard
        </Link>
      </article>
    </LearnerShell>
  );
}
