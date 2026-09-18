/**
 * D-02/D-10 issuance-mode + template-picker controls (plan 11-08).
 *
 * Lives under tests/components/ — vitest.config.mts's "components" jsdom
 * project only picks up tests/components/**\/*.test.tsx (the "node" project
 * explicitly excludes tests/components/**); a .tsx file placed directly
 * under tests/ matches neither project's include glob and would silently
 * never run (Rule 3 auto-fix — see 11-08-SUMMARY.md).
 *
 * Task 1 (Course side) coverage:
 *
 *   1. `CertificateSettingsFields` — the shared control the Course/Programme
 *      forms consume — renders both controls with an accessible name,
 *      disables both when `certificateEnabled` is false, offers "Use the
 *      default template" mapped to a null id, and suffixes the default
 *      template's option label.
 *   2. `CourseForm` wires the checkbox live (Course's `certificateEnabled`
 *      defaults false and is editable in the same create form) and submits
 *      both new fields through `FormData`.
 *   3. `assertTemplateSelectable` — the exact function the Course action
 *      calls before persisting — rejects an id absent from the live
 *      selectable-template list (T-11-33), never trusting a client-supplied
 *      option list, and is a no-op for "leave unchanged"/"use the default".
 *
 * Task 2 extends this file with `ProgrammeForm` coverage of the same shared
 * component.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  CertificateSettingsFields,
  type SelectableTemplate,
} from "@/components/catalogue/CertificateSettingsFields";
import { CourseForm } from "@/app/staff/courses/CourseForm";
import { createCourseAction } from "@/app/staff/courses/actions";
import {
  createTemplateSelectionGuard,
  TemplateNotSelectableError,
} from "@/server/services/certificate-template-service";

vi.mock("@/app/staff/courses/actions", () => ({
  createCourseAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const TEMPLATES: SelectableTemplate[] = [
  { id: "tpl-default", name: "Standard Certificate", isDefault: true },
  { id: "tpl-alt", name: "Leadership Track", isDefault: false },
];

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function submit(container: HTMLElement) {
  fireEvent.submit(container.querySelector("form") as HTMLFormElement);
}

describe("CertificateSettingsFields", () => {
  it("renders both controls with an accessible name each", () => {
    render(<CertificateSettingsFields certificateEnabled templates={TEMPLATES} />);

    expect(
      screen.getByLabelText("Automatic — issue as soon as the learner completes"),
    ).toBeTruthy();
    expect(
      screen.getByLabelText("Manual — a staff member signs off first"),
    ).toBeTruthy();
    expect(screen.getByLabelText("Certificate template")).toBeTruthy();
  });

  it("disables both controls when certificateEnabled is false, without unmounting them", () => {
    render(<CertificateSettingsFields certificateEnabled={false} templates={TEMPLATES} />);

    expect(
      (screen.getByLabelText(
        "Automatic — issue as soon as the learner completes",
      ) as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText(
        "Manual — a staff member signs off first",
      ) as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("Certificate template") as HTMLSelectElement).disabled,
    ).toBe(true);
  });

  it("leaves both controls enabled when certificateEnabled is true", () => {
    render(<CertificateSettingsFields certificateEnabled templates={TEMPLATES} />);

    expect(
      (screen.getByLabelText(
        "Automatic — issue as soon as the learner completes",
      ) as HTMLInputElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByLabelText("Certificate template") as HTMLSelectElement).disabled,
    ).toBe(false);
  });

  it("maps the first template option to a null id and suffixes the default template", () => {
    render(<CertificateSettingsFields certificateEnabled templates={TEMPLATES} />);

    const select = screen.getByLabelText("Certificate template") as HTMLSelectElement;
    const options = Array.from(select.options);

    expect(options[0].value).toBe("");
    expect(options[0].textContent).toBe("Use the default template");

    const defaultOption = options.find((option) => option.value === "tpl-default");
    expect(defaultOption?.textContent).toBe("Standard Certificate (default)");

    const altOption = options.find((option) => option.value === "tpl-alt");
    expect(altOption?.textContent).toBe("Leadership Track");
  });

  it("defaults the issuance mode to MANUAL when no value is supplied", () => {
    render(<CertificateSettingsFields certificateEnabled templates={TEMPLATES} />);

    expect(
      (screen.getByLabelText(
        "Manual — a staff member signs off first",
      ) as HTMLInputElement).checked,
    ).toBe(true);
  });
});

describe("CourseForm — certificate settings", () => {
  const createAction = vi.mocked(createCourseAction);

  it("keeps the issuance-mode and template controls disabled until Certificate enabled is checked", () => {
    render(<CourseForm mode="create" templates={TEMPLATES} />);

    expect(
      (screen.getByLabelText(
        "Automatic — issue as soon as the learner completes",
      ) as HTMLInputElement).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByLabelText("Certificate enabled"));

    expect(
      (screen.getByLabelText(
        "Automatic — issue as soon as the learner completes",
      ) as HTMLInputElement).disabled,
    ).toBe(false);
  });

  it("submits the chosen issuance mode and template once certificates are enabled", async () => {
    createAction.mockResolvedValue({ ok: true, id: "course-1" });
    const { container } = render(<CourseForm mode="create" templates={TEMPLATES} />);

    fireEvent.change(screen.getByLabelText(/^Title/), {
      target: { value: "Workplace Safety Essentials" },
    });
    fireEvent.change(screen.getByLabelText(/^Slug/), {
      target: { value: "workplace-safety-essentials" },
    });
    fireEvent.click(screen.getByLabelText("Certificate enabled"));
    fireEvent.click(
      screen.getByLabelText("Automatic — issue as soon as the learner completes"),
    );
    fireEvent.change(screen.getByLabelText("Certificate template"), {
      target: { value: "tpl-alt" },
    });

    submit(container);

    await waitFor(() => expect(createAction).toHaveBeenCalledTimes(1));
    const form = createAction.mock.calls[0][1] as FormData;
    expect(form.get("certificateEnabled")).toBe("on");
    expect(form.get("certificateIssuanceMode")).toBe("AUTOMATIC");
    expect(form.get("certificateTemplateId")).toBe("tpl-alt");
  });

  it("omits certificateIssuanceMode and certificateTemplateId from FormData while certificates stay disabled", async () => {
    createAction.mockResolvedValue({ ok: true, id: "course-1" });
    const { container } = render(<CourseForm mode="create" templates={TEMPLATES} />);

    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "Ops" } });
    fireEvent.change(screen.getByLabelText(/^Slug/), { target: { value: "ops" } });
    submit(container);

    await waitFor(() => expect(createAction).toHaveBeenCalledTimes(1));
    const form = createAction.mock.calls[0][1] as FormData;
    expect(form.has("certificateIssuanceMode")).toBe(false);
    expect(form.has("certificateTemplateId")).toBe(false);
  });
});

describe("assertTemplateSelectable (T-11-33) — the guard the Course/Programme actions call", () => {
  it("allows a null or undefined id without ever querying the template list", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const assertTemplateSelectable = createTemplateSelectionGuard(list);

    await expect(assertTemplateSelectable(null)).resolves.toBeUndefined();
    await expect(assertTemplateSelectable(undefined)).resolves.toBeUndefined();
    expect(list).not.toHaveBeenCalled();
  });

  it("allows an id present in the live selectable-template list", async () => {
    const list = vi.fn().mockResolvedValue([{ id: "tpl-1" }, { id: "tpl-2" }]);
    const assertTemplateSelectable = createTemplateSelectionGuard(list);

    await expect(assertTemplateSelectable("tpl-2")).resolves.toBeUndefined();
  });

  it("rejects an id absent from the live selectable-template list (e.g. archived), regardless of what a client offered", async () => {
    const list = vi.fn().mockResolvedValue([{ id: "tpl-1" }]);
    const assertTemplateSelectable = createTemplateSelectionGuard(list);

    await expect(assertTemplateSelectable("tpl-archived")).rejects.toBeInstanceOf(
      TemplateNotSelectableError,
    );
    expect(list).toHaveBeenCalledTimes(1);
  });
});
