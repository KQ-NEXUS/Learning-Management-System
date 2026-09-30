import Link from "next/link";

/**
 * UX batch B — why a checkout didn't start. `/enrol/[cohortId]` sends the
 * learner back here with `?notice=` instead of a silent redirect. Only these
 * four keys render; anything else (missing, unknown, repeated) renders
 * nothing, so the query can never inject text.
 */
const NOTICES = {
  full: "That cohort is now full, so we couldn't hold a seat for you. Choose another start date below.",
  closed: "That cohort is no longer taking enrolments. Choose another start date below.",
  currency: "That cohort is no longer available in that currency. Choose another price or start date below.",
} as const;

export function CheckoutNotice({ notice }: { notice: string | string[] | undefined }) {
  if (notice === "enrolled") {
    return (
      <p role="status" className="border-l-2 border-warning bg-warning-surface px-4 py-3 text-sm text-foreground">
        You&apos;re already enrolled in that cohort.{" "}
        <Link href="/dashboard" className="font-semibold text-accent underline underline-offset-2">
          Go to your dashboard
        </Link>
      </p>
    );
  }
  if (typeof notice !== "string" || !(notice in NOTICES)) return null;
  return (
    <p role="status" className="border-l-2 border-warning bg-warning-surface px-4 py-3 text-sm text-foreground">
      {NOTICES[notice as keyof typeof NOTICES]}
    </p>
  );
}
