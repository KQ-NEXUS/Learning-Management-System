import Link from "next/link";
import { CheckCircle2, Circle, Lock, PlayCircle } from "lucide-react";

/**
 * LessonRow — the lesson-list page's four-state row (LRN-02, 09-09 Task 1,
 * UI-SPEC sections 1/4/5/6.1/7.2).
 *
 * DD-21: `locked`/`blockingLessonTitle` are read verbatim from
 * `loadLearnerPath`'s decorated tree — this component performs no
 * sequencing computation of its own, and never will (it has no access to
 * the sibling lessons a re-derivation would need).
 *
 * Precedence, in order: completed -> locked -> current (the next-action
 * lesson) -> not-started. A completed lesson that is also the current one
 * renders as completed, per the plan's explicit ruling.
 *
 * A locked row is a non-interactive, aria-disabled `<div>` with no
 * `href` at all — it has nothing to navigate to yet, and a disabled-styled
 * `<a>` would still be focusable and followable by a determined visitor
 * (T-09-34's server-side `assertLessonOpenable` gate is the real defence;
 * this is the honest UI reflection of it).
 */

export type LessonRowLesson = {
  id: string;
  title: string;
  type: string;
  completed: boolean;
  locked: boolean;
  blockingLessonTitle: string | null;
};

export type LessonRowProps = {
  lesson: LessonRowLesson;
  href: string;
  isCurrent: boolean;
};

const TYPE_LABEL: Record<string, string> = {
  TEXT: "Text",
  FILE: "File",
  IMAGE: "Image",
  VIDEO: "Video",
  EMBED: "Embed",
  LINK: "Link",
  QUIZ: "Quiz",
  ASSIGNMENT: "Assignment",
};

const ROW_BASE = "flex items-start gap-3 rounded-md px-3 py-2";

function TypeHint({ type }: { type: string }) {
  const label = TYPE_LABEL[type];
  if (!label) return null;
  return <p className="text-sm text-muted-foreground">{label}</p>;
}

export function LessonRow({ lesson, href, isCurrent }: LessonRowProps) {
  if (lesson.completed) {
    return (
      <Link href={href} className={`${ROW_BASE} hover:bg-surface-2`}>
        <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />
        <div className="flex flex-col gap-0.5">
          <p className="text-sm text-foreground">{lesson.title}</p>
          <TypeHint type={lesson.type} />
        </div>
      </Link>
    );
  }

  if (lesson.locked) {
    return (
      <div aria-disabled="true" className={`${ROW_BASE} bg-surface-2`}>
        <Lock aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
        <div className="flex flex-col gap-0.5">
          <p className="text-sm text-foreground">{lesson.title}</p>
          <p className="break-words text-sm text-muted-foreground">
            Complete &apos;
            <span className="font-semibold">{lesson.blockingLessonTitle}</span>
            &apos; to unlock this
          </p>
        </div>
      </div>
    );
  }

  if (isCurrent) {
    return (
      <Link href={href} className={`${ROW_BASE} border-l-2 border-accent bg-surface-2`}>
        <PlayCircle aria-hidden className="mt-0.5 size-5 shrink-0 text-accent" />
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-semibold text-foreground">{lesson.title}</p>
          <TypeHint type={lesson.type} />
        </div>
      </Link>
    );
  }

  return (
    <Link href={href} className={`${ROW_BASE} hover:bg-surface-2`}>
      <Circle aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
      <div className="flex flex-col gap-0.5">
        <p className="text-sm text-foreground">{lesson.title}</p>
        <TypeHint type={lesson.type} />
      </div>
    </Link>
  );
}
