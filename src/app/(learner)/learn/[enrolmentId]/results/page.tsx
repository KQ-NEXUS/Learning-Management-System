import { notFound, redirect } from "next/navigation";
import { LearnerPageHeader } from "@/components/shell/LearnerPageHeader";
import { getCurrentActor } from "@/server/auth/current-actor";
import { loadLearnerPath } from "@/server/services/learner-access";
import { getOwnResults } from "@/server/services/learner-results-service";
import { ResultsList } from "@/components/learner/ResultsList";

/**
 * `/learn/[enrolmentId]/results` (ASM-07, plan 10-15, UI-SPEC §7.5) — the
 * learner's full list of released results across every Assessment in this
 * Enrolment's Course, filling Phase 9's named-gap "Results" dashboard slot.
 *
 * DD-20 / T-09-01 parity: re-resolves `getCurrentActor()` itself and reuses
 * `loadLearnerPath` — the exact ownership check `/learn/[enrolmentId]` and
 * `/learn/[enrolmentId]/sessions` already establish (identical `null` for
 * not-found / not-mine / not-ACTIVE) — rather than writing a second one.
 * `getOwnResults` itself filters `status: "RELEASED"` at the database
 * (T-10-04); this route adds no further filtering, only rendering.
 */

export const dynamic = "force-dynamic";

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ enrolmentId: string }>;
}) {
  const { enrolmentId } = await params;

  const actor = await getCurrentActor();
  if (!actor) redirect("/signin");

  const path = await loadLearnerPath(actor, enrolmentId);
  if (!path) notFound();

  const results = await getOwnResults(actor, { enrolmentId });

  return (
    <div className="flex flex-col gap-6">
      <LearnerPageHeader
        size="hero"
        title="Your results"
        subtitle={path.enrolment?.cohort?.title}
        back={{ label: "Back to course", href: `/learn/${enrolmentId}` }}
      />

      {results.length === 0 ? (
        <div className="flex flex-col gap-2 border-t border-foreground py-8">
          <p className="text-[16px] font-semibold text-foreground">No results yet</p>
          <p className="text-sm text-muted-foreground">
            Complete a quiz or submit an assignment to see your results here.
          </p>
        </div>
      ) : (
        <ResultsList results={results} />
      )}
    </div>
  );
}
