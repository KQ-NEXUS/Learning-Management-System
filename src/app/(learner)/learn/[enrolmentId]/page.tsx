import { notFound, redirect } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current-actor";
import {
  loadLearnerPath,
  getOwnPendingEnrolmentOrderHref,
  type LearnerPath,
} from "@/server/services/learner-access";
import { collectRequiredLessonEvidence } from "@/server/services/enrolment-dashboard-service";
import { ProgressMeter } from "@/components/learner/ProgressMeter";
import { LessonRow } from "@/components/learner/LessonRow";
import { AccessDeniedPanel } from "@/components/learner/AccessDeniedPanel";

/**
 * `/learn/[enrolmentId]` (LRN-02, 09-09 Task 3) — the ordered module/lesson
 * tree with server-enforced lock state (D-04/D-05/D-06) and the absolute
 * D-07 access gate.
 *
 * DD-20: re-resolves `getCurrentActor()` itself rather than trusting the
 * `(learner)/layout.tsx` guard, exactly as `/dashboard` does.
 *
 * DD-21: every `locked`/`blockingLessonTitle`/`completed` value below is
 * read straight off `loadLearnerPath`'s decorated tree — this file imports
 * no sequencing evaluator and re-derives nothing about lock state itself.
 */

export const metadata = { title: "Course" };

function findCurrentLessonId(path: LearnerPath): string | null {
  for (const course of path.courses) {
    for (const mod of course.modules) {
      for (const lesson of mod.lessons) {
        if (lesson.required && !lesson.completed && !lesson.locked) return lesson.id;
      }
    }
  }
  return null;
}

export default async function LessonListPage({
  params,
}: {
  params: Promise<{ enrolmentId: string }>;
}) {
  const { enrolmentId } = await params;

  const actor = await getCurrentActor();
  if (!actor) redirect("/signin");

  const path = await loadLearnerPath(actor, enrolmentId);

  if (!path) {
    // DD-22 — `loadLearnerPath` returns the identical `null` for
    // not-found / not-mine / not-ACTIVE (denial parity, T-09-01). The ONE
    // actionable case a caller can act on is their own enrolment sitting in
    // PENDING_PAYMENT; `getOwnPendingEnrolmentOrderHref` asks that narrow,
    // separately-scoped question — still keyed on `actor.userId`, so it
    // discloses nothing a caller did not already know about their own
    // enrolment, and still returns `null` for a stranger's id, preserving
    // denial parity end to end.
    const orderHref = await getOwnPendingEnrolmentOrderHref(actor, enrolmentId);
    if (orderHref !== null) {
      return <AccessDeniedPanel orderHref={orderHref} />;
    }
    notFound();
  }

  if (path.courses.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-[25px] font-semibold leading-[1.2] text-foreground">
          {path.enrolment.cohort.title}
        </h1>
        <div className="rounded-lg border border-border bg-surface-2 px-4 py-6 text-sm text-muted-foreground">
          This course&apos;s content is not yet available
        </div>
      </div>
    );
  }

  const { requiredLessonIds, completedLessonIds } = collectRequiredLessonEvidence(path);
  const completedCount = requiredLessonIds.filter((id) => completedLessonIds.has(id)).length;
  const totalRequired = requiredLessonIds.length;
  const completionPct = totalRequired > 0 ? Math.round((completedCount / totalRequired) * 100) : 0;
  const currentLessonId = findCurrentLessonId(path);

  const heading =
    path.courses.length === 1 ? path.courses[0].courseTitle : path.enrolment.cohort.title;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <h1 className="text-[25px] font-semibold leading-[1.2] text-foreground">{heading}</h1>
        <ProgressMeter
          label="Required lessons complete"
          valuePct={completionPct}
          captionText={`${completedCount} of ${totalRequired} required lessons complete`}
        />
      </div>

      {path.courses.map((course) => (
        <div key={course.courseId} className="flex flex-col gap-6">
          {path.courses.length > 1 && (
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {course.courseTitle}
            </h2>
          )}

          {course.modules.map((mod) => (
            <div key={mod.id} className="flex flex-col gap-2">
              <h3 className="text-[16px] font-semibold text-foreground">{mod.title}</h3>
              <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-2 shadow-xs">
                {mod.lessons.map((lesson) => (
                  <LessonRow
                    key={lesson.id}
                    lesson={lesson}
                    href={`/learn/${enrolmentId}/lessons/${lesson.id}`}
                    isCurrent={lesson.id === currentLessonId}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
