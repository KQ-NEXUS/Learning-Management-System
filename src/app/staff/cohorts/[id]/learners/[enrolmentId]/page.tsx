import { notFound } from "next/navigation";
import { AuthenticationError, AuthorizationError, can } from "@/server/permissions";
import { loadCohortRoster } from "@/server/services/roster-service";
import { loadLearnerPath } from "@/server/services/learner-access";
import { enrolmentCohortScope } from "@/server/services/cohort-scope";
import { DetailLayout, DetailFacts, StatusPill } from "@/components/primitives";
import { ProgressOverridePanel, type ProgressLessonRow } from "./ProgressOverridePanel";
import { humanizeCode } from "@/lib/humanize";
import { formatTimestamp } from "@/lib/format-timestamp";
import {
  loadLearnerResultsForStaff,
  type LearnerResultCard,
} from "@/server/services/staff-learner-results-service";

/**
 * The staff per-learner progress page (D-14, DD-31, plan 09-13 Task 3).
 *
 * Folded into the existing `staff/cohorts/[id]` area rather than a new
 * top-level console (DD-31) — this route lives under the SAME `StaffShell`
 * every sibling cohort page renders (via `src/app/staff/layout.tsx`); it
 * imports no shell of its own, and definitely never the learner-facing shell.
 *
 * Authorization is two calls, deliberately in this order:
 *
 *  1. `loadCohortRoster({ cohortId })` — the EXISTING `cohorts.view` +
 *     `cohortResourceScope` gate (T-09-46's own mitigation path, no new
 *     unscoped query). A denial throws `AuthorizationError`/
 *     `AuthenticationError`, mapped to `notFound()` below, matching every
 *     other staff detail page in this directory (`page.tsx`,
 *     `courses/[id]/page.tsx`). Finding `enrolmentId` inside the RETURNED
 *     roster rows is what proves it belongs to THIS `cohortId` — a
 *     cross-cohort id simply will not appear in another cohort's roster,
 *     so the `notFound()` below when it is absent is T-09-44's mitigation,
 *     not a second hand-rolled check that could disagree with it.
 *  2. Only once staff `cohorts.view` scope over this cohort is established
 *     does the page call the ownership-scoped `loadLearnerPath` — on the
 *     learner's own behalf, constructing `{ userId: rosterRow.learnerId }`
 *     exactly the way `overrideLessonProgress` itself does internally
 *     (`lesson-progress-service.ts`'s own header documents this as the
 *     staff-acts-on-a-learner's-behalf pattern, not a bypass — RBAC scope
 *     was already proven by step 1 before this runs).
 */

export const metadata = { title: "Learner progress" };

const STATUS_TONE: Record<string, "success" | "neutral" | "warning" | "danger"> = {
  PENDING_PAYMENT: "warning",
  ACTIVE: "success",
  WITHDRAWN: "neutral",
  TRANSFERRED: "neutral",
  CANCELLED: "danger",
  COMPLETED: "success",
};

const STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: "Pending payment",
  ACTIVE: "Active",
  WITHDRAWN: "Withdrawn",
  TRANSFERRED: "Transferred",
  CANCELLED: "Cancelled",
  COMPLETED: "Completed",
};

/**
 * COH-07 — the learner's released results, as staff see them. `null` means the
 * viewer's role does not include submissions.view for this cohort.
 */
