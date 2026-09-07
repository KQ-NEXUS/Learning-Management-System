"use client";

import { useState } from "react";
import { FormField, TextInput, type FieldError } from "@/components/primitives";
import { EMBED_HOST_ALLOWLIST } from "@/lib/embed-url";
import type { LessonType } from "@/lib/upload-limits";
import { RichTextEditor } from "./RichTextEditor";
import { UploadPanel, type LessonResourceView } from "./UploadPanel";

export type LessonFieldValues = {
  title?: string;
  body?: string;
  embedUrl?: string;
  linkUrl?: string;
  required?: boolean;
  allowManualComplete?: boolean;
  assessmentId?: string | null;
};

export type LessonFormFieldsProps = {
  lessonType: LessonType;
  lessonId?: string;
  values?: LessonFieldValues;
  errors?: FieldError[];
  initialResources?: LessonResourceView[];
};

// The editable textbox carries this id so the ResourceForm error summary can
// link straight to it; the error paragraph carries a matching stable id so the
// editor's aria-describedby resolves (WR-03, NFR-09).
const BODY_FIELD_ID = "field-body";
const BODY_ERROR_ID = "body-error";

function BodyEditor({
  initialBody,
  error,
  optional,
}: {
  initialBody: string;
  error?: string;
  optional: boolean;
}) {
  const [body, setBody] = useState(initialBody);
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {optional ? "Optional introductory prose" : "Lesson content"}
        {!optional && <span className="ml-1 font-normal text-muted-foreground">required</span>}
      </p>
      <input type="hidden" name="body" value={body} />
      <RichTextEditor
        value={body}
        onChange={setBody}
        id={BODY_FIELD_ID}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? BODY_ERROR_ID : undefined}
      />
      {error && (
        <p id={BODY_ERROR_ID} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function LessonFormFields({
  lessonType,
  lessonId,
  values = {},
  errors = [],
  initialResources,
}: LessonFormFieldsProps) {
  const errorFor = (name: string) => errors.find((error) => error.name === name)?.message;
  const initialBody = values.body ?? "";

  return (
    <>
      <FormField name="title" label="Title" required error={errorFor("title")}>
        {(field) => (
          <TextInput
            {...field}
            type="text"
            required
            maxLength={200}
            defaultValue={values.title ?? ""}
          />
        )}
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex items-start gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-sm shadow-xs">
          <input
            type="checkbox"
            name="required"
            defaultChecked={values.required ?? true}
            className="mt-1 size-4 rounded-md border border-input-border accent-accent"
          />
          <span>
            <span className="block font-semibold text-foreground">Required</span>
            <span className="block text-sm text-muted-foreground">Learners must complete this lesson.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-sm shadow-xs">
          <input
            type="checkbox"
            name="allowManualComplete"
            defaultChecked={values.allowManualComplete ?? true}
            className="mt-1 size-4 rounded-md border border-input-border accent-accent"
          />
          <span>
            <span className="block font-semibold text-foreground">Allow manual complete</span>
            <span className="block text-sm text-muted-foreground">Show a learner completion control.</span>
          </span>
        </label>
      </div>

      {lessonType === "TEXT" && (
        <BodyEditor initialBody={initialBody} error={errorFor("body")} optional={false} />
      )}

      {(lessonType === "FILE" || lessonType === "IMAGE" || lessonType === "VIDEO") && (
        <>
          {lessonId ? (
            <UploadPanel
              lessonId={lessonId}
              lessonType={lessonType}
              initialResources={initialResources}
            />
          ) : (
            <p className="rounded-xl border border-border bg-surface-2 px-4 py-2 text-sm text-muted-foreground shadow-xs">
              Save the lesson once before uploading resources.
            </p>
          )}
          <BodyEditor initialBody={initialBody} error={errorFor("body")} optional />
        </>
      )}

      {lessonType === "EMBED" && (
        <>
          <FormField
            name="embedUrl"
            label="Embed URL"
            required
            error={errorFor("embedUrl")}
            hint={`Allowed hosts: ${EMBED_HOST_ALLOWLIST.join(", ")}. HTTPS only.`}
          >
            {(field) => (
              <TextInput
                {...field}
                type="url"
                required
                defaultValue={values.embedUrl ?? ""}
                placeholder="https://www.youtube.com/watch?v=…"
                mono
              />
            )}
          </FormField>
          <BodyEditor initialBody={initialBody} error={errorFor("body")} optional />
        </>
      )}

      {lessonType === "LINK" && (
        <>
          <FormField
            name="linkUrl"
            label="Link URL"
            required
            error={errorFor("linkUrl")}
            hint="Use a full HTTPS address."
          >
            {(field) => (
              <TextInput
                {...field}
                type="url"
                required
                defaultValue={values.linkUrl ?? ""}
                placeholder="https://example.com/resource"
                mono
              />
            )}
          </FormField>
          <BodyEditor initialBody={initialBody} error={errorFor("body")} optional />
        </>
      )}

      {(lessonType === "QUIZ" || lessonType === "ASSIGNMENT") && (
        <FormField
          name="assessmentId"
          label="Assessment"
          hint="No assessments exist yet — assessment authoring arrives in Phase 10."
        >
          {(field) => (
            <select
              {...field}
              disabled
              defaultValue=""
              className="rounded-md border border-input-border bg-surface-2 px-4 py-2 text-sm text-muted-foreground"
            >
              <option value="">No assessments available</option>
            </select>
          )}
        </FormField>
      )}
    </>
  );
}
