import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { CourseForm } from "@/app/staff/courses/CourseForm";
import { createCourseAction } from "@/app/staff/courses/actions";

vi.mock("@/app/staff/courses/actions", () => ({
  createCourseAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const createAction = vi.mocked(createCourseAction);

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
