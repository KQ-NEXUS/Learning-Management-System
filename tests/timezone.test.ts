/**
 * Task 1 (plan 05-02): the cohort timezone converter (D-23).
 *
 * Pure unit coverage — wall-clock components entered in a named IANA zone
 * convert to the correct UTC instant and round-trip back. `Africa/Lagos`
 * (the schema default, no DST) and one negative-offset DST zone
 * (`America/New_York` in January = EST, UTC-5) are both pinned, plus
 * invalid-zone rejection.
 */

import { describe, expect, it } from "vitest";
import {
  isValidTimeZone,
  utcToWallParts,
  wallTimeToUtc,
  type WallTimeParts,
} from "@/lib/timezone";

describe("isValidTimeZone", () => {
  it("accepts a real IANA zone", () => {
    expect(isValidTimeZone("Africa/Lagos")).toBe(true);
    expect(isValidTimeZone("America/New_York")).toBe(true);
  });

  it("rejects a made-up zone", () => {
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(isValidTimeZone("")).toBe(false);
  });
});

describe("wallTimeToUtc", () => {
  it("converts a Lagos wall time (UTC+1, no DST) to the correct instant", () => {
    const parts: WallTimeParts = { year: 2026, month: 3, day: 1, hour: 9, minute: 0 };
    expect(wallTimeToUtc(parts, "Africa/Lagos").toISOString()).toBe(
      "2026-03-01T08:00:00.000Z",
    );
  });

  it("converts a New York January wall time (UTC-5, EST) to the correct instant", () => {
    const parts: WallTimeParts = { year: 2026, month: 1, day: 15, hour: 9, minute: 30 };
    expect(wallTimeToUtc(parts, "America/New_York").toISOString()).toBe(
      "2026-01-15T14:30:00.000Z",
    );
  });
});

describe("utcToWallParts round-trips wallTimeToUtc", () => {
  const cases: Array<{ tz: string; parts: WallTimeParts }> = [
    { tz: "Africa/Lagos", parts: { year: 2026, month: 3, day: 1, hour: 9, minute: 0 } },
    { tz: "America/New_York", parts: { year: 2026, month: 1, day: 15, hour: 9, minute: 30 } },
    { tz: "America/New_York", parts: { year: 2026, month: 7, day: 4, hour: 18, minute: 45 } },
  ];

  for (const { tz, parts } of cases) {
    it(`${tz} ${parts.year}-${parts.month}-${parts.day}`, () => {
      const instant = wallTimeToUtc(parts, tz);
      const back = utcToWallParts(instant, tz);
      expect({
        year: back.year,
        month: back.month,
        day: back.day,
        hour: back.hour,
        minute: back.minute,
      }).toEqual(parts);
      expect(back.label).toContain(tz);
    });
  }
});
