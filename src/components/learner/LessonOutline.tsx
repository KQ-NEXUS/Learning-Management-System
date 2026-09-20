import Link from "next/link";
import { CheckCircle2, Circle, Lock, Play } from "lucide-react";

/**
 * LessonOutline — the course outline in the lesson frame's navy sidebar: every module in order,
 * finished modules and modules not yet reached as one line each, and the module you are in
 * opened up to its lessons with the current one highlighted. Read-only wayfinding: completion
 * and locks come straight from `loadLearnerPath`'s decorated tree (this component computes no
 * sequencing), and a locked lesson is plain, non-interactive text with no href, exactly as on
 * the course home page.
 */

export type OutlineLesson = { id: string; title: string; completed: boolean; locked: boolean };
export type OutlineModule = { id: string; title: string; lessons: OutlineLesson[] };
export type OutlineCourse = { id: string; title: string; modules: OutlineModule[] };

const ICON = "size-[18px] shrink-0";

export function LessonOutline({
  enrolmentId,
  courses,
  currentLessonId,
}: {
  enrolmentId: string;
  courses: OutlineCourse[];
  currentLessonId: string;
}) {
  const lessonHref = (lessonId: string) => `/learn/${enrolmentId}/lessons/${lessonId}`;

  return (
    <nav aria-label="Course outline" className="flex flex-col">
      <h2 className="px-6 pt-6 pb-3 text-[12px] font-semibold tracking-[0.06em] text-sidebar-muted uppercase">
        Course outline
      </h2>

      {courses.map((course) => (
        <div key={course.id} className="flex flex-col">
          {courses.length > 1 && (
            <h3 className="px-6 pt-4 pb-1 text-[13px] font-semibold text-sidebar-soft">{course.title}</h3>
          )}

          {course.modules.map((mod, mi) => {
            const done = mod.lessons.filter((l) => l.completed).length;
            const allDone = mod.lessons.length > 0 && done === mod.lessons.length;
            const isCurrent = mod.lessons.some((l) => l.id === currentLessonId);
            const heading = `${mi + 1}. ${mod.title}`;

            if (isCurrent) {
              return (
                <div key={mod.id} className="flex flex-col">
                  <p className="px-6 pt-4 pb-2 font-semibold text-white">
                    {heading}{" "}
                    <span className="text-[13px] font-normal text-sidebar-muted tabular-nums">
                      {done} of {mod.lessons.length}
                    </span>
                  </p>
                  <ul className="flex flex-col gap-1 px-3">
                    {mod.lessons.map((lesson, li) => {
                      const current = lesson.id === currentLessonId;
                      const label = `${mi + 1}.${li + 1} ${lesson.title}`;
                      const icon = current ? (
                        <Play aria-hidden fill="currentColor" className={`${ICON} text-white`} />
                      ) : lesson.completed ? (
                        <CheckCircle2 aria-hidden className={`${ICON} text-on-navy-blue`} />
                      ) : lesson.locked ? (
                        <Lock aria-hidden className={`${ICON} text-sidebar-muted`} />
                      ) : (
                        <Circle aria-hidden className={`${ICON} text-sidebar-muted`} />
                      );
                      const row = `flex items-start gap-3 rounded-md px-3 py-2 ${
                        current ? "bg-accent font-semibold text-white" : "text-sidebar-fg"
                      }`;
                      return (
                        <li key={lesson.id}>
                          {lesson.locked ? (
                            <div aria-disabled="true" className={`${row} opacity-70`}>
                              {icon}
                              <span>{label}</span>
                            </div>
                          ) : (
                            <Link
                              href={lessonHref(lesson.id)}
                              aria-current={current ? "page" : undefined}
                              className={`${row} ${current ? "" : "hover:bg-sidebar-hover hover:text-white"}`}
                            >
                              {icon}
                              <span>{label}</span>
                            </Link>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            }

            const firstOpen = mod.lessons.find((l) => !l.locked);
            const body = (
              <>
                {allDone ? (
                  <CheckCircle2 aria-hidden className={`${ICON} mt-1 text-on-navy-blue`} />
                ) : (
                  <span aria-hidden className={`${ICON} mt-1`} />
                )}
                <span className="min-w-0">
                  <span className="block font-medium">{heading}</span>
                  <span className="block text-[13px] text-sidebar-muted tabular-nums">
                    {done} of {mod.lessons.length} lessons
                  </span>
                </span>
              </>
            );
            const cls = "flex items-start gap-3 px-6 py-3 text-sidebar-fg";
            return firstOpen ? (
              <Link
                key={mod.id}
                href={lessonHref(firstOpen.id)}
                className={`${cls} hover:bg-sidebar-hover hover:text-white`}
              >
                {body}
              </Link>
            ) : (
              <div key={mod.id} aria-disabled="true" className={`${cls} opacity-70`}>
                {body}
              </div>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
