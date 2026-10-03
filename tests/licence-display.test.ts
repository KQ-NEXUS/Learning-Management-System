/**
 * Instant formatting for licence screens (plan 14-06, D-11).
 *
 * The expected strings were produced by running the formatter once on this
 * runtime before being fixed here (plan instruction). Observed on Node 24 / ICU
 * 77: Intl en-GB prints "GMT+1" for Africa/Lagos and "Sept" for September, so
 * display.ts pins the WAT abbreviation and a fixed month table; these tests hold
 * the UI-SPEC text ("WAT", "Sep").
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_DISPLAY_ZONE, formatLicenceInstant, formatUtcInstant } from "@/server/licence/display";

describe("formatLicenceInstant and formatUtcInstant (D-11)", () => {
  it("Test 1: Lagos expiry instant renders as 30 Nov 2026, 23:59 WAT with its UTC form beside it", () => {
    const expiry = new Date("2026-11-30T22:59:59Z");
    expect(formatLicenceInstant(expiry, "Africa/Lagos")).toBe("30 Nov 2026, 23:59 WAT");
    expect(formatUtcInstant(expiry)).toBe("2026-11-30T22:59:59Z");
  });

  it("Test 2: Europe/London follows the DST changeover to the second", () => {
    expect(formatLicenceInstant(new Date("2026-07-01T12:00:00Z"), "Europe/London")).toBe("1 Jul 2026, 13:00 BST");
    expect(formatLicenceInstant(new Date("2026-03-29T00:59:59Z"), "Europe/London")).toBe("29 Mar 2026, 00:59 GMT");
    expect(formatLicenceInstant(new Date("2026-03-29T01:00:00Z"), "Europe/London")).toBe("29 Mar 2026, 02:00 BST");
  });

  it("falls back to Africa/Lagos for a null or an invalid zone", () => {
    const instant = new Date("2026-11-30T22:59:59Z");
    expect(DEFAULT_DISPLAY_ZONE).toBe("Africa/Lagos");
    expect(formatLicenceInstant(instant, null)).toBe("30 Nov 2026, 23:59 WAT");
    expect(formatLicenceInstant(instant, "Not/AZone")).toBe("30 Nov 2026, 23:59 WAT");
    expect(formatLicenceInstant(instant, "")).toBe("30 Nov 2026, 23:59 WAT");
  });

  it("renders midnight as 00:00, never 24:00", () => {
    expect(formatLicenceInstant(new Date("2026-11-30T23:00:00Z"), "Africa/Lagos")).toBe("1 Dec 2026, 00:00 WAT");
    expect(formatLicenceInstant(new Date("2026-11-30T00:00:00Z"), "UTC")).toBe("30 Nov 2026, 00:00 UTC");
  });

  it("uses a fixed month table, so September is Sep on every ICU version", () => {
    expect(formatLicenceInstant(new Date("2026-09-01T00:00:00Z"), "UTC")).toBe("1 Sep 2026, 00:00 UTC");
  });

  it("renders the leap day 2028-02-29 and keeps the UTC instant exact", () => {
    const leap = new Date("2028-02-29T23:30:00Z");
    expect(formatLicenceInstant(leap, "Africa/Lagos")).toBe("1 Mar 2028, 00:30 WAT");
    expect(formatUtcInstant(leap)).toBe("2028-02-29T23:30:00Z");
  });

  it("formatUtcInstant drops milliseconds", () => {
    expect(formatUtcInstant(new Date("2026-11-30T22:59:59.987Z"))).toBe("2026-11-30T22:59:59Z");
  });

  it("is deterministic across repeated calls (cached formatters do not change output)", () => {
    const instant = new Date("2026-11-30T22:59:59Z");
    expect(formatLicenceInstant(instant, "Africa/Lagos")).toBe(formatLicenceInstant(instant, "Africa/Lagos"));
  });
});
