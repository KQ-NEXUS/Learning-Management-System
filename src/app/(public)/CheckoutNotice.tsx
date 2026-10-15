import Link from "next/link";
import { LEARNER_REFUSAL_MESSAGE } from "@/server/licence/policy";

/**
 * UX batch B — why a checkout didn't start. `/enrol/[cohortId]` sends the
 * learner back here with `?notice=` instead of a silent redirect. Only these
 * five keys render (`enrolled`, `full`, `closed`, `currency`, `unavailable`);
 * anything else (missing, unknown, repeated) renders nothing, so the query can
 * never inject text. `unavailable` (Phase 14, OQ8/A12) is the one neutral
 * sentence shown when a new checkout or registration is refused; it never
 * names the licence, the deployment state or any date.
 */
const NOTICES = {
  full: "That cohort is now full, so we couldn't hold a seat for you. Choose another start date below.",
  closed: "That cohort is no longer taking enrolments. Choose another start date below.",
  currency: "That cohort is no longer available in that currency. Choose another price or start date below.",
  unavailable: LEARNER_REFUSAL_MESSAGE,
} as const;

export function CheckoutNotice({ notice }: { notice: string | string[] | undefined }) {
  if (notice === "enrolled") {
    return (
      <p role="status" className="rounded-xl bg-warning-surface px-4 py-3.5 text-[15px] text-pill-amber-ink">
        You&apos;re already enrolled in that cohort.{" "}
        <Link href="/dashboard" className="font-bold underline underline-offset-4">
          Go to your dashboard
        </Link>
      </p>
    );
  }
  if (typeof notice !== "string" || !Object.hasOwn(NOTICES, notice)) return null;
  return (
    <p role="status" className="rounded-xl bg-warning-surface px-4 py-3.5 text-[15px] text-pill-amber-ink">
      {NOTICES[notice as keyof typeof NOTICES]}
    </p>
  );
}
