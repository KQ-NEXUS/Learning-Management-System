/**
 * Stepped forms (owner request, 2026-10-04): a long form is shown one step at a
 * time with a numbered step bar on top, Back and Next between steps. Creating
 * ends on a Review step that lists every answer and carries the submit button;
 * editing opens any step directly. Problems are listed in one summary, never in
 * the browser's own pop-up.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useActionState } from "react";
import { FormField, FormStep, ResourceForm, type FieldError } from "@/components/primitives";

afterEach(cleanup);

type Save = (formData: FormData) => void | Promise<void>;

function Steps({ mode, onSubmit, errors = [] }: { mode: "linear" | "free"; onSubmit: Save; errors?: FieldError[] }) {
  return (
    <ResourceForm title="New cohort" stepped={mode} submitLabel="Create cohort" errors={errors} onSubmit={onSubmit}>
      <input type="hidden" name="cohortId" value="cohort-1" />
      <FormStep title="Details" description="How the cohort is named.">
        <FormField name="title" label="Title" required>
          {(field) => <input {...field} required defaultValue="" />}
        </FormField>
      </FormStep>
      <FormStep title="Schedule">
        <FormField name="starts" label="Starts" required>
          {(field) => <input {...field} required defaultValue="" />}
        </FormField>
      </FormStep>
      <FormStep title="Price">
        <FormField name="price" label="Price">
          {(field) => <input {...field} defaultValue="" />}
        </FormField>
      </FormStep>
    </ResourceForm>
  );
}

const progress = () => screen.getByRole("navigation", { name: "Progress" });
const stepButton = (name: RegExp) => within(progress()).getByRole("button", { name });
const currentStepName = () => within(progress()).getByRole("button", { current: "step" }).textContent;
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(new RegExp(`^${label}`)), { target: { value } });
const next = () => fireEvent.click(screen.getByRole("button", { name: "Next" }));

describe("stepped form — creating (linear)", () => {
  it("opens on the first step with the step bar (ending in Review), Next, and no submit button yet", () => {
    render(<Steps mode="linear" onSubmit={vi.fn()} />);

    expect(within(progress()).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "1Details (current step)",
      "2Schedule",
      "3Price",
      "4Review",
    ]);
    expect(screen.getByText("Step 1 of 4")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Details" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Schedule" })).toBeNull();
    expect(screen.getByRole("button", { name: "Next" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create cohort" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("Next will not leave a step whose required field is empty", () => {
    render(<Steps mode="linear" onSubmit={vi.fn()} />);

    next();

    expect(currentStepName()).toContain("Details");
    expect(screen.getByRole("alert").textContent).toContain("Title is required");
    // A later step cannot be jumped to past the unfinished one either.
    fireEvent.click(stepButton(/Schedule/));
    expect(currentStepName()).toContain("Details");
    expect((stepButton(/Price/) as HTMLButtonElement).disabled).toBe(true);
  });

  it("moves forward step by step, ticks finished steps, and shows the submit button only on Review", () => {
    render(<Steps mode="linear" onSubmit={vi.fn()} />);

    type("Title", "Fire Marshal");
    next();
    expect(currentStepName()).toContain("Schedule");
    expect(screen.getByText("Step 2 of 4")).toBeTruthy();
    expect(stepButton(/Details/).textContent).toContain("(done)");
    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create cohort" })).toBeNull();

    type("Starts", "2026-11-01");
    next();
    expect(currentStepName()).toContain("Price");
    expect(screen.queryByRole("button", { name: "Create cohort" })).toBeNull();

    next();
    expect(currentStepName()).toContain("Review");
    expect(screen.getByRole("button", { name: "Create cohort" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  });

  it("the Review step lists every answer, says what was left blank, and Change goes back to that step", () => {
    render(<Steps mode="linear" onSubmit={vi.fn()} />);
    type("Title", "Fire Marshal");
    next();
    type("Starts", "2026-11-01");
    next();
    next();

    expect(screen.getByRole("heading", { name: "Review and create" })).toBeTruthy();
    const details = screen.getByRole("heading", { name: "Details" }).closest("div")!.parentElement!;
    expect(details.textContent).toContain("Fire Marshal");
    const price = screen.getByRole("heading", { name: "Price" }).closest("div")!.parentElement!;
    expect(price.textContent).toContain("Not set");

    fireEvent.click(screen.getByRole("button", { name: "Change Schedule" }));
    expect(currentStepName()).toContain("Schedule");
    expect((screen.getByLabelText(/^Starts/) as HTMLInputElement).value).toBe("2026-11-01");
  });

  it("shows dates on the Review step as people read them", () => {
    render(
      <ResourceForm title="New cohort" stepped="linear" submitLabel="Create cohort" onSubmit={vi.fn()}>
        <FormStep title="Schedule">
          <FormField name="startsAt" label="Starts">
            {(field) => <input {...field} type="datetime-local" defaultValue="2027-03-01T09:00" />}
          </FormField>
          <FormField name="day" label="Day">
            {(field) => <input {...field} type="date" defaultValue="2027-12-25" />}
          </FormField>
        </FormStep>
      </ResourceForm>,
    );
    next();

    expect(screen.getByText("1 Mar 2027, 09:00")).toBeTruthy();
    expect(screen.getByText("25 Dec 2027")).toBeTruthy();
  });

  it("lists every problem in one summary with links, flags the step, and never uses the browser pop-up", async () => {
    const reportValidity = vi.spyOn(HTMLInputElement.prototype, "reportValidity");
    render(<Steps mode="linear" onSubmit={vi.fn()} />);

    next();

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("1 thing needs fixing");
    expect(reportValidity).not.toHaveBeenCalled();
    expect(stepButton(/Details/).textContent).toContain("(has a problem)");
    expect(screen.getByLabelText(/^Title/).getAttribute("aria-invalid")).toBe("true");

    fireEvent.click(within(alert).getByRole("link", { name: "Title is required" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/^Title/)));
    reportValidity.mockRestore();
  });

  it("clears a field's invalid mark as soon as it is fixed", () => {
    render(<Steps mode="linear" onSubmit={vi.fn()} />);
    next();
    expect(screen.getByLabelText(/^Title/).getAttribute("aria-invalid")).toBe("true");

    type("Title", "Fire Marshal");
    expect(screen.getByLabelText(/^Title/).getAttribute("aria-invalid")).toBeNull();
  });

  it("Back and the progress bar return to an earlier step with what was typed still there", () => {
    render(<Steps mode="linear" onSubmit={vi.fn()} />);
    type("Title", "Fire Marshal");
    next();
    type("Starts", "2026-11-01");

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(currentStepName()).toContain("Details");
    expect((screen.getByLabelText(/^Title/) as HTMLInputElement).value).toBe("Fire Marshal");

    fireEvent.click(stepButton(/Schedule/));
    expect(currentStepName()).toContain("Schedule");
    expect((screen.getByLabelText(/^Starts/) as HTMLInputElement).value).toBe("2026-11-01");
  });

  it("submits every step's fields together, including ones not on screen", async () => {
    const onSubmit = vi.fn();
    render(<Steps mode="linear" onSubmit={onSubmit} />);
    type("Title", "Fire Marshal");
    next();
    type("Starts", "2026-11-01");
    next();
    type("Price", "12500000");
    next();

    fireEvent.click(screen.getByRole("button", { name: "Create cohort" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const data = onSubmit.mock.calls[0]![0] as FormData;
    expect(Object.fromEntries(data.entries())).toEqual({
      cohortId: "cohort-1",
      title: "Fire Marshal",
      starts: "2026-11-01",
      price: "12500000",
    });
  });

  it("pressing Enter in a field is Next, never an early submit", () => {
    const onSubmit = vi.fn();
    const { container } = render(<Steps mode="linear" onSubmit={onSubmit} />);
    type("Title", "Fire Marshal");

    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    expect(currentStepName()).toContain("Schedule");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("stepped form — editing (free)", () => {
  it("lets any step be opened directly and offers the submit button on every step", () => {
    render(<Steps mode="free" onSubmit={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Create cohort" })).toBeTruthy();
    fireEvent.click(stepButton(/Price/));
    expect(currentStepName()).toContain("Price");
    expect(screen.getByRole("button", { name: "Create cohort" })).toBeTruthy();
  });

  it("will not save while a required field on another step is empty, and opens that step", () => {
    const onSubmit = vi.fn();
    render(<Steps mode="free" onSubmit={onSubmit} />);
    fireEvent.click(stepButton(/Price/));

    fireEvent.click(screen.getByRole("button", { name: "Create cohort" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(currentStepName()).toContain("Details");
    expect(screen.getByRole("alert").textContent).toContain("Title is required");
  });

  it("says whether there are unsaved changes", () => {
    render(<Steps mode="free" onSubmit={vi.fn()} />);
    expect(screen.getByText("All changes saved")).toBeTruthy();

    type("Title", "Fire Marshal");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  });
});

describe("stepped form — a save the server refuses", () => {
  it("opens the step holding the field the error is about", async () => {
    const save = vi.fn(async (): Promise<FieldError[]> => [{ name: "starts", message: "Start must be in the future." }]);

    function Harness() {
      const [errors, formAction] = useActionState(save, [] as FieldError[]);
      return <Steps mode="linear" onSubmit={formAction} errors={errors} />;
    }
    render(<Harness />);
    type("Title", "Fire Marshal");
    next();
    type("Starts", "2020-01-01");
    next();
    expect(currentStepName()).toContain("Price");
    next();
    expect(currentStepName()).toContain("Review");

    fireEvent.click(screen.getByRole("button", { name: "Create cohort" }));

    await waitFor(() => expect(currentStepName()).toContain("Schedule"));
    expect(screen.getByRole("link", { name: "Start must be in the future." })).toBeTruthy();
    expect((screen.getByLabelText(/^Starts/) as HTMLInputElement).value).toBe("2020-01-01");
  });
});
