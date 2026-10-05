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

  it("denied: renders the permission heading and body copy, with no onSubmit (a Server Component cannot pass one, A-04)", async () => {
    const ResourceForm = await loadResourceForm();
    render(
      <ResourceForm title="Edit course" state={{ status: "denied", permission: "courses.manage" }}>
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

  it("renders form-level errors (no matching field) as plain alert text, never as dead links", async () => {
    const ResourceForm = await loadResourceForm();
    const FormField = await loadFormField();

    render(
      <ResourceForm
        title="Edit lesson"
        errors={[
          { name: "title", message: "Title is required" },
          { name: "form", message: "Choose exactly one of course or programme" },
        ]}
        onSubmit={() => {}}
      >
        <FormField name="title" label="Title">
          {(fieldProps) => <input {...fieldProps} />}
        </FormField>
      </ResourceForm>,
    );

    const summary = screen.getByRole("alert");
    // The cross-field failure is visible as text...
    expect(summary.textContent).toMatch(
      /Choose exactly one of course or programme/,
    );
    // ...but is never offered as a link to a field that does not exist.
    expect(
      screen.queryByRole("link", {
        name: "Choose exactly one of course or programme",
      }),
    ).toBeNull();
    // The genuine field error still links to its control.
    const fieldLink = screen.getByRole("link", { name: "Title is required" });
    expect(fieldLink.getAttribute("href")).toBe("#field-title");
  });

  it("only links summary entries that resolve to a real control in this form", async () => {
    const ResourceForm = await loadResourceForm();
    const FormField = await loadFormField();

    render(
      <ResourceForm
        title="Edit lesson"
        errors={[
          { name: "title", message: "Title is required" },
          { name: "slug", message: "That slug is already taken" },
        ]}
        onSubmit={() => {}}
      >
        <FormField name="title" label="Title">
          {(fieldProps) => <input {...fieldProps} />}
        </FormField>
      </ResourceForm>,
    );

    expect(
      screen.getByRole("link", { name: "Title is required" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: "That slug is already taken" }),
    ).toBeNull();
    expect(screen.getByRole("alert").textContent).toMatch(
      /That slug is already taken/,
    );
  });

  it("every rendered summary link points at an element that exists in the document", async () => {
    const ResourceForm = await loadResourceForm();
    const FormField = await loadFormField();

    render(
      <ResourceForm
        title="Edit lesson"
        errors={[
          { name: "title", message: "Title is required" },
          { name: "body", message: "Add some lesson content" },
          { name: "form", message: "This record cannot be saved yet" },
        ]}
        onSubmit={() => {}}
      >
        <FormField name="title" label="Title">
          {(fieldProps) => <input {...fieldProps} />}
        </FormField>
        <FormField name="body" label="Body">
          {(fieldProps) => <textarea {...fieldProps} />}
        </FormField>
      </ResourceForm>,
    );

    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const target = (link.getAttribute("href") ?? "").replace(/^#/, "");
      expect(document.getElementById(target)).not.toBeNull();
    }
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

  it("keeps what was typed when the save action reports a validation failure (R3-05)", async () => {
    const ResourceForm = await loadResourceForm();
    const { FormField } = await import("@/components/primitives");
    const { useActionState } = await import("react");
    const save = vi.fn(async (_prev: FieldError[], formData: FormData): Promise<FieldError[]> => {
      void formData;
      return [{ name: "price", message: "Enter a price greater than zero." }];
    });

    function Harness() {
      const [errors, formAction, pending] = useActionState(save, [] as FieldError[]);
      return (
        <ResourceForm title="Edit cohort" errors={errors} pending={pending} onSubmit={formAction}>
          <FormField name="price" label="Price">
            {(fieldProps) => <input {...fieldProps} defaultValue="" />}
          </FormField>
          <FormField name="title" label="Title">
            {(fieldProps) => <input {...fieldProps} defaultValue="Stored title" />}
          </FormField>
        </ResourceForm>
      );
    }
    render(<Harness />);

    fireEvent.change(screen.getByLabelText("Price"), { target: { value: "12500000" } });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Typed title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Enter a price greater than zero.", { selector: "a, span" });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![1].get("price")).toBe("12500000");
    expect((screen.getByLabelText("Price") as HTMLInputElement).value).toBe("12500000");
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Typed title");
  });
});
