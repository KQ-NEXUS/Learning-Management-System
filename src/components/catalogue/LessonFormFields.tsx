"use client";

import { useState, type ReactNode } from "react";
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
  /** F-15 — the staff-set video length as "m:ss" (blank when unset). */
  videoLength?: string;
};

/** A course assessment a Quiz/Assignment lesson can link to. */
export type LinkableAssessment = {
  id: string;
  title: string;
  type: "QUIZ" | "ASSIGNMENT";
  status: string;
};

export type LessonFormFieldsProps = {
  lessonType: LessonType;
  /** This course's assessments; the picker offers the ones matching the lesson type. */
  assessmentOptions?: LinkableAssessment[];
  lessonId?: string;
  values?: LessonFieldValues;
  errors?: FieldError[];
  initialResources?: LessonResourceView[];
  /** Rendered right after the title, in the main column (the lesson type picker). */
  typeControl?: ReactNode;
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
      <p className="text-sm font-medium text-foreground">
        {optional ? "Optional introductory prose" : "Lesson content"}
        {!optional && (
          <span className="ml-1 font-normal text-muted-foreground">
            required
          </span>
        )}
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
  typeControl,
  assessmentOptions,
}: LessonFormFieldsProps) {
  const errorFor = (name: string) =>
    errors.find((error) => error.name === name)?.message;
  const initialBody = values.body ?? "";

  const hasFiles =
    lessonType === "FILE" || lessonType === "IMAGE" || lessonType === "VIDEO";

  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
      <div className="flex min-w-0 flex-col gap-7 lg:pr-14">
        <FormField
          name="title"
          label="Title"
          required
          error={errorFor("title")}
        >
          {(field) => (
            <TextInput
              {...field}
              type="text"
              required
              maxLength={200}
              defaultValue={values.title ?? ""}
              className="!h-14 text-[20px] font-semibold"
            />
          )}
        </FormField>

        {typeControl}

        {lessonType === "TEXT" && (
          <BodyEditor
            initialBody={initialBody}
            error={errorFor("body")}
            optional={false}
          />
        )}

        {hasFiles && (
          <BodyEditor
            initialBody={initialBody}
            error={errorFor("body")}
            optional
          />
        )}

        {lessonType === "VIDEO" && (
          <FormField
            name="videoDurationSeconds"
            label="Video length"
            error={errorFor("videoDurationSeconds")}
            hint="Optional. Minutes:seconds, for example 12:30. When set, a learner must watch 90% of this length to complete the lesson."
          >
            {(field) => (
              <TextInput
                {...field}
                type="text"
                inputMode="numeric"
                defaultValue={values.videoLength ?? ""}
                placeholder="12:30"
                mono
                className="max-w-[10rem]"
              />
            )}
          </FormField>
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
            <BodyEditor
              initialBody={initialBody}
              error={errorFor("body")}
              optional
            />
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
            <BodyEditor
              initialBody={initialBody}
              error={errorFor("body")}
              optional
            />
          </>
        )}

        {(lessonType === "QUIZ" || lessonType === "ASSIGNMENT") && (() => {
          const kind = lessonType === "QUIZ" ? "quiz" : "assignment";
          const matching = (assessmentOptions ?? []).filter(
            (a) => a.type === lessonType && a.status !== "ARCHIVED",
          );
          return (
            <FormField
              name="assessmentId"
              label={lessonType === "QUIZ" ? "Quiz" : "Assignment"}
              error={errorFor("assessmentId")}
              hint={
                matching.length === 0
                  ? `This course has no ${kind} yet. Create one under Assessments, then link it here.`
                  : `Learners see the linked ${kind} in this lesson once it is published.`
              }
            >
              {(field) => (
                <select
                  {...field}
                  defaultValue={values.assessmentId ?? ""}
                  className="h-12 rounded-md border border-input-border bg-surface px-4 py-2 text-sm text-foreground"
                >
                  <option value="">{matching.length === 0 ? `No ${kind} to link` : `Choose a ${kind}`}</option>
                  {matching.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title}
                      {a.status === "PUBLISHED" ? "" : " (draft)"}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
          );
        })()}
      </div>

      <aside className="flex min-w-0 flex-col gap-8 lg:border-l lg:border-border lg:pl-10 [&_fieldset]:min-w-0">
        <section className="flex flex-col gap-4">
          <h3 className="text-[20px] leading-[1.2] font-semibold tracking-[-0.015em] text-foreground">
            Completion
          </h3>
          <div className="flex flex-col gap-4 border-t border-foreground pt-4">
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                name="required"
                defaultChecked={values.required ?? true}
                className="mt-1 size-5 rounded-md border border-input-border accent-accent"
              />
              <span>
                <span className="block font-semibold text-foreground">
                  Required
                </span>
                <span className="block text-sm text-muted-foreground">
                  Learners must complete this lesson.
                </span>
              </span>
            </label>
            {lessonType === "QUIZ" || lessonType === "ASSIGNMENT" ? (
              // A-01: these lessons are completed by their assessment, so there is no manual
              // control to offer. No `allowManualComplete` field is sent, which saves it as off.
              <p className="text-sm text-muted-foreground">
                {lessonType === "QUIZ"
                  ? "This lesson is marked complete automatically when the learner passes the quiz."
                  : "This lesson is marked complete automatically when the learner submits the assignment."}
              </p>
            ) : (
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  name="allowManualComplete"
                  defaultChecked={values.allowManualComplete ?? true}
                  className="mt-1 size-5 rounded-md border border-input-border accent-accent"
                />
                <span>
                  <span className="block font-semibold text-foreground">
                    Allow manual complete
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    Show a learner completion control.
                  </span>
                </span>
              </label>
            )}
          </div>
        </section>

        {hasFiles && (
          <section className="flex flex-col gap-4">
            <h3 className="text-[20px] leading-[1.2] font-semibold tracking-[-0.015em] text-foreground">
              Files
            </h3>
            <div className="border-t border-foreground pt-4">
              {lessonId ? (
                <UploadPanel
                  lessonId={lessonId}
                  lessonType={lessonType}
                  initialResources={initialResources}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Save the lesson once before uploading resources.
                </p>
              )}
            </div>
          </section>
        )}
      </aside>
    </div>
  );
}
