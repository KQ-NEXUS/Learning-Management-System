import { notFound } from "next/navigation";
import { GraduationCap } from "lucide-react";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { cohortService } from "@/server/services/cohort-service";
import {
  getGradingDetail,
  resolveActorNames,
  SubmissionNotFoundError,
} from "@/server/services/grading-service";
import { DetailLayout, DetailFacts, StatusPill } from "@/components/primitives";
import { formatTimestamp } from "@/lib/format-timestamp";
import { GradeEntryClient } from "./GradeEntryClient";

/**
 * The grade-entry screen (ASM-05, ASM-06) — `10-UI-SPEC.md` §7.2.4.
 *
 * The Cohort-scope banner (D-05, §7.2.1) is written INLINE here rather than
 * imported from the sibling `[assessmentId]/page.tsx` queue route, which
 * runs in the SAME wave (plan 10-12) — see this plan's Task 1 banner note.
 * It is the exact three-line markup that route already established:
 * `GraduationCap` + "Grading: {Cohort} · {Assessment}" in
 * `rounded-md border border-accent/30 bg-accent/5 px-4 py-2` accent text.
 *
 * `detail.cohortId`/`detail.submission.assessmentId` are cross-checked
 * against this route's OWN `[id]`/`[assessmentId]` params — mirroring
 * `learners/[enrolmentId]/page.tsx`'s T-09-44 pattern — so a submission id
 * that resolves under a broader (PROGRAMME/GLOBAL) grant can never render
 * under the WRONG Cohort's banner or Assessment breadcrumb (D-05).
 */

export const metadata = { title: "Grade submission" };

function formatSize(bytes: number): string {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

export default async function GradeEntryPage({
  params,
}: {
  params: Promise<{ id: string; assessmentId: string; submissionId: string }>;
}) {
  const { id: cohortId, assessmentId, submissionId } = await params;

  let cohort;
  let detail;
  try {
    [cohort, detail] = await Promise.all([
      cohortService.get(cohortId),
      getGradingDetail({ submissionId }),
    ]);
  } catch (error) {
    if (
      error instanceof AuthenticationError ||
      error instanceof AuthorizationError ||
      error instanceof SubmissionNotFoundError
    ) {
      notFound();
    }
    throw error;
  }

  if (!cohort || !detail) notFound();
  // T-09-44-style membership proof — a submission resolved under a broader
  // grant must still belong to THIS route's cohort/assessment, or it must
  // never be shown as if it did (D-05).
  if (detail.cohortId !== cohortId || detail.submission.assessmentId !== assessmentId) notFound();

  const priorOnly = detail.priorSubmissions.filter((s) => s.id !== detail.submission.id);

  const actorIds = detail.overrides.map((o) => o.actorId).filter((id): id is string => !!id);
  const actorNames = await resolveActorNames(actorIds);
  const overrideRows = detail.overrides
    .slice()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((o) => ({
      previousScore: o.previousScore,
      newScore: o.newScore,
      reason: o.reason,
      actorName: o.actorId ? (actorNames.get(o.actorId) ?? null) : null,
      createdAt: o.createdAt.toISOString(),
    }));

  const priorFacts = priorOnly.map((s) => ({
    label: `Prior attempt ${s.attemptNumber}`,
    value: (
      <>
        {formatTimestamp(s.submittedAt)}
        {s.isLate ? " · Late" : ""} —{" "}
        <a className="text-accent underline underline-offset-2" href={`/api/submissions/${s.id}/download`}>
          {s.filename}
        </a>
      </>
    ),
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 rounded-md border border-accent/30 bg-accent/5 px-4 py-2 text-sm font-semibold text-accent">
        <GraduationCap aria-hidden size={20} />
        Grading: {cohort.title} · {detail.assessment.title}
      </div>

      <DetailLayout
        mode="stacked"
        breadcrumbs={[
          { label: "Workspace", href: "/staff/cohorts" },
          { label: "Cohorts", href: "/staff/cohorts" },
          { label: cohort.title, href: `/staff/cohorts/${cohortId}` },
          { label: detail.assessment.title, href: `/staff/cohorts/${cohortId}/grading/${assessmentId}` },
          { label: detail.learnerName },
        ]}
        title={detail.learnerName}
        subtitle={detail.assessment.title}
        sections={[
          {
            id: "submission",
            label: "Submission",
            content: (
              <DetailFacts
                facts={[
                  { label: "Learner", value: detail.learnerName },
                  { label: "Submitted", value: formatTimestamp(detail.submission.submittedAt), mono: true },
                  ...(detail.isLate ? [{ label: "Late", value: <StatusPill tone="warning" label="Late" /> }] : []),
                  { label: "Attempt", value: String(detail.attemptNumber), mono: true },
                  {
                    label: "File",
                    value: `${detail.submission.filename} (${formatSize(detail.submission.sizeBytes)})`,
                  },
                  {
                    label: "Download",
                    value: (
                      <a
                        className="text-accent underline underline-offset-2"
                        href={`/api/submissions/${detail.submission.id}/download`}
                      >
                        Download file
                      </a>
                    ),
                  },
                  ...priorFacts,
                ]}
              />
            ),
          },
          {
            id: "grade",
            label: "Score & feedback",
            content: (
              <GradeEntryClient
                cohortId={cohortId}
                assessmentId={assessmentId}
                submissionId={submissionId}
                gradeId={detail.grade?.id ?? null}
                status={detail.grade?.status ?? null}
                score={detail.grade?.score ?? null}
                feedback={detail.grade?.feedback ?? null}
                maxScore={detail.assessment.totalMarks ?? 0}
                overrides={overrideRows}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
