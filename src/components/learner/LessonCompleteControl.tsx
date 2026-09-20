"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2 } from "lucide-react";
import {
  markLessonCompleteAction,
  undoLessonCompleteAction,
} from "@/app/(lesson)/learn/[enrolmentId]/lessons/[lessonId]/actions";

/**
 * LessonCompleteControl — the lesson reading pane's mark/undo island
 * (LRN-05, 09-11 Task 3, UI-SPEC 6.1/7.3/8).
 *
 * A SIBLING client island rendered after `LessonContent` (DD-25) — never a
 * prop threaded into it, so `LessonContent`'s zero-client-JS read path stays
 * intact.
 *
 * Exactly one of three states renders, never two competing controls at
 * once:
 *  - not completed, `allowManualComplete` true -> a single 38px "Mark
 *    complete" submit button.
 *  - completed -> a static "Completed" label plus one "Undo" text link
 *    (a submit button styled as a link, not a second filled button). An
 *    `AUTO_VIDEO` source adds the "Marked complete automatically" caption.
 *  - not completed, `allowManualComplete` false -> nothing at all (no
 *    disabled button either).
 *
 * DD-27: when `relockCount > 0`, the "Undo" text link first expands an
 * inline disclosure ("Undoing this will also re-lock N lesson(s) after it")
 * with its own confirm affordance, rather than submitting immediately — a
 * lightweight local-state expand, never a modal dialog (D-13 frames
 * self-undo as the learner's own non-audit-sensitive record, so a blocking
 * confirmation dialog implying otherwise would be the wrong affordance).
 */

export type LessonCompleteControlProps = {
  enrolmentId: string;
  lessonId: string;
  completed: boolean;
  completedSource: string | null;
  allowManualComplete: boolean;
  /** How many lessons would re-lock if this completion were undone (D-16). */
  relockCount: number;
};

/** The DD-27 disclosure copy, exported so it can be unit-tested without
 *  simulating a click on the stateful "engage" step above it. */
export function undoRelockNotice(relockCount: number): string {
  return `Undoing this will also re-lock ${relockCount} lesson${relockCount === 1 ? "" : "s"} after it`;
}

const BTN_MARK_COMPLETE =
  "inline-flex h-[38px] w-fit items-center justify-center rounded-md bg-accent px-4 text-sm font-semibold text-accent-contrast hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

const UNDO_LINK =
  "w-fit text-sm font-semibold text-muted-foreground underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

function MarkCompleteButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={BTN_MARK_COMPLETE}>
      {pending ? "Marking…" : "Mark complete"}
    </button>
  );
}

function UndoSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={UNDO_LINK}>
      {pending ? "Undoing…" : "Undo"}
    </button>
  );
}

function CompletedState({
  enrolmentId,
  lessonId,
  completedSource,
  relockCount,
}: {
  enrolmentId: string;
  lessonId: string;
  completedSource: string | null;
  relockCount: number;
}) {
  const [confirming, setConfirming] = useState(false);
  const needsConfirmFirst = relockCount > 0 && !confirming;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
          <CheckCircle2 aria-hidden className="size-5 text-success" />
          Completed
        </span>

        {needsConfirmFirst ? (
          <button type="button" onClick={() => setConfirming(true)} className={UNDO_LINK}>
            Undo
          </button>
        ) : (
          <form action={undoLessonCompleteAction}>
            <input type="hidden" name="enrolmentId" value={enrolmentId} />
            <input type="hidden" name="lessonId" value={lessonId} />
            <UndoSubmitButton />
          </form>
        )}
      </div>

      {completedSource === "AUTO_VIDEO" && (
        <p className="text-xs text-progress-text">Marked complete automatically</p>
      )}

      {confirming && relockCount > 0 && (
        <p className="text-sm text-muted-foreground">{undoRelockNotice(relockCount)}</p>
      )}
    </div>
  );
}

export function LessonCompleteControl({
  enrolmentId,
  lessonId,
  completed,
  completedSource,
  allowManualComplete,
  relockCount,
}: LessonCompleteControlProps) {
  if (completed) {
    return (
      <CompletedState
        enrolmentId={enrolmentId}
        lessonId={lessonId}
        completedSource={completedSource}
        relockCount={relockCount}
      />
    );
  }

  if (!allowManualComplete) return null;

  return (
    <form action={markLessonCompleteAction}>
      <input type="hidden" name="enrolmentId" value={enrolmentId} />
      <input type="hidden" name="lessonId" value={lessonId} />
      <MarkCompleteButton />
    </form>
  );
}