function ResultsSection({ results }: { results: LearnerResultCard[] | null }) {
  if (results === null) {
    return (
      <p className="pt-4 text-sm text-muted-foreground">
        Your role doesn&apos;t include permission to view submissions for this cohort, so results
        aren&apos;t shown.
      </p>
    );
  }
  if (results.length === 0) {
    return (
      <p className="pt-4 text-sm text-muted-foreground">
        No released results yet. Quiz results appear once a quiz is submitted; assignment grades
        once they are released.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-foreground text-[13px] text-muted-foreground">
            <th className="py-3 pr-4 font-medium">Assessment</th>
            <th className="py-3 pr-4 font-medium">Score</th>
            <th className="py-3 pr-4 font-medium">Result</th>
            <th className="py-3 pr-4 font-medium">Attempts</th>
            <th className="py-3 font-medium">Latest</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => {
            const latest = r.history[0];
            const used = r.type === "QUIZ" ? r.history.length : null;
            return (
              <tr key={r.assessmentId} className="border-b border-border align-top">
                <td className="py-4 pr-4">
                  <span className="block font-semibold text-foreground">{r.title}</span>
                  <span className="text-[13px] text-muted-foreground">{r.type === "QUIZ" ? "Quiz" : "Assignment"}</span>
                </td>
                <td className="py-4 pr-4 font-mono tabular-nums">
                  {r.effectiveScore !== null && r.maxScore !== null ? `${r.effectiveScore} / ${r.maxScore}` : "—"}
                </td>
                <td className="py-4 pr-4">
                  {r.passed === null ? (
                    <span className="text-muted-foreground">No pass mark</span>
                  ) : (
                    <StatusPill label={r.passed ? "Passed" : "Not yet passed"} tone={r.passed ? "success" : "warning"} />
                  )}
                </td>
                <td className="py-4 pr-4 tabular-nums">
                  {used === null
                    ? `${r.history.length} ${r.history.length === 1 ? "submission" : "submissions"}`
                    : `${used} used${r.attemptsRemaining === null ? "" : ` · ${r.attemptsRemaining} left`}`}
                </td>
                <td className="py-4 font-mono text-[13px] tabular-nums text-muted-foreground">
                  {latest ? formatTimestamp(new Date(latest.at)) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function attendanceFactValue(
  attendance: Awaited<ReturnType<typeof loadCohortRoster>>[number]["attendance"],
): string {
  if (attendance.kind === "computed") {
    return `${attendance.earnedPct}% of ${attendance.requiredPct}% required`;
  }
  return attendance.kind === "no-rule" ? "No attendance rule" : "No countable sessions yet";
}

export default async function LearnerProgressPage({
  params,
}: {
  params: Promise<{ id: string; enrolmentId: string }>;
}) {
  const { id: cohortId, enrolmentId } = await params;

  let rosterRows: Awaited<ReturnType<typeof loadCohortRoster>>;
  try {
    rosterRows = await loadCohortRoster({ cohortId });
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
      notFound();
    }
    throw error;
  }

  const rosterRow = rosterRows.find((r) => r.enrolmentId === enrolmentId);
  if (!rosterRow) notFound(); // T-09-44 — also covers an unknown enrolment id

  // Read-only here, so a COMPLETED enrolment opens too (it used to 404 once a
  // learner finished — the same gap as integration warning #5).
  const path = await loadLearnerPath({ userId: rosterRow.learnerId }, enrolmentId, { includeCompleted: true });
  if (!path) notFound(); // defensive — the roster row above already confirmed the enrolment is in this cohort

  // Both grants, as `overrideLessonProgress` requires (A-05): `enrolments.manage` alone is the
  // Finance/Operations role, which must not change what feeds completion.
  const overrideScope = await enrolmentCohortScope(enrolmentId);
  const canOverride =
    (await can("enrolments.manage", overrideScope)) && (await can("attendance.manage", overrideScope));

  // COH-07 — null when the viewer lacks submissions.view here (not an error).
  let results: LearnerResultCard[] | null;
  try {
    results = await loadLearnerResultsForStaff({ enrolmentId });
  } catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
    results = null;
  }

  const lessonRows: ProgressLessonRow[] = path.courses.flatMap((course) =>
    course.modules.flatMap((mod) =>
      mod.lessons.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        moduleTitle: mod.title,
        required: lesson.required,
        completed: lesson.completed,
        completedSource: lesson.completedSource,
        completedAt: lesson.completedAt ? lesson.completedAt.toISOString() : null,
      })),
    ),
  );

  return (
    <DetailLayout
      mode="stacked"
      breadcrumbs={[
        { label: "Workspace", href: "/staff/cohorts" },
        { label: "Cohorts", href: "/staff/cohorts" },
        { label: "Cohort", href: `/staff/cohorts/${cohortId}` },
        { label: rosterRow.learnerName },
      ]}
      title={rosterRow.learnerName}
      identifier={rosterRow.learnerEmail}
      badges={
        <StatusPill
          label={STATUS_LABEL[rosterRow.status] ?? humanizeCode(rosterRow.status)}
          tone={STATUS_TONE[rosterRow.status] ?? "neutral"}
        />
      }
      sections={[
        {
          id: "progress",
          label: "Progress",
          content: (
            <div className="flex flex-col gap-6">
              <DetailFacts
                facts={[
                  { label: "Learner", value: rosterRow.learnerName },
                  { label: "Email", value: rosterRow.learnerEmail },
                  {
                    label: "Enrolment status",
                    value: STATUS_LABEL[rosterRow.status] ?? humanizeCode(rosterRow.status),
                  },
                  {
                    label: "Attendance",
                    value: attendanceFactValue(rosterRow.attendance),
                  },
                  {
                    label: "Required lessons",
                    value:
                      rosterRow.progress.kind === "tracked" ? (
                        <span className="flex items-center gap-4 tabular-nums">
                          <span>
                            {rosterRow.progress.completed} of {rosterRow.progress.total}
                          </span>
                          <span aria-hidden className="h-1 w-36 overflow-hidden rounded-full bg-accent-wash">
                            <span
                              className="block h-full rounded-full bg-progress-fill"
                              style={{
                                width: `${Math.min(100, Math.round((rosterRow.progress.completed / Math.max(rosterRow.progress.total, 1)) * 100))}%`,
                              }}
                            />
                          </span>
                        </span>
                      ) : (
                        "Not tracked — cohort is unpinned"
                      ),
                  },
                ]}
              />
            </div>
          ),
        },
        {
          id: "results",
          label: "Results",
          content: <ResultsSection results={results} />,
        },
        {
          id: "override",
          label: "Lesson override",
          aside: true,
          content: (
            <div className="flex flex-col gap-2">
              <p className="pt-4 text-muted-foreground">
                Mark a lesson complete on the learner&apos;s behalf. A reason is required and the change is
                recorded in the audit history.
              </p>
              <ProgressOverridePanel
                cohortId={cohortId}
                enrolmentId={enrolmentId}
                lessons={lessonRows}
                canOverride={canOverride}
              />
            </div>
          ),
        },
      ]}
    />
  );
}
