"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shell/PageHeader";
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
      <PageHeader
        title={props.mode === "create" ? "New lesson" : "Edit lesson"}
        breadcrumbs={[{ label: "Courses", href: "/staff/courses" }, { label: "Course", href: `/staff/courses/${courseId}` }, { label: "Lesson" }]}
        actions={
          <>
            {props.mode === "edit" && (
              <Link
                href={`/staff/courses/${courseId}/preview/lessons/${props.lessonId}`}
                className="inline-flex min-h-[46px] items-center rounded-md border border-sidebar-line px-5 text-sm font-semibold text-white hover:bg-sidebar-hover"
              >
                Preview
              </Link>
            )}
            <Link
              href={`/staff/courses/${courseId}/arrange`}
              className="inline-flex min-h-[46px] items-center rounded-md border border-sidebar-line px-5 text-sm font-semibold text-white hover:bg-sidebar-hover"
            >
              Cancel
            </Link>
            <button
              type="submit"
              form="lesson-form"
              disabled={pending}
              className="inline-flex min-h-[46px] items-center rounded-md bg-accent px-6 text-sm font-semibold text-accent-contrast hover:bg-accent-deep disabled:opacity-50"
            >
              {pending ? "Saving…" : props.mode === "create" ? "Create lesson" : "Save lesson"}
            </button>
          </>
        }
      />

      {state.ok === true && (
        <p
          role="status"
          className="border border-success/30 bg-success/10 px-4 py-2 text-sm text-success"
        >
          Saved.
        </p>
      )}
      {state.ok === false && state.message && (
        <p
          role="alert"
          className="border border-danger/30 bg-danger-surface px-4 py-2 text-sm text-danger"
        >
          {state.message}
        </p>
      )}

      <ResourceForm
        sectioned
        formId="lesson-form"
        hideFooter
        title="Lesson details"
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

        <LessonFormFields
          typeControl={
            <div className="flex flex-col gap-1">
              <span id="lesson-type-label" className="text-sm font-semibold text-foreground">
                Content
              </span>
              <div
                role="group"
                aria-labelledby="lesson-type-label"
                className="flex w-fit max-w-full flex-wrap overflow-hidden rounded-md border border-input-border"
              >
                {TYPE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={type === option.value}
                    onClick={() => setType(option.value)}
                    className={`min-h-10 border-r border-input-border px-4 text-sm font-medium last:border-r-0 ${
                      type === option.value
                        ? "bg-foreground text-surface"
                        : "bg-surface text-foreground-soft hover:bg-surface-2"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          }
          lessonType={type}
          lessonId={props.mode === "edit" ? props.lessonId : undefined}
          values={values}
          errors={state.errors}
        />
      </ResourceForm>

      {props.mode === "edit" && (
        <div className="flex flex-col items-start gap-2 border-t border-foreground pt-5">
          <p className="text-sm font-semibold">Withdraw this lesson</p>
          <p className="max-w-prose text-sm text-muted-foreground">
            A withdrawn lesson leaves published cohorts untouched and can be restored from the
            arrange screen. It is never deleted.
          </p>
          <button
            type="button"
            onClick={() => {
              setWithdrawError(null);
              setWithdrawOpen(true);
            }}
            className="rounded-md border border-danger/40 bg-surface px-4 py-2 text-sm font-semibold text-danger hover:bg-danger-surface"
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
        onCancel={() => {
          setWithdrawError(null);
          setWithdrawOpen(false);
        }}
      />
    </div>
  );
}
