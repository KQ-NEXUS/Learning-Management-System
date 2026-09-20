"use client";

/**
 * The Assessment authoring form (ASM-01, ASM-03).
 *
 * Unlike `LessonFormFields` (fields only, with a separate `LessonEditorClient`
 * owning the `ResourceForm`/`useActionState` wiring), this component owns both
 * — the create and edit routes (`new/page.tsx`, `[assessmentId]/page.tsx`) are
 * Server Components that fetch data and render this single client island,
 * mirroring `LessonEditorClient` + `LessonFormFields`'s combined shape in one
 * file (plan 10-08's file budget has no room for a third).
 *
 * A shared header block (title, instructions, availability window) is
 * followed by exactly ONE type-specific group, switched on `type` — never
 * both at once (a must-have truth for this plan). In edit mode, a
 * `ReadinessPanel` renders the SAME `evaluateAssessmentReadiness` output the
 * server-side publish refusal checks against (T-10-14), a Publish control,
 * an Archive control (CAT-08), and a commented placeholder for plan 10-10's
 * question builder.
 */

import { useActionState, useState } from "react";
import { PageHeader } from "@/components/shell/PageHeader";
import { useRouter } from "next/navigation";
import {
  ResourceForm,
  FormField,
  TextInput,
  DetailFacts,
  ConfirmModal,
  type FieldError,
} from "@/components/primitives";
import { ReadinessPanel } from "./ReadinessPanel";
import type { ReadinessItem } from "@/server/services/readiness-service";
import { FEEDBACK_BEHAVIOURS } from "@/server/services/assessment-readiness";
import { ALLOWED_ASSIGNMENT_FILE_TYPES } from "@/lib/assignment-file-types";
import {
  createAssessmentAction,
  updateAssessmentAction,
  publishAssessmentAction,
  archiveAssessmentAction,
  type SaveAssessmentState,
} from "@/app/staff/courses/[id]/assessments/actions";

export type AssessmentFieldValues = {
  type: "QUIZ" | "ASSIGNMENT";
  title: string;
  instructions: string | null;
  availableFrom: string | null;
  availableUntil: string | null;
  feedbackBehaviour: string;
  passMark: number | null;
  totalMarks: number | null;
  maxAttempts: number | null;
  attemptGradingMethod: string;
  dueAt: string | null;
  allowedFileTypes: string[];
  maxFileSizeBytes: number | null;
  allowResubmission: boolean;
};

type AssessmentFormFieldsProps = {
  courseId: string;
} & (
  | { mode: "create" }
  | {
      mode: "edit";
      assessmentId: string;
      status: string;
      version: number;
      readinessItems: ReadinessItem[];
      initialValues: AssessmentFieldValues;
    }
);

const DEFAULT_VALUES: AssessmentFieldValues = {
  type: "QUIZ",
  title: "",
  instructions: null,
  availableFrom: null,
  availableUntil: null,
  feedbackBehaviour: "ON_RELEASE",
  passMark: null,
  totalMarks: null,
  maxAttempts: null,
  attemptGradingMethod: "HIGHEST",
  dueAt: null,
  allowedFileTypes: [],
  maxFileSizeBytes: null,
  allowResubmission: false,
};

const INITIAL_SAVE_STATE: SaveAssessmentState = { ok: null, errors: [], message: null };

const ATTEMPT_GRADING_METHODS: { value: string; label: string }[] = [
  { value: "HIGHEST", label: "Highest" },
  { value: "LATEST", label: "Latest" },
  { value: "AVERAGE", label: "Average" },
];

const FEEDBACK_LABELS: Record<string, string> = {
  ON_RELEASE: "On release",
  IMMEDIATE: "Immediate",
  NEVER: "Never",
};

const BTN_PRIMARY =
  "rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-50";
const BTN_DANGER =
  "rounded-md border border-danger/40 bg-surface px-4 py-2 text-sm font-semibold text-danger hover:bg-danger-surface disabled:cursor-not-allowed disabled:opacity-50";

