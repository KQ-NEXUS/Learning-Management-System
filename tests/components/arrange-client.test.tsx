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
const rethrowSpy = vi.fn();
// The real `unstable_rethrow` runs behind a spy, so a genuine Next.js redirect
// error is rethrown exactly as in production and every call is observable.
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return {
    useRouter: () => ({ refresh, push }),
    unstable_rethrow: (error: unknown) => {
      rethrowSpy(error);
      actual.unstable_rethrow(error);
    },
  };
});

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
  restoreItemAction,
  createModuleAction,
  renameModuleAction,
} from "@/app/staff/courses/[id]/arrange/actions";
import { captureUnhandledRejection, nextRedirectError } from "./control-flow-helpers";
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

function renderClient(
  withdrawn: {
    modules?: { id: string; title: string }[];
    lessons?: { id: string; title: string; moduleTitle: string }[];
  } = {},
) {
  return render(
    <ArrangeClient
      courseId="course-1"
      token="tok-1"
      modules={modules()}
      withdrawnModules={withdrawn.modules ?? []}
      withdrawnLessons={withdrawn.lessons ?? []}
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

/**
 * WR-01 (04.1-REVIEW-2, folded into plan 15-08) — `handleRestore` was the one
 * mutation handler left without the try/catch/finally shape: a rejected
 * `restoreItemAction` became an unhandled rejection, showed nothing, and left
 * the in-flight guard (once added) able to strand the control. A restore must
 * either apply (refresh) or say plainly that it did not, and stay retryable.
 */
describe("ArrangeClient — restoring a withdrawn item", () => {
  const withdrawnModule = { modules: [{ id: "wm1", title: "Old Module" }] };
  const withdrawnLesson = {
    lessons: [{ id: "wl1", title: "Old Lesson", moduleTitle: "Module One" }],
  };

  it("a rejected restore shows the generic retryable alert, leaks nothing, and a user retry runs again", async () => {
    vi.mocked(restoreItemAction).mockRejectedValueOnce(new Error("socket-detail"));
    renderClient(withdrawnModule);

    const mb = board("Module order");
    const restore = () => mb.getByRole("button", { name: "Restore" }) as HTMLButtonElement;
    fireEvent.click(restore());
    await flush();

    const alert = mb.getByRole("alert");
    expect(alert.textContent ?? "").toMatch(/Nothing was changed — try again/);
    expect(alert.textContent ?? "").not.toMatch(/socket-detail/);
    expect(refresh).not.toHaveBeenCalled();
    expect(restoreItemAction).toHaveBeenCalledTimes(1);

    // The control is not stranded: a user-triggered retry calls the action
    // again, and its success clears the alert and refreshes.
    vi.mocked(restoreItemAction).mockResolvedValueOnce({ ok: true });
    fireEvent.click(restore());
    await flush();

    expect(restoreItemAction).toHaveBeenCalledTimes(2);
    expect(restoreItemAction).toHaveBeenLastCalledWith({
      courseId: "course-1",
      kind: "module",
      id: "wm1",
    });
    expect(mb.queryByRole("alert")).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("a resolved { ok: false } restore shows its failure and nothing is marked restored", async () => {
    vi.mocked(restoreItemAction).mockResolvedValueOnce({
      ok: false,
      message: "Your role does not permit editing this course.",
    });
    renderClient(withdrawnLesson);

    const lb = board("Lessons by module");
    fireEvent.click(lb.getByRole("button", { name: "Restore" }));
    await flush();

    expect(lb.getByRole("alert").textContent ?? "").toMatch(
      /Your role does not permit editing this course\./,
    );
    expect(refresh).not.toHaveBeenCalled();
    expect(restoreItemAction).toHaveBeenCalledWith({
      courseId: "course-1",
      kind: "lesson",
      id: "wl1",
    });
  });

  it("a resolved { ok: true } restore refreshes and shows no error", async () => {
    vi.mocked(restoreItemAction).mockResolvedValueOnce({ ok: true });
    renderClient(withdrawnLesson);

    const lb = board("Lessons by module");
    fireEvent.click(lb.getByRole("button", { name: "Restore" }));
    await flush();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(lb.queryByRole("alert")).toBeNull();
  });

  it("ignores a second click while a restore is in flight, then accepts one after it settles", async () => {
    let settle: (value: { ok: false; message: string }) => void = () => {};
    vi.mocked(restoreItemAction).mockImplementationOnce(
      () => new Promise((resolve) => (settle = resolve)),
    );
    renderClient(withdrawnModule);

    const mb = board("Module order");
    const restore = () => mb.getByRole("button", { name: "Restore" });
    fireEvent.click(restore());
    fireEvent.click(restore());
    await flush();
    expect(restoreItemAction).toHaveBeenCalledTimes(1);

    await act(async () => settle({ ok: false, message: "Not restored." }));
    await flush();

    vi.mocked(restoreItemAction).mockResolvedValueOnce({ ok: true });
    fireEvent.click(restore());
    await flush();
    expect(restoreItemAction).toHaveBeenCalledTimes(2);
  });
});

/**
 * WR-02 (04.1-REVIEW-2, folded into plan 15-08) — every catch block must hand
 * Next.js control flow (`redirect()` / `notFound()`) back to the framework via
 * `unstable_rethrow` before its own generic-error handling, so a session that
 * ends mid-edit redirects to sign-in instead of showing "try again".
 */
describe("ArrangeClient — framework control flow passes through every catch", () => {
  it("a redirect thrown through the module-order save propagates instead of becoming the generic alert", async () => {
    const redirectError = await nextRedirectError();
    vi.mocked(saveModuleOrderAction).mockRejectedValueOnce(redirectError);
    renderClient();

    const mb = board("Module order");
    fireEvent.click(mb.getByRole("button", { name: "Move Module One down" }));
    const reason = await captureUnhandledRejection(() =>
      fireEvent.click(mb.getByRole("button", { name: "Save order" })),
    );
    await flush();

    expect(reason).toBe(redirectError);
    expect(rethrowSpy).toHaveBeenCalledWith(redirectError);
    expect(mb.queryByRole("alert")).toBeNull();
    // `finally` still ran: the board is not stuck on "Saving…".
    expect(mb.queryByRole("button", { name: "Saving…" })).toBeNull();
  });

  it("a redirect thrown through the lesson-arrangement save propagates", async () => {
    const redirectError = await nextRedirectError();
    vi.mocked(saveLessonArrangementAction).mockRejectedValueOnce(redirectError);
    renderClient();

    const lb = board("Lessons by module");
    fireEvent.click(lb.getByRole("button", { name: "Move Lesson A1 down" }));
    const reason = await captureUnhandledRejection(() =>
      fireEvent.click(lb.getByRole("button", { name: "Save order" })),
    );
    await flush();

    expect(reason).toBe(redirectError);
    expect(lb.queryByRole("alert")).toBeNull();
  });

  it("a redirect thrown through restore propagates and still releases the in-flight guard", async () => {
    const redirectError = await nextRedirectError();
    vi.mocked(restoreItemAction).mockRejectedValueOnce(redirectError);
    renderClient({ modules: [{ id: "wm1", title: "Old Module" }] });

    const mb = board("Module order");
    const reason = await captureUnhandledRejection(() =>
      fireEvent.click(mb.getByRole("button", { name: "Restore" })),
    );
    await flush();

    expect(reason).toBe(redirectError);
    expect(mb.queryByRole("alert")).toBeNull();

    vi.mocked(restoreItemAction).mockResolvedValueOnce({ ok: true });
    fireEvent.click(mb.getByRole("button", { name: "Restore" }));
    await flush();
    expect(restoreItemAction).toHaveBeenCalledTimes(2);
  });

  it("a redirect thrown through add-module reaches the framework past the composer", async () => {
    const redirectError = await nextRedirectError();
    vi.mocked(createModuleAction).mockRejectedValueOnce(redirectError);
    renderClient();

    fireEvent.change(screen.getByRole("textbox", { name: /Module title/ }), {
      target: { value: "Module Three" },
    });
    const reason = await captureUnhandledRejection(() =>
      fireEvent.click(screen.getByRole("button", { name: "Add module" })),
    );
    await flush();

    expect(reason).toBe(redirectError);
    expect(rethrowSpy).toHaveBeenCalledWith(redirectError);
  });

  it("a redirect thrown through rename-module reaches the framework past the composer", async () => {
    const redirectError = await nextRedirectError();
    vi.mocked(renameModuleAction).mockRejectedValueOnce(redirectError);
    renderClient();

    fireEvent.click(screen.getAllByRole("button", { name: "Rename" })[0]);
    const reason = await captureUnhandledRejection(() =>
      fireEvent.click(screen.getByRole("button", { name: "Save name" })),
    );
    await flush();

    expect(reason).toBe(redirectError);
    expect(rethrowSpy).toHaveBeenCalledWith(redirectError);
  });

  it("an ordinary application error is offered to unstable_rethrow first, then shown generically", async () => {
    const appError = new Error("db-detail");
    vi.mocked(createModuleAction).mockRejectedValueOnce(appError);
    renderClient();

    fireEvent.change(screen.getByRole("textbox", { name: /Module title/ }), {
      target: { value: "Module Three" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add module" }));
    await flush();

    expect(rethrowSpy).toHaveBeenCalledWith(appError);
    const alert = await screen.findByText(/Something went wrong adding the module\. Try again\./);
    expect(alert.textContent ?? "").not.toMatch(/db-detail/);
  });
});
