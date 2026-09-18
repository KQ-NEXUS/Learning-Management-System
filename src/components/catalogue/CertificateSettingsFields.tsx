"use client";

import { FormField } from "@/components/primitives";
import type { FieldError } from "@/components/primitives";

/** A row from `listSelectableTemplates()` — non-archived only (Pitfall 5). */
export type SelectableTemplate = {
  id: string;
  name: string;
  isDefault: boolean;
};

export type CertificateSettingsValues = {
  certificateIssuanceMode?: "AUTOMATIC" | "MANUAL";
  certificateTemplateId?: string | null;
};

export type CertificateSettingsFieldsProps = {
  /**
   * Whether the parent Course/Programme's `certificateEnabled` is currently
   * on. When false both controls still render (accessible-name assertions
   * in the component test depend on this) but are `disabled` — an issuance
   * mode or template for something that issues nothing is a meaningless
   * choice (11-UI-SPEC's "nothing here promises a page the product cannot
   * open" restraint).
   */
  certificateEnabled: boolean;
  /** Non-archived templates only — `listSelectableTemplates()`'s output. */
  templates: SelectableTemplate[];
  values?: CertificateSettingsValues;
  errors?: FieldError[];
};

const ISSUANCE_OPTIONS = [
  {
    value: "AUTOMATIC",
    label: "Automatic",
    hint: "issue as soon as the learner completes",
  },
  {
    value: "MANUAL",
    label: "Manual",
    hint: "a staff member signs off first",
  },
] as const;

/**
 * Issuance-mode segmented control + template picker (D-02, D-10) — shared by
 * `CourseForm` and `ProgrammeForm` so exactly one implementation of these two
 * controls exists (plan 11-08 Task 2).
 *
 * Disabled inputs are excluded from `FormData` by the browser, so
 * `certificateIssuanceMode`/`certificateTemplateId` are absent from the
 * submission whenever `certificateEnabled` is false — the consuming action's
 * zod schema treats both fields as optional for exactly this reason.
 */
export function CertificateSettingsFields({
  certificateEnabled,
  templates,
  values = {},
  errors = [],
}: CertificateSettingsFieldsProps) {
  const errorFor = (name: string) => errors.find((error) => error.name === name)?.message;
  const issuanceMode = values.certificateIssuanceMode ?? "MANUAL";
  const templateId = values.certificateTemplateId ?? "";
  const issuanceError = errorFor("certificateIssuanceMode");

  return (
    <>
      <fieldset className="flex flex-col gap-1 border-0 p-0 m-0">
        <legend className="text-sm font-semibold text-foreground">Certificate issuance</legend>
        <div
          role="radiogroup"
          aria-label="Certificate issuance"
          className="flex flex-col gap-2 rounded-md border border-input-border bg-surface-2 p-1 sm:flex-row"
        >
          {ISSUANCE_OPTIONS.map((option) => {
            const id = `field-certificateIssuanceMode-${option.value}`;
            return (
              <label
                key={option.value}
                htmlFor={id}
                className="flex flex-1 items-start gap-2 rounded-md px-3 py-2 text-sm has-[:checked]:bg-surface has-[:checked]:shadow-xs has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
              >
                <input
                  id={id}
                  type="radio"
                  name="certificateIssuanceMode"
                  value={option.value}
                  defaultChecked={issuanceMode === option.value}
                  disabled={!certificateEnabled}
                  aria-describedby={issuanceError ? "field-certificateIssuanceMode-err" : undefined}
                  className="mt-1 size-4 border-[1.5px] border-input-border accent-accent"
                />
                <span>
                  <span className="block font-semibold text-foreground">
                    {option.label} — {option.hint}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        {issuanceError && (
          <p id="field-certificateIssuanceMode-err" role="alert" className="text-sm text-danger">
            {issuanceError}
          </p>
        )}
      </fieldset>

      <FormField
        name="certificateTemplateId"
        label="Certificate template"
        error={errorFor("certificateTemplateId")}
      >
        {(field) => (
          <select
            {...field}
            disabled={!certificateEnabled}
            defaultValue={templateId}
            className="h-[38px] rounded-md border border-input-border bg-surface px-4 py-2 text-sm text-foreground disabled:bg-surface-2 disabled:text-muted-foreground aria-[invalid=true]:border-danger"
          >
            <option value="">Use the default template</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
                {template.isDefault ? " (default)" : ""}
              </option>
            ))}
          </select>
        )}
      </FormField>
    </>
  );
}
