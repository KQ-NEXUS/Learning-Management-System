import Link from "next/link";

/**
 * AccessDeniedPanel — the D-07 absolute access gate (LRN-02, 09-09 Task 2,
 * UI-SPEC section 7.2).
 *
 * Visually matches `DetailLayout`'s denied-state treatment
 * (`src/components/primitives/DetailLayout.tsx`) for consistency only — the
 * mechanism underneath is different. This is an ownership-and-status check
 * against the caller's own record, not an RBAC scope match, so there is no
 * identifier for a required grant to show here.
 *
 * This component accepts no catalogue content as props at all — nothing
 * about what the offering is structured into, and no title of anything
 * inside it. D-07 treats a non-ACTIVE enrolment as an absolute gate, and
 * the Deferred Ideas section explicitly rejected any preview of paid
 * content before payment completes. A component that structurally cannot
 * receive that data cannot leak it later, no matter how this file is
 * edited going forward — a stronger guarantee than a runtime check that
 * merely withholds a value it was handed.
 */

const DENIED_HEADING = "You don't have access to this course yet";

export type AccessDeniedPanelProps = {
  /** Where the caller can act on their own pending payment — `null` when there is nothing to link to. */
  orderHref: string | null;
};

export function AccessDeniedPanel({ orderHref }: AccessDeniedPanelProps) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-xl border border-border bg-surface px-6 py-12 shadow-card">
      <p className="text-sm font-semibold text-foreground">{DENIED_HEADING}</p>
      <p className="max-w-prose text-sm text-muted-foreground">
        Your enrolment status doesn&apos;t currently grant entry here.
      </p>
      {orderHref !== null && (
        <Link
          href={orderHref}
          className="text-sm font-semibold text-accent underline underline-offset-2"
        >
          View your order
        </Link>
      )}
    </div>
  );
}
