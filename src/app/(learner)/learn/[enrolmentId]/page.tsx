import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { LearnerPageHeader } from "@/components/shell/LearnerPageHeader";
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
        <LearnerPageHeader size="hero" title={path.enrolment.cohort.title} />
        <div className="border-t border-foreground py-6 text-sm text-muted-foreground">
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

  // "4.1": module number within its course, dot, lesson number within the module.
  let current: { id: string; title: string; number: string } | null = null;
  for (const course of path.courses) {
    course.modules.forEach((mod, mi) => {
      mod.lessons.forEach((lesson, li) => {
        if (lesson.id === currentLessonId) current = { id: lesson.id, title: lesson.title, number: `${mi + 1}.${li + 1}` };
      });
    });
  }
  const resumeLabel = completedCount > 0 ? "Resume lesson" : "Start lesson";

  return (
    <div className="flex flex-col gap-6">
      <LearnerPageHeader size="hero" title={heading} />

      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className="min-w-0 lg:pr-14">
          <div className="pb-12">
            <ProgressMeter
              label="Required lessons complete"
              valuePct={completionPct}
              captionText={`${completedCount} of ${totalRequired} required lessons complete`}
            />
          </div>

          <h2 className="pb-5 text-[22px] leading-[1.2] font-semibold tracking-[-0.015em] text-foreground">
            Course content
          </h2>

          {path.courses.map((course) => (
            <div key={course.courseId} className="flex flex-col">
              {path.courses.length > 1 && (
                <h3 className="pb-3 text-[13px] font-semibold tracking-wide text-muted-foreground uppercase">
                  {course.courseTitle}
                </h3>
              )}

              {course.modules.map((mod, mi) => {
                const doneInModule = mod.lessons.filter((l) => l.completed).length;
                return (
                  <section key={mod.id} className="pb-8">
                    <div className="flex items-baseline justify-between gap-4 pb-3">
                      <h3 className="text-[20px] leading-[1.2] font-semibold tracking-[-0.015em] text-foreground">
                        {mi + 1}. {mod.title}
                      </h3>
                      <span className="text-[13px] whitespace-nowrap text-muted-foreground tabular-nums">
                        {doneInModule} of {mod.lessons.length} lessons
                      </span>
                    </div>
                    <div className="border-t border-foreground">
                      {mod.lessons.map((lesson, li) => (
                        <LessonRow
                          key={lesson.id}
                          lesson={lesson}
                          number={`${mi + 1}.${li + 1}`}
                          href={`/learn/${enrolmentId}/lessons/${lesson.id}`}
                          isCurrent={lesson.id === currentLessonId}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          ))}
        </div>

        <aside className="flex flex-col gap-10 lg:border-l lg:border-border lg:pl-10">
          {current && (
            <section>
              <p className="text-sm text-muted-foreground">Next up</p>
              <p className="mt-1 mb-4 text-[18px] font-semibold tracking-[-0.01em] text-foreground">
                <span className="sr-only">Lesson </span>
                {(current as { number: string; title: string }).number} {(current as { title: string }).title}
              </p>
              <Link
                href={`/learn/${enrolmentId}/lessons/${(current as { id: string }).id}`}
                className="inline-flex min-h-[46px] items-center gap-2 rounded-md bg-accent px-5 text-sm font-semibold text-accent-contrast hover:bg-accent-deep"
              >
                {resumeLabel}
                <ArrowRight aria-hidden className="size-4" />
              </Link>
            </section>
          )}

          <section aria-label="Sessions">
            <div className="pb-4">
              <h2 className="text-[22px] leading-[1.2] font-semibold tracking-[-0.015em] text-foreground">Sessions</h2>
            </div>
            <div className="border-t border-foreground pt-4">
              <Link href={`/learn/${enrolmentId}/sessions`} className="font-semibold text-accent hover:underline">
                View all sessions
              </Link>
            </div>
          </section>

          <section aria-label="Results">
            <div className="pb-4">
              <h2 className="text-[22px] leading-[1.2] font-semibold tracking-[-0.015em] text-foreground">Results</h2>
            </div>
            <div className="border-t border-foreground pt-4">
              <Link href={`/learn/${enrolmentId}/results`} className="font-semibold text-accent hover:underline">
                View results
              </Link>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
