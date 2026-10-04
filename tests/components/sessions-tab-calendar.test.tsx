/**
 * The staff Sessions tab's calendar view (owner idea, 2026-10-04): switch from
 * the table to a calendar, click a day, and the session form pops up with that
 * date already set. Clicking a session opens it for editing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement, type ReactNode } from "react";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  push: vi.fn(),
  createSessionAction: vi.fn(),
  updateSessionAction: vi.fn(),
  repeatWeeklyAction: vi.fn(),
  cancelSessionAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode } & Record<string, unknown>) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("@/app/staff/cohorts/[id]/session-actions", () => ({
  createSessionAction: mocks.createSessionAction,
  updateSessionAction: mocks.updateSessionAction,
  repeatWeeklyAction: mocks.repeatWeeklyAction,
  cancelSessionAction: mocks.cancelSessionAction,
}));

import { SessionsTab, type SessionRow } from "@/app/staff/cohorts/[id]/SessionsTab";

const LAGOS = "Africa/Lagos";

const row = (over: Partial<SessionRow> = {}): SessionRow => ({
  id: "session-1",
  cohortId: "cohort-1",
  courseId: null,
  title: "Site walk-through",
  startsAt: "2026-10-05T08:00:00.000Z",
  endsAt: "2026-10-05T11:00:00.000Z",
  startsAtLabel: "5 Oct 2026, 09:00 WAT",
  endsAtLabel: "5 Oct 2026, 12:00 WAT",
  location: "Ikeja",
  facilitatorId: null,
  attendanceExpected: true,
  cancelledAt: null,
  cancellationReason: null,
  timezone: LAGOS,
  hasMeetingLink: false,
  ...over,
});

function renderTab(props: Partial<Parameters<typeof SessionsTab>[0]> = {}) {
  return render(<SessionsTab cohortId="cohort-1" cohortTimezone={LAGOS} sessions={[row()]} {...props} />);
}

const openCalendar = () => fireEvent.click(screen.getByRole("button", { name: "Calendar" }));
const field = (dialog: HTMLElement, name: string) => dialog.querySelector(`[name="${name}"]`) as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-04T09:00:00.000Z"));
  mocks.createSessionAction.mockResolvedValue({ ok: true, sessionId: "new-1" });
  mocks.updateSessionAction.mockResolvedValue({ ok: true, sessionId: "session-1" });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Sessions tab — table and calendar views", () => {
  it("opens on the table, and the switch shows the calendar with the session on its day", () => {
    renderTab();

    expect(screen.getByRole("button", { name: "Table" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("heading", { name: "October 2026" })).toBeNull();

    openCalendar();

    expect(screen.getByRole("heading", { name: "October 2026" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Site walk-through, 09:00 to 12:00, upcoming$/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Calendar" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("clicking a day pops up the session form with that date set, and saving schedules it on that date", async () => {
    renderTab();
    openCalendar();

    fireEvent.click(screen.getByRole("button", { name: /^Add a session on Wednesday 14 October 2026/ }));

    const dialog = screen.getByRole("dialog", { name: "Add session" });
    expect(field(dialog, "date").value).toBe("2026-10-14");
    expect(field(dialog, "title").value).toBe("");

    fireEvent.change(field(dialog, "title"), { target: { value: "Fire drill" } });
    fireEvent.change(field(dialog, "startTime"), { target: { value: "10:00" } });
    fireEvent.change(field(dialog, "endTime"), { target: { value: "11:00" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add session" }));

    await waitFor(() => expect(mocks.createSessionAction).toHaveBeenCalledTimes(1));
    expect(mocks.createSessionAction.mock.calls[0]![0]).toMatchObject({
      cohortId: "cohort-1",
      title: "Fire drill",
      date: "2026-10-14",
      startTime: "10:00",
      endTime: "11:00",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("clicking a session pops up the edit form on its current values", async () => {
    renderTab();
    openCalendar();

    fireEvent.click(screen.getByRole("button", { name: /^Site walk-through/ }));

    const dialog = screen.getByRole("dialog", { name: "Edit Site walk-through" });
    expect(field(dialog, "date").value).toBe("2026-10-05");
    expect(field(dialog, "startTime").value).toBe("09:00");
    expect(field(dialog, "endTime").value).toBe("12:00");

    fireEvent.change(field(dialog, "endTime"), { target: { value: "12:30" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mocks.updateSessionAction).toHaveBeenCalledTimes(1));
    expect(mocks.updateSessionAction.mock.calls[0]![0]).toMatchObject({ sessionId: "session-1", endTime: "12:30" });
    expect(mocks.updateSessionAction.mock.calls[0]![0]).not.toHaveProperty("cohortId");
  });

  it("a failed save keeps the pop-up open with the message and what was typed", async () => {
    mocks.createSessionAction.mockResolvedValue({ ok: false, message: "A session's end time must be after its start time." });
    renderTab();
    openCalendar();
    fireEvent.click(screen.getByRole("button", { name: /^Add a session on Wednesday 14 October 2026/ }));
    const dialog = screen.getByRole("dialog", { name: "Add session" });
    fireEvent.change(field(dialog, "title"), { target: { value: "Fire drill" } });
    fireEvent.change(field(dialog, "startTime"), { target: { value: "11:00" } });
    fireEvent.change(field(dialog, "endTime"), { target: { value: "10:00" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add session" }));

    expect(await within(dialog).findByRole("alert")).toBeTruthy();
    expect(within(dialog).getByRole("alert").textContent).toContain("end time must be after its start time");
    expect(field(dialog, "title").value).toBe("Fire drill");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("Close dismisses the pop-up without saving", () => {
    renderTab();
    openCalendar();
    fireEvent.click(screen.getByRole("button", { name: /^Add a session on Wednesday 14 October 2026/ }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Close/ }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.createSessionAction).not.toHaveBeenCalled();
  });

  it("without cohorts.manage the calendar is read-only: days are not controls, and a session opens its register", () => {
    renderTab({ canManage: false });
    openCalendar();

    expect(screen.queryByRole("button", { name: /^Add a session/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add session" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^Site walk-through/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.push).toHaveBeenCalledWith("/staff/cohorts/cohort-1/sessions/session-1/attendance");
  });

  it("a cancelled session is shown struck through and cannot be opened for editing", () => {
    renderTab({ sessions: [row({ cancelledAt: "2026-10-01T00:00:00.000Z", cancellationReason: "Venue lost" })] });
    openCalendar();

    const chip = screen.getByRole("button", { name: /^Site walk-through.*cancelled$/ });
    expect(chip.className).toContain("line-through");
    fireEvent.click(chip);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("the table view still adds a session in place, with no pop-up", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Add session" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { name: "Add session" })).toBeTruthy();
  });
});
