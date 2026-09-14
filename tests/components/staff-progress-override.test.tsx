/**
 * `ProgressOverridePanel` (D-14, DD-31, plan 09-13 Task 3) — the true
 * DOM-rendering half of this plan's coverage. `tests/staff-progress-override.test.ts`
 * (the "node" Vitest project, no jsdom/hooks) proves the Server Component
 * page's data flow and its `notFound()` gates by inspecting the returned
 * element tree directly; it cannot render a `"use client"` island that calls
 * `useState`/`useRouter` — those hooks require React's actual render
 * dispatcher, which only exists once something really renders. This file
 * covers exactly that remaining slice, in the "components" project
 * (`vitest.config.mts`), the same jsdom home `tests/components/cohort-roster.test.tsx`
 * and `tests/components/attendance-mark.test.tsx` already use for every
 * other client island with a mandatory-reason `ConfirmModal`.
 *
 * `progress-actions.ts` is a real Server Actions file ("use server"); it is
 * mocked here rather than exercised for real, the same reasoning
 * `attendance-mark.test.tsx` documents for `attendance-actions.ts`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("@/app/staff/cohorts/[id]/progress-actions", () => ({
  overrideLessonProgressAction: vi.fn(),
}));

import { overrideLessonProgressAction } from "@/app/staff/cohorts/[id]/progress-actions";
import {
  ProgressOverridePanel,
  type ProgressLessonRow,
} from "@/app/staff/cohorts/[id]/learners/[enrolmentId]/ProgressOverridePanel";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const lesson = (over: Partial<ProgressLessonRow> = {}): ProgressLessonRow => ({
  id: "lesson-1",
  title: "Intro",
  moduleTitle: "Module One",
  required: true,
  completed: false,
  completedSource: null,
  completedAt: null,
  ...over,
});

describe("ProgressOverridePanel", () => {
  it("renders a distinguishable source label for an AUTO_VIDEO completion, different from a manual one", () => {
    render(
      <ProgressOverridePanel
        cohortId="cohort-1"
        enrolmentId="enr-1"
        canOverride={true}
        lessons={[
          lesson({
            id: "l1",
            title: "Manual lesson",
            completed: true,
            completedSource: "MANUAL",
            completedAt: "2026-03-01T00:00:00.000Z",
          }),
          lesson({
            id: "l2",
            title: "Video lesson",
            completed: true,
            completedSource: "AUTO_VIDEO",
            completedAt: "2026-03-02T00:00:00.000Z",
          }),
        ]}
      />,
    );

    expect(screen.getByText(/Marked by learner/)).toBeTruthy();
    expect(screen.getByText(/Auto-completed \(video\)/)).toBeTruthy();
  });

  it("renders a staff-override source label distinctly too", () => {
    render(
      <ProgressOverridePanel
        cohortId="cohort-1"
        enrolmentId="enr-1"
        canOverride={true}
        lessons={[
          lesson({ completed: true, completedSource: "STAFF_OVERRIDE", completedAt: "2026-03-01T00:00:00.000Z" }),
        ]}
      />,
    );
    expect(screen.getByText(/Staff override/)).toBeTruthy();
  });

  it("renders 'Not completed' for a lesson with no LessonProgress row", () => {
    render(
      <ProgressOverridePanel
        cohortId="cohort-1"
        enrolmentId="enr-1"
        canOverride={true}
        lessons={[lesson({ completed: false })]}
      />,
    );
    expect(screen.getByText("Not completed")).toBeTruthy();
  });

  it("flips the override affordance label with the lesson's completion state", () => {
    render(
      <ProgressOverridePanel
        cohortId="cohort-1"
        enrolmentId="enr-1"
        canOverride={true}
        lessons={[
          lesson({ id: "incomplete", completed: false }),
          lesson({ id: "complete", completed: true, completedSource: "MANUAL", completedAt: "2026-01-01T00:00:00.000Z" }),
        ]}
      />,
    );

    expect(screen.getAllByRole("button", { name: "Mark complete" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Mark incomplete" })).toHaveLength(1);
  });

  it("hides the override affordance entirely when the caller lacks enrolments.manage", () => {
    render(
      <ProgressOverridePanel
        cohortId="cohort-1"
        enrolmentId="enr-1"
        canOverride={false}
        lessons={[lesson()]}
      />,
    );
    expect(screen.queryByRole("button", { name: /Mark/ })).toBeNull();
  });

  it("opens ConfirmModal with a mandatory, required reason field, not a bespoke dialog", () => {
    render(
      <ProgressOverridePanel
        cohortId="cohort-1"
        enrolmentId="enr-1"
        canOverride={true}
        lessons={[lesson()]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Mark complete" }));

    const dialog = screen.getByRole("dialog");
    const reasonInput = within(dialog).getByLabelText(/reason/i);
    expect(reasonInput).toBeTruthy();
    expect(within(dialog).getByText(/required/i)).toBeTruthy();
    // The confirm button stays disabled below the reason minimum — a courtesy,
    // not the enforcement (the service's OverrideReasonRequiredError is).
    const confirmButton = within(dialog).getByRole("button", {
      name: /Mark complete/,
    }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);
  });

  it("submits complete=true/false and the trimmed reason via FormData, never a typed object", async () => {
    (overrideLessonProgressAction as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

    render(
      <ProgressOverridePanel
        cohortId="cohort-1"
        enrolmentId="enr-1"
        canOverride={true}
        lessons={[lesson({ id: "lesson-9", completed: false })]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Mark complete" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/reason/i), {
      target: { value: "Learner emailed a screenshot of completion" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark complete" }));

    await screen.findByRole("button", { name: "Mark complete" }); // modal closes, row re-renders

    expect(overrideLessonProgressAction).toHaveBeenCalledTimes(1);
    const formData = (overrideLessonProgressAction as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as FormData;
    expect(formData).toBeInstanceOf(FormData);
    expect(formData.get("cohortId")).toBe("cohort-1");
    expect(formData.get("enrolmentId")).toBe("enr-1");
    expect(formData.get("lessonId")).toBe("lesson-9");
    expect(formData.get("complete")).toBe("true");
    expect(formData.get("reason")).toBe("Learner emailed a screenshot of completion");
    expect(refresh).toHaveBeenCalled();
  });

  it("surfaces a failed override inside the modal's error slot as 'Action not applied', not a silent no-op", async () => {
    (overrideLessonProgressAction as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      message: "A reason is required to override a learner's lesson progress.",
    });

    render(
      <ProgressOverridePanel
        cohortId="cohort-1"
        enrolmentId="enr-1"
        canOverride={true}
        lessons={[lesson()]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Mark complete" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/reason/i), {
      target: { value: "Attempting an override" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark complete" }));

    expect(
      await within(dialog).findByText("A reason is required to override a learner's lesson progress."),
    ).toBeTruthy();
    expect(within(dialog).getByText("Action not applied")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });
});
