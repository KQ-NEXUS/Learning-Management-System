import Link from "next/link";
import { LearnerPageHeader } from "@/components/shell/LearnerPageHeader";
import { notFound } from "next/navigation";
import { AlertCircle, ChevronLeft } from "lucide-react";
import { getCurrentActor } from "@/server/auth/current-actor";
import {
  getOwnOrder,
  getOwnVerificationStatus,
  getCohortOfferPath,
} from "@/server/services/checkout-service";
import { payAction } from "@/app/(checkout)/checkout/[orderId]/actions";
import { PolicyConsentForm } from "@/app/(checkout)/checkout/[orderId]/PolicyConsentForm";
import { HoldCountdown } from "@/app/(checkout)/checkout/[orderId]/HoldCountdown";
import { OrderBreakdownCard } from "@/components/checkout/OrderBreakdownCard";

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

function formatRemaining(holdExpiresAt: Date, at: Date): string {
  const totalSeconds = Math.max(Math.floor((holdExpiresAt.getTime() - at.getTime()) / 1000), 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default async function CheckoutOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ declined?: string }>;
}) {
  const { orderId } = await params;
  const { declined } = await searchParams;

  // TOP-LEVEL await, BEFORE any streaming boundary — "not mine" and "does
  // not exist" must produce the identical response (T-06-13's IDOR guard).
  const actor = await getCurrentActor();
  const order = actor ? await getOwnOrder(actor, orderId) : null;
  if (!order || !actor) notFound();

  const at = new Date();
  const enrolment = order.enrolment;

  // The expired state is decided by a server-side check on EVERY render,
  // never by the client countdown reaching zero (D-10). A hold that expired
  // while the learner was away — or mid-checkout on Stripe's own page —
  // replaces the entire page body with this panel; the summary card and Pay
  // button never render alongside it.
  const holdExpired =
    order.status === "PENDING" &&
    (!enrolment ||
      enrolment.status !== "PENDING_PAYMENT" ||
      !enrolment.holdExpiresAt ||
      new Date(enrolment.holdExpiresAt) <= at);

  if (holdExpired) {
    const backHref = await getCohortOfferPath(order.cohort.id);
    return (
      <div className="flex flex-col gap-8">
        <LearnerPageHeader title="Review your order" />
      <div className="flex w-full max-w-[640px] flex-col items-start gap-3 border-t border-foreground py-12">
        <AlertCircle aria-hidden className="size-6 text-danger" />
        <h1 className="text-[36px] leading-[1.1] font-bold tracking-[-0.035em] text-foreground">
          Your seat hold has expired
        </h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          This seat was only held for a limited time and it&apos;s no longer available. Check the
          cohort page for current availability.
        </p>
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
        >
          <ChevronLeft aria-hidden className="size-4" />
          Back to cohort
        </Link>
      </div>
      </div>
    );
  }

  // D-13 defence in depth — see checkout-service.ts's `EmailNotVerifiedError`
  // doc comment for why a `PENDING_VERIFICATION` learner cannot normally
  // hold a session, and therefore cannot normally reach this branch. This
  // banner exists so a future relaxation of the sign-in status rule cannot
  // silently open a payment path for an unproven identity.
  const verification = await getOwnVerificationStatus(actor);
  const emailUnverified = !verification.verified;

  // D-13 — these four snapshot values (plus `amountMinor`/`currency` above)
  // are never null for an Order this codebase's own `startCheckout` created;
  // see `OrderSnapshot`'s own doc comment (checkout-service.ts). A null value
  // here can only mean a pre-Phase-7 legacy Order — and a hold this old
  // cannot still be PENDING_PAYMENT by the time this migration shipped
  // (holds expire in minutes) — so this is treated as a hard invariant
  // violation, not a silent fallback UI, exactly like the equivalent guard
  // `initiateStripePayment` already carries.
  if (
    order.baseAmountMinor === null ||
    order.platformFeeMinor === null ||
    order.gatewayFeeEstimateMinor === null ||
    order.selectedProvider === null
  ) {
    throw new Error(`Order ${order.id} has no commercial snapshot to render a breakdown from.`);
  }

  const facts: [string, string][] = [
    ["Cohort", order.cohort.title],
    ["Dates", formatDateRange(order.cohort.startsAt, order.cohort.endsAt)],
    ["Mode", DELIVERY_MODE_LABEL[order.cohort.deliveryMode] ?? order.cohort.deliveryMode],
  ];

  // The verification and decline banners are mutually exclusive
  // preconditions on the same Pay action — exactly one can ever show.
  const showDeclineBanner = !emailUnverified && declined === "1" && enrolment?.holdExpiresAt;

  return (
    <article className="flex flex-col gap-8">
      <LearnerPageHeader title="Review your order" />

      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex max-w-[720px] flex-col gap-10">
      <section className="flex flex-col gap-4 border-t border-foreground pt-5">
        <dl className="grid grid-cols-1 gap-0">
          {facts.map(([label, value]) => (
            <div
              key={label}
              className="flex min-w-0 flex-col gap-1 border-b border-border py-3"
            >
              <dt className="text-sm text-muted-foreground">
                {label}
              </dt>
              <dd className="break-words text-base font-medium text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* D-16 — the last thing the learner reads before the policy
          checkboxes. Replaces the single "Price" fact that used to live in
          the grid above; the Cohort/Dates/Mode facts are unchanged. */}
      <OrderBreakdownCard
        baseAmountMinor={order.baseAmountMinor}
        platformFeeMinor={order.platformFeeMinor}
        gatewayFeeEstimateMinor={order.gatewayFeeEstimateMinor}
        amountMinor={order.amountMinor}
        currency={order.currency}
        provider={order.selectedProvider}
      />

      {emailUnverified && (
        <div className="flex flex-col gap-1 border-t-2 border-warning py-3">
          <p className="text-sm font-semibold text-warning">Verify your email to pay</p>
          <p className="text-sm text-warning">
            We sent a verification link to {verification.email}. Verify it, then come back to this
            page — your seat hold and order are still here.
          </p>
        </div>
      )}

      {showDeclineBanner && (
        <div className="flex flex-col gap-1 border-t-2 border-danger py-3">
          <p className="text-sm font-semibold text-danger">Your card was declined</p>
          <p className="text-sm text-danger">
            Try a different card — your seat is still held for{" "}
            {formatRemaining(new Date(enrolment!.holdExpiresAt as Date), at)}.
          </p>
        </div>
      )}

      <PolicyConsentForm
        orderId={order.id}
        action={payAction}
        forceDisabled={emailUnverified}
        submitLabel={showDeclineBanner ? "Try again" : `Pay ${formatAmount(order.amountMinor, order.currency)}`}
      />
      </div>

      {enrolment?.holdExpiresAt && (
        <aside aria-label="Seat hold" className="flex flex-col gap-3 lg:border-l lg:border-border lg:pl-10">
              <HoldCountdown
                holdExpiresAt={new Date(enrolment.holdExpiresAt).toISOString()}
                initialRemainingMs={Math.max(
                  new Date(enrolment.holdExpiresAt).getTime() - at.getTime(),
                  0,
                )}
              />
          <p className="text-sm text-muted-foreground">
            After that the seat is released to other learners and you would need to start again.
          </p>
        </aside>
      )}
      </div>
    </article>
  );
}
