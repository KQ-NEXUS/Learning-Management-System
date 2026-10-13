/**
 * G-RV-01 (BLOCKER) / CR-01 — the programme composition screen's three
 * imperative mutation handlers must recover from an unexpected Server Action
 * rejection.
 *
 * `handleSave`, `handleAdd` and `handleRemove` each `await` a Server Action.
 * Before this fix none had a `try/catch/finally`, so a rejection left
 * `saving` / `busyCourseId` stuck: "Save order" stayed on "Saving…" or the
 * candidate button on "Adding…", disabled, with no error and no recovery
 * short of a reload.
 *
 * Each handler is proven independently: rejection -> busy flag cleared, idle
 * control label restored, a generic `role="alert"` message that never echoes
 * the rejection text, then a user-triggered retry that succeeds. The action
 * call count proves nothing retries automatically.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ProgrammeMemberRow } from "@/server/services/programme-service";

const refresh = vi.fn();
const rethrowSpy = vi.fn();
// The real `unstable_rethrow` runs behind a spy (see arrange-client.test.tsx).
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return {
    useRouter: () => ({ refresh }),
    unstable_rethrow: (error: unknown) => {
      rethrowSpy(error);
      actual.unstable_rethrow(error);
    },
  };
});

vi.mock("@/app/staff/programmes/[id]/arrange/actions", () => ({
  saveProgrammeCourseOrderAction: vi.fn(),
  addCourseAction: vi.fn(),
  removeCourseAction: vi.fn(),
}));

import {
  saveProgrammeCourseOrderAction,
  addCourseAction,
  removeCourseAction,
} from "@/app/staff/programmes/[id]/arrange/actions";
import { ProgrammeArrangeClient } from "@/app/staff/programmes/[id]/arrange/ProgrammeArrangeClient";
import {
  captureUnhandledRejection,
  nextNotFoundError,
  nextRedirectError,
} from "./control-flow-helpers";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

const members = (): ProgrammeMemberRow[] => [
  {
    membershipId: "pc1",
    courseId: "c1",
    position: 1,
    title: "Course One",
    slug: "course-one",
    status: "PUBLISHED",
    otherProgrammeTitles: [],
  },
  {
    membershipId: "pc2",
    courseId: "c2",
    position: 2,
    title: "Course Two",
    slug: "course-two",
    status: "PUBLISHED",
    otherProgrammeTitles: [],
  },
];

function renderClient() {
  return render(
    <ProgrammeArrangeClient
      programmeId="prog-1"
      token="tok-1"
      members={members()}
      addableCourses={[
        { id: "c3", title: "Course Three", slug: "course-three", status: "PUBLISHED" },
      ]}
    />,
  );
}

const btn = (name: string) =>
  screen.getByRole("button", { name }) as HTMLButtonElement;

describe("ProgrammeArrangeClient — rejected save order recovers", () => {
  it("clears saving, surfaces a generic retryable alert, and a user retry succeeds", async () => {
    vi.mocked(saveProgrammeCourseOrderAction).mockRejectedValueOnce(new Error("wire-detail"));
    renderClient();

    fireEvent.click(btn("Move Course One down"));
    fireEvent.click(btn("Save order"));
    await flush();

    expect(screen.queryByRole("button", { name: "Saving…" })).toBeNull();
    expect(btn("Save order").disabled).toBe(false);

    const alert = screen.getByRole("alert");
    expect(alert.textContent ?? "").toMatch(/try again/i);
    expect(alert.textContent ?? "").not.toMatch(/wire-detail/);
    expect(saveProgrammeCourseOrderAction).toHaveBeenCalledTimes(1);

    vi.mocked(saveProgrammeCourseOrderAction).mockResolvedValueOnce({ ok: true, token: "tok-2" });
    fireEvent.click(btn("Save order"));
    await flush();

    expect(saveProgrammeCourseOrderAction).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("ProgrammeArrangeClient — rejected add course recovers", () => {
  it("clears the Adding… state, surfaces a generic retryable alert, and a user retry succeeds", async () => {
    vi.mocked(addCourseAction).mockRejectedValueOnce(new Error("wire-detail"));
    renderClient();

    fireEvent.click(btn("Add"));
    await flush();

    expect(screen.queryByRole("button", { name: "Adding…" })).toBeNull();
    expect(btn("Add").disabled).toBe(false);

    const alert = screen.getByRole("alert");
    expect(alert.textContent ?? "").toMatch(/try again/i);
    expect(alert.textContent ?? "").not.toMatch(/wire-detail/);
    expect(addCourseAction).toHaveBeenCalledTimes(1);

    vi.mocked(addCourseAction).mockResolvedValueOnce({ ok: true });
    fireEvent.click(btn("Add"));
    await flush();

    expect(addCourseAction).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("ProgrammeArrangeClient — rejected remove course recovers", () => {
  it("clears the busy row, surfaces a generic retryable alert, and a user retry succeeds", async () => {
    vi.mocked(removeCourseAction).mockRejectedValueOnce(new Error("wire-detail"));
    renderClient();

    const remove = () => btn("Remove Course One from this programme");
    fireEvent.click(remove());
    await flush();

    expect(remove().disabled).toBe(false);

    const alert = screen.getByRole("alert");
    expect(alert.textContent ?? "").toMatch(/try again/i);
    expect(alert.textContent ?? "").not.toMatch(/wire-detail/);
    expect(removeCourseAction).toHaveBeenCalledTimes(1);

    vi.mocked(removeCourseAction).mockResolvedValueOnce({ ok: true });
    fireEvent.click(remove());
    await flush();

    expect(removeCourseAction).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

/**
 * WR-02 (04.1-REVIEW-2, folded into plan 15-08) — each of the three catch
 * blocks hands Next.js control flow back via `unstable_rethrow` before its
 * generic-error handling, and its `finally` still releases the busy state.
 */
