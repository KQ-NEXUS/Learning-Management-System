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
    <div className="flex flex-col gap-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-600">
        {optional ? "Optional introductory prose" : "Lesson content"}
        {!optional && <span className="ml-1 font-normal text-zinc-400">required</span>}
      </p>
      <input type="hidden" name="body" value={body} />
      <RichTextEditor value={body} onChange={setBody} />
      {error && (
        <p role="alert" className="text-xs text-danger">
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

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-start gap-2 border border-zinc-200 px-3 py-2.5 text-sm">
          <input
            type="checkbox"
            name="required"
            defaultChecked={values.required ?? true}
            className="mt-0.5 size-4"
          />
          <span>
            <span className="block font-medium">Required</span>
            <span className="block text-xs text-zinc-500">Learners must complete this lesson.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 border border-zinc-200 px-3 py-2.5 text-sm">
          <input
            type="checkbox"
            name="allowManualComplete"
            defaultChecked={values.allowManualComplete ?? true}
            className="mt-0.5 size-4"
          />
          <span>
            <span className="block font-medium">Allow manual complete</span>
            <span className="block text-xs text-zinc-500">Show a learner completion control.</span>
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
            <p className="border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
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
              className="border border-zinc-300 bg-zinc-100 px-2.5 py-1.5 text-sm text-zinc-500"
            >
              <option value="">No assessments available</option>
            </select>
          )}
        </FormField>
      )}
    </>
  );
}
