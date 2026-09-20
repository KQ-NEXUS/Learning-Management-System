import Link from "next/link";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { listCohortGradingSummary } from "@/server/services/grading-service";

export async function GradingTab({ cohortId }: { cohortId: string }) {
  let rows;
  let denied = false;
  try { rows = await listCohortGradingSummary({ cohortId }); }
  catch (error) {
    if (error instanceof AuthenticationError || error instanceof AuthorizationError) denied = true;
    else throw error;
  }
  if (denied || !rows) return <p className="text-sm text-muted-foreground">Your role does not permit viewing submissions for this Cohort.</p>;
  // Quizzes auto-release (D-01), so only assignments need a human grading queue.
  if (!rows.length) return <div className="flex flex-col gap-2 p-6"><h2 className="font-semibold">Nothing to grade yet</h2><p className="text-sm text-muted-foreground">Submissions will appear here once learners in this Cohort submit their work.</p></div>;
  return <ul className="divide-y divide-border">{rows.map(row => <li key={row.assessmentId} className="py-3">
    <Link href={`/staff/cohorts/${cohortId}/grading/${row.assessmentId}`} className="text-sm text-accent">{row.title} — {row.pendingCount} pending · {row.draftCount} draft · {row.releasedCount} released</Link>
  </li>)}</ul>;
}
