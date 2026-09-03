"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmModal, ResourceForm } from "@/components/primitives";
import { LessonFormFields, type LessonFieldValues } from "@/components/catalogue";
import type { LessonType } from "@/lib/upload-limits";
import { saveLessonAction, withdrawLessonAction, type SaveLessonState } from "./actions";

const INITIAL_SAVE_STATE: SaveLessonState = { ok: null, errors: [], message: null };

const TYPE_OPTIONS: { value: LessonType; label: string }[] = [
  { value: "TEXT", label: "Text" },
  { value: "FILE", label: "File" },
  { value: "IMAGE", label: "Image" },
  { value: "VIDEO", label: "Video" },
  { value: "EMBED", label: "Embed" },
  { value: "LINK", label: "Link" },
  { value: "QUIZ", label: "Quiz" },
  { value: "ASSIGNMENT", label: "Assignment" },
];

type LessonEditorClientProps = {
  courseId: string;
  initialType: LessonType;
  values?: LessonFieldValues;
} & (
  | { mode: "create"; moduleId: string; lessonId?: undefined }
  | { mode: "edit"; lessonId: string; moduleId?: undefined }
);

export function LessonEditorClient(props: LessonEditorClientProps) {
  const { courseId, initialType, values } = props;
  const router = useRouter();
  const [type, setType] = useState<LessonType>(initialType);
  const [state, action, pending] = useActionState(saveLessonAction, INITIAL_SAVE_STATE);

  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  async function confirmWithdraw(reason: string) {
    if (props.mode !== "edit") return;
    setWithdrawing(true);
    setWithdrawError(null);
    try {
      const result = await withdrawLessonAction({
        lessonId: props.lessonId,
        courseId,
        reason,
      });
      if (result.ok) {
        router.push(`/staff/courses/${courseId}/arrange`);
        router.refresh();
        return;
      }
      setWithdrawError(result.message);
      setWithdrawing(false);
    } catch {
      setWithdrawError("The lesson was not withdrawn.");
      setWithdrawing(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="font-mono text-[11px] text-zinc-500">{courseId}</p>
        <h1 className="text-lg font-semibold tracking-tight">
          {props.mode === "create" ? "New lesson" : "Edit lesson"}
        </h1>
      </div>

      {state.ok === true && (
        <p
          role="status"
          className="border border-success/30 bg-success/10 px-3 py-2 text-sm text-success"
        >
          Saved.
        </p>
      )}
      {state.ok === false && state.message && (
        <p
          role="alert"
          className="border border-danger/30 bg-danger-surface px-3 py-2 text-sm text-danger"
        >
          {state.message}
        </p>
      )}

      <ResourceForm
        title={props.mode === "create" ? "New lesson" : "Edit lesson"}
        subtitle={
          props.mode === "create"
            ? "Pick a type, then fill in its fields. The lesson takes its place at the end of the module."
            : undefined
        }
        submitLabel={props.mode === "create" ? "Create lesson" : "Save changes"}
        errors={state.errors}
        pending={pending}
        onSubmit={action}
        onCancel={() => router.push(`/staff/courses/${courseId}/arrange`)}
      >
        <input type="hidden" name="courseId" value={courseId} />
        <input type="hidden" name="type" value={type} />
        {props.mode === "edit" ? (
          <input type="hidden" name="lessonId" value={props.lessonId} />
        ) : (
          <input type="hidden" name="moduleId" value={props.moduleId} />
        )}

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="lesson-type"
            className="text-[11px] font-semibold uppercase tracking-wide text-zinc-600"
          >
            Lesson type
          </label>
          <select
            id="lesson-type"
            value={type}
            onChange={(event) => setType(event.target.value as LessonType)}
            className="border border-zinc-300 bg-white px-2.5 py-1.5 text-sm"
          >
            {TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <LessonFormFields
          lessonType={type}
          lessonId={props.mode === "edit" ? props.lessonId : undefined}
          values={values}
          errors={state.errors}
        />
      </ResourceForm>

      {props.mode === "edit" && (
        <div className="flex flex-col items-start gap-2 border border-zinc-200 bg-white px-4 py-3">
          <p className="text-sm font-medium">Withdraw this lesson</p>
          <p className="max-w-prose text-xs text-zinc-600">
            A withdrawn lesson leaves published cohorts untouched and can be restored from the
            arrange screen. It is never deleted.
          </p>
          <button
            type="button"
            onClick={() => setWithdrawOpen(true)}
            className="border border-danger/40 bg-white px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger-surface"
          >
            Withdraw lesson
          </button>
        </div>
      )}

      <ConfirmModal
        open={withdrawOpen}
        title="Withdraw this lesson"
        description="Give a reason. Staff reviewing the course history will see it."
        confirmLabel="Withdraw lesson"
        minReasonLength={10}
        reasonLabel="Reason for withdrawal"
        pending={withdrawing}
        error={withdrawError}
        onConfirm={confirmWithdraw}
        onCancel={() => setWithdrawOpen(false)}
      />
    </div>
  );
}
