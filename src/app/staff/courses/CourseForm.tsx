"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { ResourceForm, FormField, TextInput } from "@/components/primitives";
import { createCourseAction, type CourseActionResult } from "./actions";

const INITIAL: CourseActionResult = { ok: false, errors: [], message: null };

export function CourseForm({ mode }: { mode: "create" }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(createCourseAction, INITIAL);
  const errorFor = (name: string) =>
    (!state.ok ? state.errors : []).find((error) => error.name === name)?.message;

  return (
    <>
      {state.ok === false && state.message && (
        <p role="alert" className="mb-4 rounded-md border border-danger/30 bg-danger-surface px-4 py-2 text-sm text-danger">
          {state.message}
        </p>
      )}

      <ResourceForm
        title={mode === "create" ? "New course" : "Course details"}
        submitLabel="Create course"
        errors={!state.ok ? state.errors : []}
        pending={pending}
        onSubmit={formAction}
        onCancel={() => router.push("/staff/courses")}
      >
        <FormField name="title" label="Title" required error={errorFor("title")}>
          {(field) => <TextInput {...field} type="text" required maxLength={200} />}
        </FormField>

        <FormField
          name="slug"
          label="Slug"
          required
          error={errorFor("slug")}
          hint="Lowercase letters, numbers and single hyphens. Frozen once the course is listed publicly."
        >
          {(field) => (
            <TextInput
              {...field}
              type="text"
              required
              maxLength={120}
              mono
              placeholder="workplace-safety-essentials"
            />
          )}
        </FormField>

        <FormField name="summary" label="Summary" error={errorFor("summary")}>
          {(field) => <TextInput {...field} type="text" maxLength={2000} />}
        </FormField>

        <FormField
          name="outcomes"
          label="Outcomes"
          error={errorFor("outcomes")}
          hint="What learners will be able to do after completing this course."
        >
          {(field) => (
            <textarea
              {...field}
              rows={4}
              maxLength={4000}
              className="min-h-[92px] rounded-md border border-input-border bg-surface px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground aria-[invalid=true]:border-danger"
            />
          )}
        </FormField>

        <FormField name="audience" label="Audience" error={errorFor("audience")}>
          {(field) => <TextInput {...field} type="text" maxLength={2000} />}
        </FormField>

        <FormField
          name="prerequisites"
          label="Prerequisites"
          error={errorFor("prerequisites")}
        >
          {(field) => (
            <textarea
              {...field}
              rows={3}
              maxLength={4000}
              className="min-h-[76px] rounded-md border border-input-border bg-surface px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground aria-[invalid=true]:border-danger"
            />
          )}
        </FormField>

        <FormField name="durationHours" label="Duration hours" error={errorFor("durationHours")}>
          {(field) => <TextInput {...field} type="number" min={0} step={1} mono />}
        </FormField>

        <div className="flex items-start gap-2 rounded-md border border-input-border bg-surface px-4 py-2 text-sm">
          <input
            id="field-certificateEnabled"
            type="checkbox"
            name="certificateEnabled"
            aria-describedby="field-certificateEnabled-hint"
            className="mt-1 size-4 rounded-[4px] border-[1.5px] border-input-border accent-accent"
          />
          <span>
            <label
              htmlFor="field-certificateEnabled"
              className="block font-semibold text-foreground"
            >
              Certificate enabled
            </label>
            <span
              id="field-certificateEnabled-hint"
              className="block text-sm text-muted-foreground"
            >
              This course can issue certificates once completion rules pass.
            </span>
          </span>
        </div>
      </ResourceForm>
    </>
  );
}