describe("ProgrammeArrangeClient — framework control flow passes through every catch", () => {
  it("a redirect thrown through save order propagates instead of becoming the generic alert", async () => {
    const redirectError = await nextRedirectError();
    vi.mocked(saveProgrammeCourseOrderAction).mockRejectedValueOnce(redirectError);
    renderClient();

    fireEvent.click(btn("Move Course One down"));
    const reason = await captureUnhandledRejection(() => fireEvent.click(btn("Save order")));
    await flush();

    expect(reason).toBe(redirectError);
    expect(rethrowSpy).toHaveBeenCalledWith(redirectError);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Saving…" })).toBeNull();
  });

  it("a redirect thrown through add course propagates and releases the Adding… state", async () => {
    const redirectError = await nextRedirectError();
    vi.mocked(addCourseAction).mockRejectedValueOnce(redirectError);
    renderClient();

    const reason = await captureUnhandledRejection(() => fireEvent.click(btn("Add")));
    await flush();

    expect(reason).toBe(redirectError);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(btn("Add").disabled).toBe(false);
  });

  it("a notFound thrown through remove course propagates and releases the row", async () => {
    const notFoundError = await nextNotFoundError();
    vi.mocked(removeCourseAction).mockRejectedValueOnce(notFoundError);
    renderClient();

    const remove = () => btn("Remove Course One from this programme");
    const reason = await captureUnhandledRejection(() => fireEvent.click(remove()));
    await flush();

    expect(reason).toBe(notFoundError);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(remove().disabled).toBe(false);
  });

  it("an ordinary application error is offered to unstable_rethrow first, then shown generically", async () => {
    const appError = new Error("wire-detail");
    vi.mocked(addCourseAction).mockRejectedValueOnce(appError);
    renderClient();

    fireEvent.click(btn("Add"));
    await flush();

    expect(rethrowSpy).toHaveBeenCalledWith(appError);
    expect(screen.getByRole("alert").textContent ?? "").toMatch(/try again/i);
  });
});
