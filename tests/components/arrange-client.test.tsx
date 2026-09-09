/**
 * G-RV-01 (BLOCKER) / CR-01 — the course arrange screen's whole-arrangement
 * saves must recover from an unexpected Server Action rejection.
 *
 * `handleSaveModuleOrder` and `handleSaveLessonArrangement` each `await` a
 * Server Action. Before this fix neither had a `try/catch/finally`, so a
 * rejection (network drop, action runtime error) left `savingModules` /
 * `savingLessons` stuck `true`: the board's button stayed on "Saving…",
 * disabled, with no error and no way back short of a full reload — the exact
 * ambiguous-mutation failure class G-04.1-03 exists to close.
 *
 * Each board is proven independently: rejection -> busy flag cleared, idle
 * "Save order" label restored, a generic `role="alert"` message that never
 * echoes the rejection text, then a user-triggered retry that succeeds. The
 * action call count proves nothing retries automatically.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push }),
}));

vi.mock("@/app/staff/courses/[id]/arrange/actions", () => ({
  saveModuleOrderAction: vi.fn(),
  saveLessonArrangementAction: vi.fn(),
  createModuleAction: vi.fn(),
  renameModuleAction: vi.fn(),
  restoreItemAction: vi.fn(),
}));

import {
  saveModuleOrderAction,
  saveLessonArrangementAction,
} from "@/app/staff/courses/[id]/arrange/actions";
import { ArrangeClient } from "@/app/staff/courses/[id]/arrange/ArrangeClient";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const flush = () =>
  act(async () => {
    // The action promise, the handler body, and the component's `finally`.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

const modules = () => [
  {
    id: "m1",
    title: "Module One",
    lessons: [
      { id: "la1", title: "Lesson A1", type: "TEXT", required: true },
      { id: "la2", title: "Lesson A2", type: "TEXT", required: false },
    ],
  },
  {
    id: "m2",
    title: "Module Two",
    lessons: [
      { id: "lb1", title: "Lesson B1", type: "TEXT", required: false },
      { id: "lb2", title: "Lesson B2", type: "TEXT", required: false },
    ],
  },
];

function renderClient() {
  return render(
    <ArrangeClient
      courseId="course-1"
      token="tok-1"
      modules={modules()}
      withdrawnModules={[]}
      withdrawnLessons={[]}
    />,
  );
}

/** Scope queries to one ArrangeBoard by its `<h2>` title. */
function board(name: string) {
  const heading = screen.getByRole("heading", { name, level: 2 });
  return within(heading.parentElement as HTMLElement);
}

describe("ArrangeClient — course module board rejected save recovers", () => {
  it("clears the busy flag, surfaces a generic retryable alert, and a user retry succeeds", async () => {
    vi.mocked(saveModuleOrderAction).mockRejectedValueOnce(new Error("offline-detail"));
    renderClient();

    const mb = board("Module order");
    fireEvent.click(mb.getByRole("button", { name: "Move Module One down" }));

    const save = () => mb.getByRole("button", { name: "Save order" }) as HTMLButtonElement;
    expect(save().disabled).toBe(false);
    fireEvent.click(save());
    await flush();

    // Busy flag cleared, idle label restored.
    expect(mb.queryByRole("button", { name: "Saving…" })).toBeNull();
    expect(save().disabled).toBe(false);

    // Generic retryable alert that never leaks the rejection's own text.
    const alert = mb.getByRole("alert");
    expect(alert.textContent ?? "").toMatch(/try again/i);
    expect(alert.textContent ?? "").not.toMatch(/offline-detail/);

    expect(saveModuleOrderAction).toHaveBeenCalledTimes(1);

    // A user-triggered retry succeeds; nothing auto-retried.
    vi.mocked(saveModuleOrderAction).mockResolvedValueOnce({ ok: true, token: "tok-2" });
    fireEvent.click(save());
    await flush();

    expect(saveModuleOrderAction).toHaveBeenCalledTimes(2);
    expect(mb.queryByRole("alert")).toBeNull();
  });
});

describe("ArrangeClient — course lesson board rejected save recovers", () => {
  it("clears the busy flag, surfaces a generic retryable alert, and a user retry succeeds", async () => {
    vi.mocked(saveLessonArrangementAction).mockRejectedValueOnce(new Error("offline-detail"));
    renderClient();

    const lb = board("Lessons by module");
    fireEvent.click(lb.getByRole("button", { name: "Move Lesson A1 down" }));

    const save = () => lb.getByRole("button", { name: "Save order" }) as HTMLButtonElement;
    fireEvent.click(save());
    await flush();

    expect(lb.queryByRole("button", { name: "Saving…" })).toBeNull();
    expect(save().disabled).toBe(false);

    const alert = lb.getByRole("alert");
    expect(alert.textContent ?? "").toMatch(/try again/i);
    expect(alert.textContent ?? "").not.toMatch(/offline-detail/);

    expect(saveLessonArrangementAction).toHaveBeenCalledTimes(1);

    vi.mocked(saveLessonArrangementAction).mockResolvedValueOnce({ ok: true, token: "tok-2" });
    fireEvent.click(save());
    await flush();

    expect(saveLessonArrangementAction).toHaveBeenCalledTimes(2);
    expect(lb.queryByRole("alert")).toBeNull();
  });
});
