import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState, type ComponentType, type ReactNode } from "react";
import type { FieldError, ResourceFormProps } from "@/components/primitives";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function loadResourceForm(): Promise<ComponentType<ResourceFormProps>> {
  const primitives = await import("@/components/primitives");
  const component = (primitives as Record<string, unknown>).ResourceForm;

  expect(
    component,
    "the primitives module must export the planned ResourceForm",
  ).toBeTypeOf("function");

  return component as ComponentType<ResourceFormProps>;
}

type FieldControlProps = {
  id: string;
  name: string;
  "aria-invalid": boolean | undefined;
  "aria-describedby": string | undefined;
};

type FormFieldTestProps = {
  name: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (props: FieldControlProps) => ReactNode;
};

async function loadFormField(): Promise<ComponentType<FormFieldTestProps>> {
  const primitives = await import("@/components/primitives");
  const component = (primitives as Record<string, unknown>).FormField;
  expect(
    component,
    "the primitives module must export the planned FormField",
  ).toBeTypeOf("function");
  return component as ComponentType<FormFieldTestProps>;
}

describe("ResourceForm", () => {
  it("ready: renders children with aria wiring intact — each control has an id and a resolvable aria-describedby", async () => {
    const ResourceForm = await loadResourceForm();
    const FormField = await loadFormField();

    const { container } = render(
      <ResourceForm title="Edit course" onSubmit={() => {}}>
        <FormField name="title" label="Title" hint="Shown to learners">
          {(fieldProps) => <input {...fieldProps} />}
        </FormField>
      </ResourceForm>,
    );

    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.id).toBeTruthy();
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    for (const id of describedBy!.split(" ")) {
      expect(document.getElementById(id)).toBeTruthy();
    }
  });

  it("loading: renders the loading branch", async () => {
    const ResourceForm = await loadResourceForm();
    const { container } = render(
      <ResourceForm
        title="Edit course"
        state={{ status: "loading" }}
        onSubmit={() => {}}
      >
        <p>unused</p>
      </ResourceForm>,
    );

    expect(container.querySelector('[aria-busy]')).toBeTruthy();
    expect(screen.getByText(/Loading form/i)).toBeTruthy();
  });

  it("pending: renders the submit control in its in-flight state and disabled", async () => {
    const ResourceForm = await loadResourceForm();
    render(
      <ResourceForm title="Edit course" pending onSubmit={() => {}}>
        <p>unused</p>
      </ResourceForm>,
    );

    const submit = screen.getByRole("button", { name: /Saving/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it("denied: renders the permission heading and body copy", async () => {
    const ResourceForm = await loadResourceForm();
    render(
      <ResourceForm
        title="Edit course"
        state={{ status: "denied", permission: "courses.manage" }}
        onSubmit={() => {}}
      >
        <p>unused</p>
      </ResourceForm>,
    );

    expect(
      screen.getByText(/Editing needs additional permission/i),
    ).toBeTruthy();
    expect(screen.getByText(/Ask a workspace administrator/i)).toBeTruthy();
  });

  it("error: renders load-failure copy plus a Retry control wired to onRetry", async () => {
    const ResourceForm = await loadResourceForm();
    const onRetry = vi.fn();
    render(
      <ResourceForm
        title="Edit course"
        state={{ status: "error", message: "The request failed." }}
        onRetry={onRetry}
        onSubmit={() => {}}
      >
        <p>unused</p>
      </ResourceForm>,
    );

    expect(screen.getByText(/Could not load this record/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("a non-empty errors array renders a summary above the fields linking to each offending field, and after a failed submit the summary receives focus", async () => {
    const ResourceForm = await loadResourceForm();
    const FormField = await loadFormField();

    function Harness() {
      const [errors, setErrors] = useState<FieldError[]>([]);

      return (
        <ResourceForm
          title="Edit course"
          errors={errors}
          onSubmit={async () => {
            setErrors([{ name: "title", message: "Title is required" }]);
          }}
        >
          <FormField name="title" label="Title">
            {(fieldProps) => <input {...fieldProps} />}
          </FormField>
        </ResourceForm>
      );
    }

    const { container } = render(<Harness />);

    const form = container.querySelector("form") as HTMLFormElement;
    fireEvent.submit(form);

    const summary = await waitFor(() => screen.getByRole("alert"));
    expect(summary.textContent).toMatch(/Title is required/);
    const link = screen.getByRole("link", { name: "Title is required" });
    expect(link.getAttribute("href")).toBe("#field-title");

    await waitFor(() => {
      expect(document.activeElement === summary || summary.contains(document.activeElement)).toBe(true);
    });
  });

  it("a failed submit leaves previously entered field values in the DOM and renders no success wording", async () => {
    const ResourceForm = await loadResourceForm();
    const FormField = await loadFormField();

    render(
      <ResourceForm
        title="Edit course"
        errors={[{ name: "title", message: "Title is required" }]}
        onSubmit={() => {}}
      >
        <FormField name="title" label="Title">
          {(fieldProps) => <input {...fieldProps} defaultValue="Advanced Diagnostics" />}
        </FormField>
      </ResourceForm>,
    );

    const input = screen.getByDisplayValue("Advanced Diagnostics");
    expect(input).toBeTruthy();
    // "no success wording" — not "saved" broadly, since the error summary's
    // own copy legitimately contains "...before this can be saved".
    expect(screen.queryByText(/success/i)).toBeNull();
    expect(screen.queryByText(/saved successfully/i)).toBeNull();
  });
});