export function AssessmentFormFields(props: AssessmentFormFieldsProps) {
  const { courseId, mode } = props;
  const router = useRouter();

  const initial: AssessmentFieldValues = mode === "edit" ? props.initialValues : DEFAULT_VALUES;

  const [type, setType] = useState<"QUIZ" | "ASSIGNMENT">(initial.type);
  const [fileTypes, setFileTypes] = useState<string[]>(initial.allowedFileTypes);

  const boundAction =
    mode === "edit"
      ? (prev: SaveAssessmentState, form: FormData) =>
          updateAssessmentAction(props.assessmentId, prev, form)
      : createAssessmentAction;

  const [state, formAction, pending] = useActionState(boundAction, INITIAL_SAVE_STATE);

  const [publishPending, setPublishPending] = useState(false);
  const [publishErrors, setPublishErrors] = useState<FieldError[]>([]);

  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  async function handlePublish() {
    if (mode !== "edit") return;
    setPublishPending(true);
    setPublishErrors([]);
    try {
      const result = await publishAssessmentAction({ assessmentId: props.assessmentId });
      if (!result.ok) {
        setPublishErrors(
          result.items.length > 0 ? result.items.map((item) => ({
            name: item.id,
            message: item.detail ? `${item.label} — ${item.detail}` : item.label,
          })) : [{ name: "title", message: result.message }],
        );
      }
    } catch {
      setPublishErrors([{ name: "title", message: "The assessment could not be published. Try again." }]);
    } finally {
      setPublishPending(false);
    }
  }

  async function confirmArchive(reason: string) {
    if (mode !== "edit") return;
    setArchiving(true);
    setArchiveError(null);
    try {
      const result = await archiveAssessmentAction({
        assessmentId: props.assessmentId,
        courseId,
        reason,
      });
      if (result.ok) {
        router.push(`/staff/courses/${courseId}/assessments`);
        return;
      }
      setArchiveError(result.message);
    } catch {
      setArchiveError("The assessment was not archived.");
    } finally {
      setArchiving(false);
    }
  }

  const errorFor = (name: string) =>
    (!state.ok ? state.errors : []).find((error) => error.name === name)?.message;

  const combinedErrors: FieldError[] = [...(!state.ok ? state.errors : []), ...publishErrors];

  const published = mode === "edit" && props.status === "PUBLISHED";
  const archived = mode === "edit" && props.status === "ARCHIVED";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={mode === "create" ? "New assessment" : "Edit assessment"}
        identifier={mode === "edit" ? props.assessmentId : undefined}
        breadcrumbs={[{ label: "Courses", href: "/staff/courses" }, { label: "Assessments" }]}
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
        <p role="alert" className="border border-danger/30 bg-danger-surface px-4 py-2 text-sm text-danger">
          {state.message}
        </p>
      )}

      <ResourceForm
        title={mode === "create" ? "New assessment" : "Assessment details"}
        subtitle={
          mode === "create"
            ? "Choose Quiz or Assignment, then fill in its settings."
            : undefined
        }
        submitLabel={mode === "create" ? "Create assessment" : "Save changes"}
        errors={combinedErrors}
        pending={pending}
        onSubmit={formAction}
        onCancel={() => router.push(`/staff/courses/${courseId}/assessments`)}
      >
        <input type="hidden" name="courseId" value={courseId} />
        <input type="hidden" name="type" value={type} />

        <div className="flex flex-col gap-1">
          <label
            htmlFor="assessment-type"
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Type
          </label>
          {mode === "create" ? (
            <select
              id="assessment-type"
              value={type}
              onChange={(event) => setType(event.target.value as "QUIZ" | "ASSIGNMENT")}
              className="h-[38px] rounded-md border border-input-border bg-surface px-4 py-2 text-sm text-foreground"
            >
              <option value="QUIZ">Quiz</option>
              <option value="ASSIGNMENT">Assignment</option>
            </select>
          ) : (
            <p
              id="assessment-type"
              className="rounded-md border border-input-border bg-surface-2 px-4 py-2 text-sm text-muted-foreground"
            >
              {type === "QUIZ" ? "Quiz" : "Assignment"} — the type is fixed once an assessment is
              created.
            </p>
          )}
        </div>

        <FormField name="title" label="Title" required error={errorFor("title")}>
          {(field) => (
            <TextInput {...field} type="text" required maxLength={200} defaultValue={initial.title} />
          )}
        </FormField>

        <FormField name="instructions" label="Instructions" error={errorFor("instructions")}>
          {(field) => (
            <textarea
              {...field}
              rows={4}
              maxLength={10_000}
              defaultValue={initial.instructions ?? ""}
              className="min-h-[92px] rounded-md border border-input-border bg-surface px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground aria-[invalid=true]:border-danger"
            />
          )}
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField name="availableFrom" label="Available from" error={errorFor("availableFrom")}>
            {(field) => (
              <TextInput {...field} type="datetime-local" mono defaultValue={initial.availableFrom ?? ""} />
            )}
          </FormField>
          <FormField name="availableUntil" label="Available until" error={errorFor("availableUntil")}>
            {(field) => (
              <TextInput
                {...field}
                type="datetime-local"
                mono
                defaultValue={initial.availableUntil ?? ""}
              />
            )}
          </FormField>
        </div>

        {type === "QUIZ" ? (
          <QuizFields initial={initial} errorFor={errorFor} />
        ) : (
          <AssignmentFields
            initial={initial}
            errorFor={errorFor}
            fileTypes={fileTypes}
            onFileTypesChange={setFileTypes}
          />
        )}
      </ResourceForm>

      {mode === "edit" && <ReadinessPanel items={props.readinessItems} />}

      {mode === "edit" && (
        <div className="flex flex-col items-start gap-2 border-t border-foreground pt-5">
          <p className="text-sm font-semibold">Publish</p>
          <p className="max-w-prose text-sm text-muted-foreground">
            {published
              ? `Published — version ${props.version}. Publishing again bumps the version.`
              : "Publishing is blocked while any blocking check above is failing."}
          </p>
          <button
            type="button"
            onClick={handlePublish}
            disabled={publishPending || archived}
            className={BTN_PRIMARY}
          >
            {publishPending ? "Publishing…" : "Publish"}
          </button>
        </div>
      )}

      {mode === "edit" && !archived && (
        <div className="flex flex-col items-start gap-2 border-t border-foreground pt-5">
          <p className="text-sm font-semibold">Archive this assessment</p>
          <p className="max-w-prose text-sm text-muted-foreground">
            It leaves every staff authoring list. It cannot be deleted — archiving is the only
            removal path throughout this product (CAT-08).
          </p>
          <button
            type="button"
            onClick={() => {
              setArchiveError(null);
              setArchiveOpen(true);
            }}
            className={BTN_DANGER}
          >
            Archive assessment
          </button>
        </div>
      )}

      {mode === "edit" && (
        <ConfirmModal
          open={archiveOpen}
          title="Archive this assessment"
          description="It leaves every staff authoring list. This cannot be undone from this screen — archiving is the only removal path (CAT-08)."
          confirmLabel="Archive assessment"
          minReasonLength={10}
          reasonLabel="Reason for archiving"
          pending={archiving}
          error={archiveError}
          onConfirm={confirmArchive}
          onCancel={() => setArchiveOpen(false)}
        />
      )}
    </div>
  );
}

