"use client";

/**
 * The `"use client"` island that owns the D-14 override modal state
 * (plan 09-13 Task 3).
 *
 * Copies `EnrolmentActionModals.tsx`'s exact shape from this same area:
 * `target` decides which row's confirmation is open, `ConfirmModal` is
 * rendered VERBATIM (UI-SPEC §7.5's own requirement — no bespoke dialog),
 * and a failed action's message renders through the modal's `error` slot so
 * it reads as "action not applied" rather than a silent no-op. The confirm
 * button is disabled below `MIN_REASON_LENGTH` as a UX courtesy only — the
 * actual enforcement is `overrideLessonProgress`'s own
 * `OverrideReasonRequiredError`, which this component surfaces through
 * `error` exactly like any other failure, never assumed unreachable.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmModal } from "@/components/primitives";
import { formatTimestamp } from "@/lib/format-timestamp";
import { overrideLessonProgressAction } from "../../progress-actions";

export type ProgressLessonRow = {
  id: string;
  title: string;
  moduleTitle: string;
  required: boolean;
  completed: boolean;
  /** `"MANUAL" | "AUTO_VIDEO" | "STAFF_OVERRIDE"`, or `null` when never completed. */
  completedSource: string | null;
  /** ISO instant, or `null` when never completed. */
  completedAt: string | null;
};

export type ProgressOverridePanelProps = {
  cohortId: string;
  enrolmentId: string;
  lessons: ProgressLessonRow[];
  /**
   * A non-throwing `can()` check (courtesy only, T-04-53 precedent) — hides
   * the affordance for a caller who cannot exercise it. The Server Action's
   * own `withPermission` gate inside `overrideLessonProgress` is the actual
   * enforcement whether or not this prop is true.
   */
  canOverride: boolean;
};

const SOURCE_LABEL: Record<string, string> = {
  MANUAL: "Marked by learner",
  AUTO_VIDEO: "Auto-completed (video)",
  STAFF_OVERRIDE: "Staff override",
};

const MIN_REASON_LENGTH = 10;

type OverrideTarget = { lessonId: string; lessonTitle: string; currentlyComplete: boolean };

export function ProgressOverridePanel({
  cohortId,
  enrolmentId,
  lessons,
  canOverride,
}: ProgressOverridePanelProps) {
  const router = useRouter();
  const [target, setTarget] = useState<OverrideTarget | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setTarget(null);
    setPending(false);
    setError(null);
  }

  async function confirm(reason: string) {
    if (!target) return;
    setPending(true);
    setError(null);

    const formData = new FormData();
    formData.set("cohortId", cohortId);
    formData.set("enrolmentId", enrolmentId);
    formData.set("lessonId", target.lessonId);
    formData.set("complete", String(!target.currentlyComplete));
    formData.set("reason", reason);

    const result = await overrideLessonProgressAction(formData);
    setPending(false);
    if (result.ok) {
      close();
      router.refresh();
    } else {
      setError(result.message);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <h2 className="sr-only">Pinned lessons</h2>

      {lessons.length === 0 ? (
        <p className="text-sm text-muted-foreground">This enrolment has no pinned lessons yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {lessons.map((lesson) => (
            <li
              key={lesson.id}
              className="flex flex-wrap items-center justify-between gap-2 py-3"
            >
              <div className="flex flex-col gap-1">
                <span className="text-sm font-semibold text-foreground">{lesson.title}</span>
                <span className="text-xs text-muted-foreground">
                  {lesson.moduleTitle} · {lesson.required ? "Required" : "Optional"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {lesson.completed
                    ? `${SOURCE_LABEL[lesson.completedSource ?? ""] ?? lesson.completedSource} · ${
                        lesson.completedAt ? formatTimestamp(new Date(lesson.completedAt)) : "—"
                      }`
                    : "Not completed"}
                </span>
              </div>
              {canOverride && (
                <button
                  type="button"
                  className="text-xs font-semibold text-accent underline underline-offset-2"
                  onClick={() =>
                    setTarget({
                      lessonId: lesson.id,
                      lessonTitle: lesson.title,
                      currentlyComplete: lesson.completed,
                    })
                  }
                >
                  {lesson.completed ? "Mark incomplete" : "Mark complete"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmModal
        open={target !== null}
        title={
          target
            ? `${target.currentlyComplete ? "Mark incomplete" : "Mark complete"}: ${target.lessonTitle}?`
            : ""
        }
        description="This overrides the learner's own progress record. The reason is audited (D-14)."
        confirmLabel={target?.currentlyComplete ? "Mark incomplete" : "Mark complete"}
        tone="default"
        minReasonLength={MIN_REASON_LENGTH}
        pending={pending}
        error={error}
        onConfirm={confirm}
        onCancel={close}
      />
    </div>
  );
}
