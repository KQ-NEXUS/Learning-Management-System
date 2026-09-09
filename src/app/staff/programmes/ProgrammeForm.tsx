"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { ResourceForm, FormField, TextInput } from "@/components/primitives";
import {
  createProgrammeAction,
  updateProgrammeAction,
  type ProgrammeActionResult,
} from "./actions";

const INITIAL: ProgrammeActionResult = { ok: false, errors: [], message: null };

type Values = {
  title?: string;
  slug?: string;
  summary?: string | null;
  outcomes?: string | null;
  audience?: string | null;
  sequential?: boolean;
};

export function ProgrammeForm(
  props: { mode: "create" } | { mode: "edit"; programmeId: string; values: Values },
) {
  const router = useRouter();
  const action = props.mode === "create" ? createProgrammeAction : updateProgrammeAction;
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const values = props.mode === "edit" ? props.values : {};
  // Controlled so an attempted edit survives React 19's post-action form reset
  // and a rejected submission — a failed save must never discard entered text
  // (CR-09 / NFR-09). The existing action still receives it via FormData.
  const [outcomes, setOutcomes] = useState(values.outcomes ?? "");
  const errorFor = (name: string) =>
    (!state.ok ? state.errors : []).find((error) => error.name === name)?.message;

  return (
    <>
      {state.ok === false && state.message && (
        <p role="alert" className="mb-4 border border-danger/30 bg-danger-surface px-4 py-2 text-sm text-danger">
          {state.message}
        </p>
      )}
      {props.mode === "edit" && state.ok && (
        <p role="status" className="mb-4 border border-success/30 bg-success/10 px-4 py-2 text-sm text-success">
          Saved.
        </p>
      )}

      <ResourceForm
        title={props.mode === "create" ? "New programme" : "Programme details"}
        submitLabel={props.mode === "create" ? "Create programme" : "Save changes"}
        errors={!state.ok ? state.errors : []}
        pending={pending}
        onSubmit={formAction}
        onCancel={() => router.push("/staff/programmes")}
      >
        {props.mode === "edit" && (
          <input type="hidden" name="programmeId" value={props.programmeId} />
        )}

        <FormField name="title" label="Title" required error={errorFor("title")}>
          {(field) => (
            <TextInput {...field} type="text" required maxLength={200} defaultValue={values.title ?? ""} />
          )}
        </FormField>

        <FormField
          name="slug"
          label="Slug"
          required
          error={errorFor("slug")}
          hint="Lowercase letters, numbers and single hyphens. Frozen once the programme is listed publicly."
        >
          {(field) => (
            <TextInput
              {...field}
              type="text"
              required
              maxLength={120}
              mono
              defaultValue={values.slug ?? ""}
              placeholder="operational-leadership"
            />
          )}
        </FormField>

        <FormField name="summary" label="Summary" error={errorFor("summary")}>
          {(field) => (
            <TextInput {...field} type="text" maxLength={2000} defaultValue={values.summary ?? ""} />
          )}
        </FormField>

        <FormField
          name="outcomes"
          label="Outcomes"
          error={errorFor("outcomes")}
          hint="What learners will be able to do after completing this programme."
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
            <TextInput {...field} type="text" maxLength={2000} defaultValue={values.audience ?? ""} />
          )}
        </FormField>

        <label className="flex items-start gap-2 rounded-md border border-input-border bg-surface px-4 py-2 text-sm">
          <input
            type="checkbox"
            name="sequential"
            defaultChecked={values.sequential ?? true}
            className="mt-1 size-4 rounded-[4px] border-[1.5px] border-input-border accent-accent"
          />
          <span>
            <span className="block font-semibold text-foreground">Sequential</span>
            <span className="block text-sm text-muted-foreground">
              Learners must complete the member courses in order.
            </span>
          </span>
        </label>
      </ResourceForm>
    </>
  );
}
