import { notFound } from "next/navigation";
import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { cohortService } from "@/server/services/cohort-service";
import { listGradingQueue, listCohortGradingSummary } from "@/server/services/grading-service";
import { GradingQueueTable } from "./GradingQueueTable";

export const metadata = { title: "Grading queue" };
export default async function GradingQueuePage({ params }: { params: Promise<{ id: string; assessmentId: string }> }) {
  const { id: cohortId, assessmentId } = await params;
  let cohort;
  let assessment;
  let rows;
  try {
    const [record, summary] = await Promise.all([cohortService.get(cohortId), listCohortGradingSummary({ cohortId })]);
    cohort = record;
    assessment = summary.find(a => a.assessmentId === assessmentId);
    if (!cohort || !assessment) notFound();
    rows = await listGradingQueue({ cohortId, assessmentId });
  } catch (error) {
    if (error instanceof AuthenticationError || error instanceof AuthorizationError) notFound();
    throw error;
  }
  return <div className="flex flex-col gap-4">
      <Link href={`/staff/cohorts/${cohortId}?tab=grading`} className="text-sm text-accent">← Back to Cohort</Link>
      <div className="flex items-center gap-2 rounded-md border border-accent/30 bg-accent/5 px-4 py-2 text-sm font-semibold text-accent"><GraduationCap aria-hidden size={20} />Grading: {cohort.title} · {assessment.title}</div>
      <GradingQueueTable cohortId={cohortId} assessmentId={assessmentId} rows={rows} />
    </div>;
}
