import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { CourseForm } from "@/app/staff/courses/CourseForm";
import { createCourseAction, updateCourseAction } from "@/app/staff/courses/actions";

vi.mock("@/app/staff/courses/actions", () => ({
  createCourseAction: vi.fn(),
  updateCourseAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const createAction = vi.mocked(createCourseAction);
const updateAction = vi.mocked(updateCourseAction);

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function submit(container: HTMLElement) {
  fireEvent.submit(container.querySelector("form") as HTMLFormElement);
}

describe("CourseForm", () => {
  it("submits the top-level course create fields to the server action", async () => {
    createAction.mockResolvedValue({ ok: true, id: "course-1" });
    const { container } = render(<CourseForm mode="create" />);

    fireEvent.change(screen.getByLabelText(/^Title/), {
      target: { value: "Workplace Safety Essentials" },
    });
    fireEvent.change(screen.getByLabelText(/^Slug/), {
      target: { value: "workplace-safety-essentials" },
    });
    fireEvent.change(screen.getByLabelText("Summary"), {
      target: { value: "Core hazard identification and response." },
    });
    fireEvent.change(screen.getByLabelText("Duration hours"), {
      target: { value: "18" },
    });
    fireEvent.click(screen.getByLabelText("Certificate enabled"));

    submit(container);

    await waitFor(() => expect(createAction).toHaveBeenCalledTimes(1));
    const form = createAction.mock.calls[0][1] as FormData;
    expect(form.get("title")).toBe("Workplace Safety Essentials");
    expect(form.get("slug")).toBe("workplace-safety-essentials");
    expect(form.get("summary")).toBe("Core hazard identification and response.");
    expect(form.get("durationHours")).toBe("18");
    expect(form.get("certificateEnabled")).toBe("on");
  });
});

describe("CourseForm — edit mode", () => {
  const templates = [
    { id: "tpl-1", name: "Classic", isDefault: true },
    { id: "tpl-2", name: "Modern", isDefault: false },
  ];
  const values = {
    title: "Workplace Safety",
    slug: "workplace-safety",
    summary: "Core hazards.",
    outcomes: "Spot hazards.\nRespond.",
    audience: "Site staff",
    prerequisites: "None",
    durationHours: 12,
    certificateEnabled: true,
    certificateIssuanceMode: "AUTOMATIC" as const,
    certificateTemplateId: "tpl-2" as string | null,
  };

  function renderEdit(overrides: Partial<typeof values> = {}, tpls = templates) {
    return render(
      <CourseForm
        mode="edit"
        courseId="course-9"
        values={{ ...values, ...overrides }}
        templates={tpls}
      />,
    );
  }

  it("renders the stored values in the fields", () => {
    renderEdit();
    expect((screen.getByLabelText(/^Title/) as HTMLInputElement).value).toBe("Workplace Safety");
    expect((screen.getByLabelText(/^Slug/) as HTMLInputElement).value).toBe("workplace-safety");
    expect((screen.getByLabelText("Summary") as HTMLInputElement).value).toBe("Core hazards.");
    expect((screen.getByLabelText("Outcomes") as HTMLTextAreaElement).value).toBe(
      "Spot hazards.\nRespond.",
    );
    expect((screen.getByLabelText("Audience") as HTMLInputElement).value).toBe("Site staff");
    expect((screen.getByLabelText("Prerequisites") as HTMLTextAreaElement).value).toBe("None");
    expect((screen.getByLabelText("Duration hours") as HTMLInputElement).value).toBe("12");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
  });

  it("starts with certificates enabled, stored mode selected and stored template preselected", () => {
    renderEdit();
    expect((screen.getByLabelText("Certificate enabled") as HTMLInputElement).checked).toBe(true);
    const automatic = screen.getByRole("radio", { name: /Automatic/ }) as HTMLInputElement;
    const manual = screen.getByRole("radio", { name: /Manual/ }) as HTMLInputElement;
    expect(automatic.checked).toBe(true);
    expect(automatic.disabled).toBe(false);
    expect(manual.disabled).toBe(false);
    const select = screen.getByLabelText("Certificate template") as HTMLSelectElement;
    expect(select.disabled).toBe(false);
    expect(select.value).toBe("tpl-2");
  });

  it("starts unchecked with disabled controls when the course has certificates off", () => {
    renderEdit({ certificateEnabled: false });
    expect((screen.getByLabelText("Certificate enabled") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("Certificate template") as HTMLSelectElement).disabled).toBe(true);
  });

  it("unchecking disables both controls and omits their keys from the submission", async () => {
    updateAction.mockResolvedValue({ ok: true, id: "course-9" });
    const { container } = renderEdit();
    fireEvent.click(screen.getByLabelText("Certificate enabled"));
    expect((screen.getByLabelText("Certificate template") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole("radio", { name: /Manual/ }) as HTMLInputElement).disabled).toBe(true);

    submit(container);
    await waitFor(() => expect(updateAction).toHaveBeenCalledTimes(1));
    const form = updateAction.mock.calls[0][1] as FormData;
    expect(form.has("certificateEnabled")).toBe(false);
    expect(form.has("certificateIssuanceMode")).toBe(false);
    expect(form.has("certificateTemplateId")).toBe(false);
  });

  it("submits the hidden courseId and edited certificate values to updateCourseAction only", async () => {
    updateAction.mockResolvedValue({ ok: true, id: "course-9" });
    const { container } = renderEdit();
    fireEvent.click(screen.getByRole("radio", { name: /Manual/ }));
    fireEvent.change(screen.getByLabelText("Certificate template"), { target: { value: "tpl-1" } });

    submit(container);
    await waitFor(() => expect(updateAction).toHaveBeenCalledTimes(1));
    const form = updateAction.mock.calls[0][1] as FormData;
    expect(form.get("courseId")).toBe("course-9");
    expect(form.get("certificateEnabled")).toBe("on");
    expect(form.get("certificateIssuanceMode")).toBe("MANUAL");
    expect(form.get("certificateTemplateId")).toBe("tpl-1");
    expect(createAction).not.toHaveBeenCalled();
  });

  it("shows a Saved. status after a successful save", async () => {
    updateAction.mockResolvedValue({ ok: true, id: "course-9" });
    const { container } = renderEdit();
    submit(container);
    expect((await screen.findByRole("status")).textContent).toContain("Saved.");
  });

  it("keeps an archived stored template visible as a disabled, selected entry", () => {
    renderEdit({ certificateTemplateId: "tpl-old" }, [templates[0]]);
    const select = screen.getByLabelText("Certificate template") as HTMLSelectElement;
    expect(select.value).toBe("tpl-old");
    const option = select.querySelector('option[value="tpl-old"]') as HTMLOptionElement;
    expect(option.disabled).toBe(true);
    expect(option.textContent).toContain("(archived)");
  });

  it("keeps create mode unchanged: starts unchecked and says Create course", () => {
    renderEdit();
    cleanup();
    render(<CourseForm mode="create" />);
    expect((screen.getByLabelText("Certificate enabled") as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole("button", { name: "Create course" })).toBeTruthy();
  });
});
