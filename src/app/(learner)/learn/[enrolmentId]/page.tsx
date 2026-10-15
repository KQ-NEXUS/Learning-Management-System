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
import { GetSupportLink } from "@/components/support/GetSupportLink";
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

  // G-01: a COMPLETED enrolment is visible but not operable. It is loaded here
  // so the learner can still see what they finished (and "My learning" has
  // somewhere to link to); the rows below carry no lesson links, and the
  // lesson page's `assertLessonOpenable` refuses its content regardless.
  const path = await loadLearnerPath(actor, enrolmentId, { includeCompleted: true });

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
        <LearnerPageHeader tint="bg-peach" title={path.enrolment.cohort.title} back={{ label: "My learning", href: "/learn" }} />
        <div className="mt-8 rounded-[18px] bg-paper p-6">
          <p className="ietc-display text-[25px] leading-none">This course&apos;s content is not yet available</p>
        </div>
      </div>
    );
  }

  const { requiredLessonIds, completedLessonIds } = collectRequiredLessonEvidence(path);
  const completedCount = requiredLessonIds.filter((id) => completedLessonIds.has(id)).length;
  const totalRequired = requiredLessonIds.length;
  const completionPct = totalRequired > 0 ? Math.round((completedCount / totalRequired) * 100) : 0;
  const courseCompleted = path.enrolment.status === "COMPLETED";
  const currentLessonId = courseCompleted ? null : findCurrentLessonId(path);

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
    <div data-primary-content className="flex flex-col">
      <LearnerPageHeader
        tint="bg-peach"
        title={heading}
        back={{ label: "My learning", href: "/learn" }}
        band={
          <div className="flex flex-wrap items-center gap-x-[18px] gap-y-2">
            <div
              role="progressbar"
              aria-label="Required lessons complete"
              aria-valuenow={completionPct}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-2.5 w-full max-w-[300px] overflow-hidden rounded-full bg-ink/15"
            >
              <div className="h-full rounded-full bg-ink" style={{ width: `${completionPct}%` }} />
            </div>
            <p className="text-[14.5px] font-semibold text-peach-text">
              {completedCount} of {totalRequired} required lessons complete
            </p>
          </div>
        }
      />

      <div className="grid items-start gap-9 pt-7 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-16 lg:pt-11">
        <div className="min-w-0">
          <h2 className="ietc-display pb-4 text-[25px] leading-none md:text-[28px]">Course content</h2>

          {path.courses.map((course) => (
            <div key={course.courseId} className="flex flex-col">
              {path.courses.length > 1 && <h3 className="ietc-display pb-3 text-[22px] leading-none">{course.courseTitle}</h3>}

              {course.modules.map((mod, mi) => {
                const doneInModule = mod.lessons.filter((l) => l.completed).length;
                return (
                  <section key={mod.id} className="pb-9">
                    <div className="flex items-baseline justify-between gap-4 border-b-2 border-ink pb-2.5">
                      <h3 className="ietc-display text-[22px] leading-[1.05]">
                        {mi + 1}. {mod.title}
                      </h3>
                      <span className="text-[14px] whitespace-nowrap text-ink-soft tabular-nums">
                        {doneInModule} of {mod.lessons.length} lessons
                      </span>
                    </div>
                    <div>
                      {mod.lessons.map((lesson, li) => (
                        <LessonRow
                          key={lesson.id}
                          lesson={lesson}
                          number={`${mi + 1}.${li + 1}`}
                          href={`/learn/${enrolmentId}/lessons/${lesson.id}`}
                          isCurrent={lesson.id === currentLessonId}
                          readOnly={courseCompleted}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          ))}
        </div>

        <aside className="flex flex-col gap-5 rounded-[18px] bg-paper p-6 shadow-card max-lg:-order-1 lg:sticky lg:top-5">
          {courseCompleted && (
            <section aria-label="Course completed">
              <p className="ietc-display text-[25px] leading-none">You&apos;ve completed this course</p>
              <p className="mt-2 mb-4 text-[14.5px] text-ink-soft">
                Lessons are closed now that the course is complete. Your progress, results and certificate stay on record.
              </p>
              <Link
                href="/dashboard"
                className="inline-flex min-h-12 w-full items-center justify-center gap-2.5 rounded-[10px] bg-ink px-[22px] text-[15.5px] font-bold text-white hover:bg-ink-hover"
              >
                View your certificate
                <ArrowRight aria-hidden className="size-[19px]" strokeWidth={2.3} />
              </Link>
            </section>
          )}

          {current && (
            <section aria-label="Next up">
              <p className="text-[14.5px] font-bold">Next up</p>
              <p className="ietc-display mt-1.5 mb-4 text-[25px] leading-[1.02]">
                <span className="sr-only">Lesson </span>
                {(current as { number: string; title: string }).number} {(current as { title: string }).title}
              </p>
              <Link
                href={`/learn/${enrolmentId}/lessons/${(current as { id: string }).id}`}
                className="inline-flex min-h-12 w-full items-center justify-center gap-2.5 rounded-[10px] bg-ink px-[22px] text-[15.5px] font-bold text-white hover:bg-ink-hover"
              >
                {resumeLabel}
                <ArrowRight aria-hidden className="size-[19px]" strokeWidth={2.3} />
              </Link>
            </section>
          )}

          <dl className="border-t border-rule">
            {/* The sessions page serves ACTIVE enrolments only (G-01), so a completed course offers no link to it. */}
            {!courseCompleted && (
              <div className="flex items-baseline justify-between gap-4 border-b border-rule py-3.5">
                <dt className="font-bold">Sessions</dt>
                <dd>
                  <Link href={`/learn/${enrolmentId}/sessions`} className="font-bold underline underline-offset-4 hover:text-orange-text">
                    View all sessions
                  </Link>
                </dd>
              </div>
            )}
            <div className="flex items-baseline justify-between gap-4 border-b border-rule py-3.5">
              <dt className="font-bold">Results</dt>
              <dd>
                <Link href={`/learn/${enrolmentId}/results`} className="font-bold underline underline-offset-4 hover:text-orange-text">
                  View results
                </Link>
              </dd>
            </div>
          </dl>

          <GetSupportLink
            kind="COHORT"
            id={path.enrolment.cohort.id}
            className="w-fit font-bold underline underline-offset-4 hover:text-orange-text"
          />
        </aside>
      </div>
    </div>
  );
}
