import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current-actor";
import { getOwnOrderByReference } from "@/server/services/checkout-service";
import { signOutAction } from "@/app/(auth)/signin/actions";
import { LearnerShell, type LearnerNavItem } from "@/components/shell/LearnerShell";
import { StatusPill } from "@/components/primitives/ResourceTable";

// Rendered per request, never prerendered — this page reads a real Order.
export const dynamic = "force-dynamic";

const NAV: LearnerNavItem[] = [
  { label: "Catalogue", href: "/courses" },
  { label: "Account", href: "/account" },
];

/**
 * REG-05's required support route (D-19 — static contact info; Phase 12's
 * real ticket system doesn't exist yet). No static support-contact string
 * exists anywhere in this codebase or its docs (checked at plan time — see
 * `06-08-SUMMARY.md`), so this is sourced from configuration
 * (`SUPPORT_CONTACT_EMAIL`, added to `.env.example`) rather than a literal
 * baked into this page. The `.env.example` value is a documented
 * must-override-before-launch placeholder, exactly like that file's existing
 * `EMAIL_SENDER_ADDRESS` fallback (`brevo-client.ts`).
 */
const SUPPORT_CONTACT_EMAIL = process.env.SUPPORT_CONTACT_EMAIL ?? "support@example.com";

function formatAmount(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amountMinor / 100);
}

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
  // flag. `amountMinor`/`currency` come from the Order row exactly as
  // created (D-07 amount-immutability): re-reading the cohort's current
  // price here would produce a receipt that silently rewrites its own
  // history the moment someone edits that cohort (T-06-51).
  const enrolmentStatus = order.enrolment?.status ?? null;
  const active = order.status === "PAID" && enrolmentStatus === "ACTIVE";
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
  const heading = active ? "You're enrolled" : "Payment received — finishing up";

  const rightSlot = (
    <form action={signOutAction}>
      <button
        type="submit"
        className="text-sm font-semibold text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        Sign out
      </button>
    </form>
  );

  return (
    <LearnerShell nav={NAV} rightSlot={rightSlot}>
      <article className="mx-auto flex w-full max-w-[640px] flex-col gap-6">
        <h1 className="text-[25px] font-semibold leading-[1.2] text-foreground">{heading}</h1>

        {!active && (
          <p className="max-w-prose text-sm text-muted-foreground">
            Your payment succeeded but we need a moment to confirm your seat. We&apos;ll email you
            as soon as it&apos;s done — no action needed. If you don&apos;t hear from us within a
            day, contact support below.
          </p>
        )}

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Order details
          </h2>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-surface px-4 py-2 shadow-xs">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Order reference
              </dt>
              <dd className="break-words font-mono text-sm text-foreground">{order.reference}</dd>
            </div>
            <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-surface px-4 py-2 shadow-xs">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Cohort
              </dt>
              <dd className="break-words text-sm text-foreground">{order.cohort.title}</dd>
            </div>
            <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-surface px-4 py-2 shadow-xs">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Amount
              </dt>
              <dd className="break-words text-sm text-foreground">
                {formatAmount(order.amountMinor, order.currency)}
              </dd>
            </div>
            <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-surface px-4 py-2 shadow-xs">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Payment
              </dt>
              <dd className="break-words text-sm">
                <StatusPill
                  label={moneyMoved ? "Paid" : "Pending"}
                  tone={moneyMoved ? "success" : "neutral"}
                />
              </dd>
            </div>
            <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-surface px-4 py-2 shadow-xs">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Enrolment
              </dt>
              <dd className="break-words text-sm">
                <StatusPill
                  label={active ? "Active" : "Pending review"}
                  tone={active ? "success" : "warning"}
                />
              </dd>
            </div>
          </dl>
        </section>

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
          href="/account"
          className="w-fit rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast hover:opacity-90"
        >
          Go to your account
        </Link>
      </article>
    </LearnerShell>
  );
}
