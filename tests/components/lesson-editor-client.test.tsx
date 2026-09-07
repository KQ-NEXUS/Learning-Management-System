/**
 * LessonEditorClient — the withdraw modal must never accuse the user of a
 * failure they have not just caused (WR-02, 04.1-REVIEW.md; NFR-09 error
 * identification).
 *
 * `ConfirmModal` unmounts its body when closed, so a `withdrawError` left in the
 * parent's state re-renders the previous "Action not applied" alert the instant
 * the dialog is reopened. The withdraw trigger's `onClick` and the modal's
 * `onCancel` must both clear it first, mirroring `CourseDetailActions.openModal`.
 *
 * `LessonFormFields` is stubbed so the heavy Tiptap editor never mounts; the
 * real `ConfirmModal` (the surface under test) stays mounted.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const routerPush = vi.fn();
const routerRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, refresh: routerRefresh }),
}));

vi.mock("@/components/catalogue", () => ({
  LessonFormFields: () => null,
}));

vi.mock("@/app/staff/courses/[id]/lessons/[lessonId]/actions", () => ({
  saveLessonAction: vi.fn(),
  withdrawLessonAction: vi.fn(),
}));

import { withdrawLessonAction } from "@/app/staff/courses/[id]/lessons/[lessonId]/actions";
import { LessonEditorClient } from "@/app/staff/courses/[id]/lessons/[lessonId]/LessonEditorClient";

const REASON = "Superseded by the 2026 rewrite";

function renderEditor() {
  return render(
    <LessonEditorClient
      mode="edit"
      lessonId="lesson-1"
      courseId="course-1"
      initialType="TEXT"
    />,
  );
}

/** The trigger and the modal's confirm button share the name "Withdraw lesson". */
function withdrawTrigger() {
  return screen
    .getAllByRole("button", { name: "Withdraw lesson" })
    .find((b) => !b.closest('[role="dialog"]')) as HTMLButtonElement;
}

async function failWithdrawThenCancelAndReopen() {
  fireEvent.click(withdrawTrigger());
  const dialog = screen.getByRole("dialog");
  fireEvent.change(
    within(dialog).getByRole("textbox", { name: /Reason for withdrawal/i }),
    { target: { value: REASON } },
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Withdraw lesson" }));
  await screen.findByRole("alert");
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(withdrawTrigger());
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LessonEditorClient withdraw modal — no stale error on reopen", () => {
  it("shows the failure alert for the attempt the user just made", async () => {
    vi.mocked(withdrawLessonAction).mockResolvedValue({
      ok: false,
      message: "This lesson could not be withdrawn.",
    });
    renderEditor();

    fireEvent.click(withdrawTrigger());
    const dialog = screen.getByRole("dialog");
    fireEvent.change(
      within(dialog).getByRole("textbox", { name: /Reason for withdrawal/i }),
      { target: { value: REASON } },
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Withdraw lesson" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Action not applied/i);
    expect(alert.textContent).toMatch(/could not be withdrawn/i);
  });

  it("discards a resolved { ok: false } failure when the modal is cancelled and reopened", async () => {
    vi.mocked(withdrawLessonAction).mockResolvedValue({
      ok: false,
      message: "This lesson could not be withdrawn.",
    });
    renderEditor();

    await failWithdrawThenCancelAndReopen();

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("discards a rejected withdrawal the same way", async () => {
    vi.mocked(withdrawLessonAction).mockRejectedValue(new Error("network down"));
    renderEditor();

    await failWithdrawThenCancelAndReopen();

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
