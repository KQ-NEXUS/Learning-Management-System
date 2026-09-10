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

  const paid = order.status === "PAID";
  const enrolmentStatus = order.enrolment?.status ?? "PENDING_PAYMENT";
  const active = enrolmentStatus === "ACTIVE";

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
        <h1 className="text-[25px] font-semibold leading-[1.2] text-foreground">You&apos;re enrolled</h1>

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
                <StatusPill label={paid ? "Paid" : "Pending"} tone={paid ? "success" : "neutral"} />
              </dd>
            </div>
            <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-surface px-4 py-2 shadow-xs">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Enrolment
              </dt>
              <dd className="break-words text-sm">
                <StatusPill label={active ? "Active" : "Pending"} tone={active ? "success" : "neutral"} />
              </dd>
            </div>
          </dl>
        </section>

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
