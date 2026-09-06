"use client";

import { useActionState } from "react";
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
  const errorFor = (name: string) =>
    (!state.ok ? state.errors : []).find((error) => error.name === name)?.message;

  return (
    <>
      {state.ok === false && state.message && (
        <p role="alert" className="mb-3 border border-danger/30 bg-danger-surface px-3 py-2 text-sm text-danger">
          {state.message}
        </p>
      )}
      {props.mode === "edit" && state.ok && (
        <p role="status" className="mb-3 border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
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

        <FormField name="audience" label="Audience" error={errorFor("audience")}>
          {(field) => (
            <TextInput {...field} type="text" maxLength={2000} defaultValue={values.audience ?? ""} />
          )}
        </FormField>

        <label className="flex items-start gap-2 rounded-md border border-input-border bg-surface px-3 py-2.5 text-sm">
          <input
            type="checkbox"
            name="sequential"
            defaultChecked={values.sequential ?? true}
            className="mt-0.5 size-4 rounded-[4px] border-[1.5px] border-input-border accent-accent"
          />
          <span>
            <span className="block font-semibold text-foreground">Sequential</span>
            <span className="block text-xs text-muted-foreground">
              Learners must complete the member courses in order.
            </span>
          </span>
        </label>
      </ResourceForm>
    </>
  );
}
