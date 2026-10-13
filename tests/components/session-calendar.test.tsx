/**
 * The session calendar (owner idea, 2026-10-04): staff click a day to schedule
 * a session on it; learners see their sessions with upcoming ones highlighted.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement, type ReactNode } from "react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode } & Record<string, unknown>) =>
    createElement("a", { href, ...rest }, children),
}));

import { SessionCalendar, type CalendarSession } from "@/components/calendar/SessionCalendar";

const TODAY = "2026-10-04";
const LAGOS = "Africa/Lagos";

const session = (over: Partial<CalendarSession> & { id: string }): CalendarSession => ({
  title: "Site walk-through",
  startsAt: "2026-10-05T08:00:00.000Z", // Monday 5 October, 09:00 in Lagos
  endsAt: "2026-10-05T11:30:00.000Z",
  timezone: LAGOS,
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T09:00:00.000Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("SessionCalendar — month view", () => {
  it("opens on the month containing today and shows each session on its day in the cohort's timezone", () => {
    render(<SessionCalendar sessions={[session({ id: "s1" })]} today={TODAY} />);

    expect(screen.getByRole("heading", { name: "October 2026" })).toBeTruthy();
    const chip = screen.getByLabelText("Site walk-through, 09:00 to 12:30, upcoming");
    expect(chip.textContent).toContain("09:00");
    // It sits in Monday the 5th's cell.
    expect(chip.closest("div.flex.min-w-0")?.textContent).toContain("Monday 5 October 2026");
  });

  it("highlights upcoming sessions and mutes finished and cancelled ones", () => {
    render(
      <SessionCalendar
        today={TODAY}
        sessions={[
          session({ id: "up" }),
          session({ id: "done", title: "Induction", startsAt: "2026-10-01T08:00:00.000Z", endsAt: "2026-10-01T09:00:00.000Z" }),
          session({ id: "off", title: "Drill", cancelled: true, startsAt: "2026-10-07T08:00:00.000Z", endsAt: "2026-10-07T09:00:00.000Z" }),
        ]}
      />,
    );

    expect(screen.getByLabelText(/Site walk-through.*upcoming$/).className).toContain("bg-accent-wash");
    expect(screen.getByLabelText(/Induction.*finished$/).className).not.toContain("bg-accent-wash");
    const cancelled = screen.getByLabelText(/Drill.*cancelled$/);
    expect(cancelled.className).toContain("line-through");
    expect(cancelled.className).not.toContain("bg-accent-wash");
  });

  it("moves between months and back to today", () => {
    render(<SessionCalendar sessions={[]} today={TODAY} />);

    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByRole("heading", { name: "November 2026" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByRole("heading", { name: "September 2026" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByRole("heading", { name: "October 2026" })).toBeTruthy();
  });

  it("staff: clicking a day reports that date, and clicking a session reports its id", () => {
    const onDayClick = vi.fn();
    const onItemClick = vi.fn();
    render(<SessionCalendar sessions={[session({ id: "s1" })]} today={TODAY} onDayClick={onDayClick} onItemClick={onItemClick} />);

    fireEvent.click(screen.getByRole("button", { name: /^Add a session on Wednesday 14 October 2026, no sessions$/ }));
    expect(onDayClick).toHaveBeenCalledExactlyOnceWith("2026-10-14");

    fireEvent.click(screen.getByRole("button", { name: /^Site walk-through/ }));
    expect(onItemClick).toHaveBeenCalledExactlyOnceWith("s1");
  });

  it("learner: days are not controls, and a session links to its course's sessions page", () => {
    render(<SessionCalendar sessions={[session({ id: "s1", href: "/learn/enr-1/sessions" })]} today={TODAY} />);

    expect(screen.queryByRole("button", { name: /^Add a session/ })).toBeNull();
    expect(screen.getByRole("link", { name: /^Site walk-through/ }).getAttribute("href")).toBe("/learn/enr-1/sessions");
    // Today is announced for a screen reader, not only shown as a coloured dot.
    expect(screen.getByText("Sunday 4 October 2026, today, no sessions")).toBeTruthy();
  });
});

describe("SessionCalendar — week view", () => {
  it("lists the week's seven days with each session's times, title and second line", () => {
    render(<SessionCalendar sessions={[session({ id: "s1", meta: "In person, Ikeja" })]} today={TODAY} />);
    fireEvent.click(screen.getByRole("button", { name: "Week" }));

    // Sunday 4 October belongs to the week that began on Monday 28 September.
    expect(screen.getByRole("heading", { name: "28 September to 4 October 2026" })).toBeTruthy();
    expect(screen.getAllByRole("region")).toHaveLength(7);
    expect(screen.getByRole("region", { name: "Sunday 4 October 2026, today" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    const monday = screen.getByRole("region", { name: "Monday 5 October 2026" });
    expect(within(monday).getByText("09:00 to 12:30")).toBeTruthy();
    expect(within(monday).getByText("Site walk-through")).toBeTruthy();
    expect(within(monday).getByText("In person, Ikeja")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Tuesday 6 October 2026" })).getByText("No sessions")).toBeTruthy();
  });

  it("staff: each day offers 'Add session' for that date", () => {
    const onDayClick = vi.fn();
    render(<SessionCalendar sessions={[]} today={TODAY} defaultView="week" onDayClick={onDayClick} />);

    fireEvent.click(screen.getByRole("button", { name: "Add a session on Friday 2 October 2026" }));
    expect(onDayClick).toHaveBeenCalledExactlyOnceWith("2026-10-02");
  });

  it("marks which view is selected", () => {
    render(<SessionCalendar sessions={[]} today={TODAY} />);
    expect(screen.getByRole("button", { name: "Month" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(screen.getByRole("button", { name: "Week" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Month" }).getAttribute("aria-pressed")).toBe("false");
  });
});