function QuizFields({
  initial,
  errorFor,
}: {
  initial: AssessmentFieldValues;
  errorFor: (name: string) => string | undefined;
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          name="maxAttempts"
          label="Max attempts"
          hint="Leave blank for unlimited."
          error={errorFor("maxAttempts")}
        >
          {(field) => (
            <TextInput {...field} type="number" min={1} step={1} mono defaultValue={initial.maxAttempts ?? ""} />
          )}
        </FormField>
        <FormField name="passMark" label="Pass mark" error={errorFor("passMark")}>
          {(field) => (
            <TextInput {...field} type="number" min={0} step={1} mono defaultValue={initial.passMark ?? ""} />
          )}
        </FormField>
      </div>

      <DetailFacts
        facts={[
          {
            label: "Total marks",
            value: initial.totalMarks ?? "Not yet computed — add questions to compute this.",
            mono: initial.totalMarks != null,
          },
        ]}
      />

      <div className="flex flex-col gap-1">
        <span className="text-sm font-semibold text-foreground">Attempt grading method</span>
        <AttemptGradingMethodControl defaultValue={initial.attemptGradingMethod} />
      </div>

      <FormField name="feedbackBehaviour" label="Feedback behaviour" error={errorFor("feedbackBehaviour")}>
        {(field) => (
          <select
            {...field}
            defaultValue={initial.feedbackBehaviour}
            className="h-[38px] rounded-md border border-input-border bg-surface px-4 py-2 text-sm text-foreground"
          >
            {FEEDBACK_BEHAVIOURS.map((value) => (
              <option key={value} value={value}>
                {FEEDBACK_LABELS[value]}
              </option>
            ))}
          </select>
        )}
      </FormField>
    </>
  );
}

