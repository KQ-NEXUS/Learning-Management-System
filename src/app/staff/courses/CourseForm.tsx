"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { ResourceForm, FormField, TextInput } from "@/components/primitives";
import { CertificateSettingsFields, type SelectableTemplate } from "@/components/catalogue";
import { createCourseAction, updateCourseAction, type CourseActionResult } from "./actions";

const INITIAL: CourseActionResult = { ok: false, errors: [], message: null };

/** Plain serialisable values handed in by the edit page (no Date, no Prisma object). */
export type CourseFormValues = {
  title: string;
  slug: string;
  summary: string | null;
  outcomes: string | null;
  audience: string | null;
  prerequisites: string | null;
  durationHours: number | null;
  certificateEnabled: boolean;
  certificateIssuanceMode: "AUTOMATIC" | "MANUAL";
  certificateTemplateId: string | null;
  /** Name of the stored template, used only to label it if it has been archived. */
  certificateTemplateName?: string | null;
};

export function CourseForm(
  props:
    | { mode: "create"; templates?: SelectableTemplate[] }
    | {
        mode: "edit";
        courseId: string;
        values: CourseFormValues;
        templates?: SelectableTemplate[];
      },
) {
  const { mode } = props;
  const templates = props.templates ?? [];
  const values = props.mode === "edit" ? props.values : null;
  const router = useRouter();
  const action = props.mode === "create" ? createCourseAction : updateCourseAction;
  const [state, formAction, pending] = useActionState(action, INITIAL);
  // Lifted so the issuance-mode/template controls below can react live to
  // the checkbox in the same form session, without a page reload — a
  // Course with certificates off offers no meaningful issuance choice.
  const [certificateEnabled, setCertificateEnabled] = useState(
    values?.certificateEnabled ?? false,
  );
  // Controlled so a rejected save keeps typed text (CR-09 / NFR-09), as on
  // ProgrammeForm — React 19 resets uncontrolled fields after an action.
  const [outcomes, setOutcomes] = useState(values?.outcomes ?? "");
  const [prerequisites, setPrerequisites] = useState(values?.prerequisites ?? "");
  const storedTemplateId = values?.certificateTemplateId ?? null;
  // A stored template that has since been archived is absent from the
  // selectable list; keep it visible so the form does not silently show
  // "Use the default template" (T-11-85).
  const archivedTemplate =
    storedTemplateId && !templates.some((template) => template.id === storedTemplateId)
      ? { id: storedTemplateId, name: values?.certificateTemplateName || "Current template" }
      : undefined;
  const errorFor = (name: string) =>
    (!state.ok ? state.errors : []).find((error) => error.name === name)?.message;

  return (
    <>
      {state.ok === false && state.message && (
        <p role="alert" className="mb-4 rounded-md border border-danger/30 bg-danger-surface px-4 py-2 text-sm text-danger">
          {state.message}
        </p>
      )}
      {mode === "edit" && state.ok && (
        <p role="status" className="mb-4 rounded-md border border-success/30 bg-success/10 px-4 py-2 text-sm text-success">
          Saved.
        </p>
      )}

      <ResourceForm
        title={"Details"}
        submitLabel={mode === "create" ? "Create course" : "Save changes"}
        errors={!state.ok ? state.errors : []}
        pending={pending}
        onSubmit={formAction}
        onCancel={() => router.push("/staff/courses")}
      >
        {props.mode === "edit" && <input type="hidden" name="courseId" value={props.courseId} />}

        <FormField name="title" label="Title" required error={errorFor("title")}>
          {(field) => (
            <TextInput
              {...field}
              type="text"
              required
              maxLength={200}
              defaultValue={values?.title ?? ""}
            />
          )}
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
              defaultValue={values?.slug ?? ""}
              placeholder="workplace-safety-essentials"
            />
          )}
        </FormField>

        <FormField name="summary" label="Summary" error={errorFor("summary")}>
          {(field) => (
            <TextInput
              {...field}
              type="text"
              maxLength={2000}
              defaultValue={values?.summary ?? ""}
            />
          )}
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
              value={outcomes}
              onChange={(event) => setOutcomes(event.target.value)}
              className="min-h-[92px] rounded-md border border-input-border bg-surface px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground aria-[invalid=true]:border-danger"
            />
          )}
        </FormField>

        <FormField name="audience" label="Audience" error={errorFor("audience")}>
          {(field) => (
            <TextInput
              {...field}
              type="text"
              maxLength={2000}
              defaultValue={values?.audience ?? ""}
            />
          )}
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
              value={prerequisites}
              onChange={(event) => setPrerequisites(event.target.value)}
              className="min-h-[76px] rounded-md border border-input-border bg-surface px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground aria-[invalid=true]:border-danger"
            />
          )}
        </FormField>

        <FormField name="durationHours" label="Duration hours" error={errorFor("durationHours")}>
          {(field) => (
            <TextInput
              {...field}
              type="number"
              min={0}
              step={1}
              mono
              defaultValue={values?.durationHours ?? ""}
            />
          )}
        </FormField>

        <div className="flex items-start gap-2 rounded-md border border-input-border bg-surface px-4 py-2 text-sm">
          <input
            id="field-certificateEnabled"
            type="checkbox"
            name="certificateEnabled"
            checked={certificateEnabled}
            onChange={(event) => setCertificateEnabled(event.target.checked)}
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

        <CertificateSettingsFields
          certificateEnabled={certificateEnabled}
          templates={templates}
          values={
            values
              ? {
                  certificateIssuanceMode: values.certificateIssuanceMode,
                  certificateTemplateId: values.certificateTemplateId,
                }
              : undefined
          }
          archivedTemplate={archivedTemplate}
          errors={!state.ok ? state.errors : []}
        />
      </ResourceForm>
    </>
  );
}
