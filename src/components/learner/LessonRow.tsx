import Link from "next/link";
import { CheckCircle2, Circle, Lock, Play } from "lucide-react";

/**
 * LessonRow — the lesson-list page's four-state row (LRN-02, 09-09 Task 1,
 * UI-SPEC sections 1/4/5/6.1/7.2), drawn as the mockup's course-content row: state icon, the
 * lesson number in mono, the title, its type, and whether it is required.
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
  required?: boolean;
  completed: boolean;
  locked: boolean;
  blockingLessonTitle: string | null;
};

export type LessonRowProps = {
  lesson: LessonRowLesson;
  href: string;
  isCurrent: boolean;
  /** "1.1" — module number, dot, lesson number. Omitted, the column is left out. */
  number?: string;
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

const ROW_BASE = "flex items-center gap-4 border-b border-border py-3";
const ICON = "size-[19px] shrink-0";

function Meta({ number }: { number?: string }) {
  return (
    <>
      {number && <span className="w-[34px] shrink-0 font-mono text-[13px] text-muted-foreground">{number}</span>}
    </>
  );
}

function Tail({ lesson }: { lesson: LessonRowLesson }) {
  const label = TYPE_LABEL[lesson.type];
  return (
    <>
      {label && <span className="hidden w-[90px] shrink-0 text-[13px] text-muted-foreground sm:block">{label}</span>}
      {lesson.required !== undefined && (
        <span
          className={`hidden w-[74px] shrink-0 text-right text-[13px] sm:block ${
            lesson.required ? "text-foreground" : "text-muted-foreground"
          }`}
        >
          {lesson.required ? "Required" : "Optional"}
        </span>
      )}
    </>
  );
}

export function LessonRow({ lesson, href, isCurrent, number }: LessonRowProps) {
  if (lesson.completed) {
    return (
      <Link href={href} className={`${ROW_BASE} hover:bg-surface-2/60`}>
        <CheckCircle2 aria-hidden className={`${ICON} text-accent`} />
        <Meta number={number} />
        <span className="min-w-0 grow font-medium text-foreground">{lesson.title}</span>
        <Tail lesson={lesson} />
      </Link>
    );
  }

  if (lesson.locked) {
    return (
      <div aria-disabled="true" className={ROW_BASE}>
        <Lock aria-hidden className={`${ICON} text-muted-foreground`} />
        <Meta number={number} />
        <div className="min-w-0 grow">
          <p className="font-medium text-muted-foreground">{lesson.title}</p>
          <p className="break-words text-[13px] text-muted-foreground">
            Complete &apos;
            <span className="font-semibold">{lesson.blockingLessonTitle}</span>
            &apos; to unlock this
          </p>
        </div>
        <Tail lesson={lesson} />
      </div>
    );
  }

  if (isCurrent) {
    return (
      <Link href={href} className={`${ROW_BASE} hover:bg-surface-2/60`}>
        <Play aria-hidden fill="currentColor" className={`${ICON} text-accent`} />
        <Meta number={number} />
        <span className="min-w-0 grow font-bold text-foreground">{lesson.title}</span>
        <Tail lesson={lesson} />
      </Link>
    );
  }

  return (
    <Link href={href} className={`${ROW_BASE} hover:bg-surface-2/60`}>
      <Circle aria-hidden className={`${ICON} text-muted-foreground opacity-60`} />
      <Meta number={number} />
      <span className="min-w-0 grow font-medium text-foreground">{lesson.title}</span>
      <Tail lesson={lesson} />
    </Link>
  );
}