/** Reuses `ResourceTable`'s existing ≤4-option segmented-filter markup verbatim (UI-SPEC §7.1). */
function AttemptGradingMethodControl({ defaultValue }: { defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div
      role="group"
      aria-label="Attempt grading method"
      className="flex h-8 w-fit items-center gap-1 rounded-md border border-input-border bg-surface-2 p-1"
    >
      <input type="hidden" name="attemptGradingMethod" value={value} />
      {ATTEMPT_GRADING_METHODS.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => setValue(option.value)}
            className={`rounded-md px-2 py-1 text-sm font-semibold ${
              active ? "bg-surface text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function AssignmentFields({
  initial,
  errorFor,
  fileTypes,
  onFileTypesChange,
}: {
  initial: AssessmentFieldValues;
  errorFor: (name: string) => string | undefined;
  fileTypes: string[];
  onFileTypesChange: (next: string[]) => void;
}) {
  return (
    <>
      <FormField name="dueAt" label="Due date" error={errorFor("dueAt")}>
        {(field) => <TextInput {...field} type="datetime-local" mono defaultValue={initial.dueAt ?? ""} />}
      </FormField>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-semibold text-foreground">
          Allowed file types
          <span className="ml-1 text-xs font-normal text-muted-foreground" aria-hidden>
            required
          </span>
        </span>
        <div role="group" aria-label="Allowed file types" className="flex flex-wrap gap-2">
          {ALLOWED_ASSIGNMENT_FILE_TYPES.map((extension) => {
            const active = fileTypes.includes(extension);
            return (
              <button
                key={extension}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  onFileTypesChange(
                    active ? fileTypes.filter((value) => value !== extension) : [...fileTypes, extension],
                  )
                }
                className={`rounded-full border px-3 py-1 font-mono text-xs ${
                  active
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-input-border bg-surface text-muted-foreground hover:text-foreground"
                }`}
              >
                {extension}
              </button>
            );
          })}
        </div>
        {fileTypes.map((extension) => (
          <input key={extension} type="hidden" name="allowedFileTypes" value={extension} />
        ))}
        {errorFor("allowedFileTypes") && (
          <p role="alert" className="text-sm text-danger">
            {errorFor("allowedFileTypes")}
          </p>
        )}
      </div>

      <MaxFileSizeField initial={initial.maxFileSizeBytes} error={errorFor("maxFileSizeBytes")} />

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField name="totalMarks" label="Total marks" error={errorFor("totalMarks")}>
          {(field) => (
            <TextInput {...field} type="number" min={0} step={1} mono defaultValue={initial.totalMarks ?? ""} />
          )}
        </FormField>
        <FormField name="passMark" label="Pass mark" error={errorFor("passMark")}>
          {(field) => (
            <TextInput {...field} type="number" min={0} step={1} mono defaultValue={initial.passMark ?? ""} />
          )}
        </FormField>
      </div>

      <label className="flex items-start gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-sm shadow-xs">
        <input
          type="checkbox"
          name="allowResubmission"
          defaultChecked={initial.allowResubmission}
          className="mt-1 size-4 rounded-[4px] border-[1.5px] border-input-border accent-accent"
        />
        <span>
          <span className="block font-semibold text-foreground">Allow resubmission</span>
          <span className="block text-sm text-muted-foreground">
            Learners may submit a new version after their first.
          </span>
        </span>
      </label>

      <FormField name="feedbackBehaviour" label="Feedback behaviour" error={errorFor("feedbackBehaviour")}>
        {(field) => (
          <select
            {...field}
            defaultValue={initial.feedbackBehaviour}
            className="h-[38px] rounded-md border border-input-border bg-surface px-4 py-2 text-sm text-foreground"
          >
            {FEEDBACK_BEHAVIOURS.map((value) => (
              <option key={value} value={value}>
                {FEEDBACK_LABELS[value]}
              </option>
            ))}
          </select>
        )}
      </FormField>
    </>
  );
}

/** Live "N MB" hint as the byte count is typed, per UI-SPEC §7.1. */
function MaxFileSizeField({ initial, error }: { initial: number | null; error?: string }) {
  const [bytes, setBytes] = useState<string>(initial != null ? String(initial) : "");
  const numeric = Number(bytes);
  const mb = bytes.length > 0 && Number.isFinite(numeric) ? (numeric / (1024 * 1024)).toFixed(1) : null;

  return (
    <FormField
      name="maxFileSizeBytes"
      label="Maximum file size"
      hint={mb ? `${mb} MB` : "Enter a byte count."}
      error={error}
    >
      {(field) => (
        <TextInput
          {...field}
          type="number"
          min={1}
          step={1}
          mono
          value={bytes}
          onChange={(event) => setBytes(event.target.value)}
        />
      )}
    </FormField>
  );
}
