/**
 * Plan 15-05 Task 1: the shared Lagos-time formatter (D-17, UI-SPEC S6).
 *
 * Pure unit coverage of src/lib/format-timestamp.ts: every output is pinned
 * as an exact string so server and browser renders stay byte-identical, the
 * zone label is the literal " WAT" (never ICU's "GMT+1"), month names never
 * come out as ICU's "Sept", the Lagos day boundary is honoured, and missing
 * or invalid input renders "—" without throwing.
 */

import { describe, expect, it } from "vitest";
import {
  LAGOS_ZONE_LABEL,
  formatDateOnly,
  formatDateShort,
  formatDateTimeShort,
  formatLagosOrDash,
  formatTimestamp,
  formatTimestampWithSeconds,
} from "@/lib/format-timestamp";

describe("Lagos date and time (D-17)", () => {
  it("renders day, short month, year and 24-hour Lagos time with a literal WAT suffix", () => {
    expect(formatDateTimeShort(new Date("2026-10-05T13:30:00Z"))).toBe("5 Oct 2026, 14:30 WAT");
  });

  it("formatTimestamp matches formatDateTimeShort (minutes precision)", () => {
    const instant = new Date("2026-10-05T13:30:45Z");
    expect(formatTimestamp(instant)).toBe("5 Oct 2026, 14:30 WAT");
    expect(formatTimestamp(instant)).toBe(formatDateTimeShort(instant));
  });

  it("renders seconds for the audit variant", () => {
    expect(formatTimestampWithSeconds(new Date("2026-10-05T13:30:12Z"))).toBe("5 Oct 2026, 14:30:12 WAT");
  });

  it("uses 24-hour time with zero-padded hours and minutes", () => {
    expect(formatDateTimeShort(new Date("2026-10-05T21:05:00Z"))).toBe("5 Oct 2026, 22:05 WAT");
    expect(formatDateTimeShort(new Date("2026-10-05T07:09:00Z"))).toBe("5 Oct 2026, 08:09 WAT");
  });

  it("prints midnight Lagos as 00, never 24", () => {
    expect(formatTimestampWithSeconds(new Date("2026-10-05T23:00:00Z"))).toBe("6 Oct 2026, 00:00:00 WAT");
  });

  it("never prints GMT+1, UTC or ICU's 'Sept'", () => {
    const text = formatDateTimeShort(new Date("2026-09-19T08:42:00Z"));
    expect(text).toBe("19 Sep 2026, 09:42 WAT");
    expect(text).not.toMatch(/GMT|UTC|Sept/);
    expect(LAGOS_ZONE_LABEL).toBe(" WAT");
  });

  it("accepts an ISO string as well as a Date", () => {
    expect(formatTimestamp("2026-10-05T13:30:00.000Z")).toBe("5 Oct 2026, 14:30 WAT");
  });
});

describe("Lagos day boundary", () => {
  const lateUtc = new Date("2026-10-05T23:30:00Z");

  it("rolls the date-time over to the next Lagos day", () => {
    expect(formatDateTimeShort(lateUtc)).toBe("6 Oct 2026, 00:30 WAT");
  });

  it("computes date-only values on the Lagos calendar day, with no zone label", () => {
    expect(formatDateOnly(lateUtc)).toBe("6 Oct 2026");
    expect(formatDateShort(lateUtc)).toBe("6 Oct 2026");
  });

  it("rolls the year over at Lagos midnight on 31 December", () => {
    expect(formatDateOnly(new Date("2026-12-31T23:15:00Z"))).toBe("1 Jan 2027");
  });
});

describe("missing and invalid timestamps", () => {
  it("renders an em dash for null, undefined, empty and unparseable input", () => {
    expect(formatLagosOrDash(null)).toBe("—");
    expect(formatLagosOrDash(undefined)).toBe("—");
    expect(formatLagosOrDash("")).toBe("—");
    expect(formatLagosOrDash("not a date")).toBe("—");
    expect(formatLagosOrDash(new Date("nope"))).toBe("—");
  });

  it("never throws or prints Invalid Date from the central functions", () => {
    const invalid = new Date("nope");
    for (const fn of [formatTimestamp, formatDateTimeShort, formatTimestampWithSeconds, formatDateOnly, formatDateShort]) {
      expect(() => fn(invalid)).not.toThrow();
      expect(fn(invalid)).toBe("—");
    }
  });

  it("formats a valid value in the requested variant", () => {
    const instant = "2026-10-05T13:30:12Z";
    expect(formatLagosOrDash(instant)).toBe("5 Oct 2026, 14:30 WAT");
    expect(formatLagosOrDash(instant, "dateTimeSeconds")).toBe("5 Oct 2026, 14:30:12 WAT");
    expect(formatLagosOrDash(instant, "date")).toBe("5 Oct 2026");
  });
});
