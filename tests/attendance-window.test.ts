/**
 * Task 1 (plan 05-02): the attendance marking-window predicate (D-06,
 * RESEARCH Pitfall 4).
 *
 * The window is pure UTC arithmetic on the stored `startsAt` / `endsAt`
 * instants — no timezone on the path. The four boundary instants
 * (`startsAt - 1ms`, `startsAt`, `endsAt + 168h`, `endsAt + 168h + 1ms`)
 * are pinned exactly.
 */

import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_MARKING_WINDOW_HOURS,
  isBeforeSessionStart,
  isWithinMarkingWindow,
  markingWindowClosesAt,
} from "@/lib/attendance-window";

const startsAt = new Date("2026-05-01T10:00:00.000Z");
const endsAt = new Date("2026-05-01T12:00:00.000Z");
const session = { startsAt, endsAt };
const WINDOW_MS = 168 * 3_600_000;

describe("ATTENDANCE_MARKING_WINDOW_HOURS", () => {
  it("is 168 (7 days after the session ends)", () => {
    expect(ATTENDANCE_MARKING_WINDOW_HOURS).toBe(168);
  });
});

describe("isWithinMarkingWindow — the four boundary instants", () => {
  it("is false 1ms before startsAt", () => {
    expect(isWithinMarkingWindow(session, new Date(startsAt.getTime() - 1))).toBe(false);
  });

  it("is true exactly at startsAt", () => {
    expect(isWithinMarkingWindow(session, new Date(startsAt.getTime()))).toBe(true);
  });

  it("is true exactly at endsAt + 168h", () => {
    expect(isWithinMarkingWindow(session, new Date(endsAt.getTime() + WINDOW_MS))).toBe(true);
  });

  it("is false 1ms after endsAt + 168h", () => {
    expect(
      isWithinMarkingWindow(session, new Date(endsAt.getTime() + WINDOW_MS + 1)),
    ).toBe(false);
  });

  it("is true somewhere in the middle of the window", () => {
    expect(isWithinMarkingWindow(session, new Date(endsAt.getTime() + WINDOW_MS / 2))).toBe(
      true,
    );
  });
});

describe("isBeforeSessionStart", () => {
  it("is true 1ms before startsAt", () => {
    expect(isBeforeSessionStart(session, new Date(startsAt.getTime() - 1))).toBe(true);
  });

  it("is false exactly at startsAt", () => {
    expect(isBeforeSessionStart(session, new Date(startsAt.getTime()))).toBe(false);
  });

  it("is false after startsAt", () => {
    expect(isBeforeSessionStart(session, new Date(startsAt.getTime() + 1))).toBe(false);
  });
});

describe("markingWindowClosesAt", () => {
  it("is exactly endsAt + 168h", () => {
    expect(markingWindowClosesAt(session).getTime()).toBe(endsAt.getTime() + WINDOW_MS);
  });
});
