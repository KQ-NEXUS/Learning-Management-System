import { notFound } from "next/navigation";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { cohortService } from "@/server/services/cohort-service";
import { listGradingQueue, listCohortGradingSummary } from "@/server/services/grading-service";
import { PageHeader } from "@/components/shell/PageHeader";
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
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[
          { label: "Workspace", href: "/staff/cohorts" },
          { label: "Cohorts", href: "/staff/cohorts" },
          { label: cohort.title, href: `/staff/cohorts/${cohortId}` },
          { label: "Grading", href: `/staff/cohorts/${cohortId}?tab=grading` },
          { label: assessment.title },
        ]}
        title={assessment.title}
        subtitle={cohort.title}
      />
      <GradingQueueTable cohortId={cohortId} assessmentId={assessmentId} rows={rows} />
    </div>
  );
}
