import { expect, it } from "vitest";
import { formatCohortDateTime, parseCohortDateTime } from "@/lib/cohort-datetime";

it.each([
  ["2026-03-08T01:30", "2026-03-08T06:30:00.000Z"],
  ["2026-03-08T03:30", "2026-03-08T07:30:00.000Z"],
  ["2026-11-01T01:30", "2026-11-01T05:30:00.000Z"],
])("round-trips New York wall time %s across DST boundaries", (wall, utc) => {
  const instant = parseCohortDateTime(wall, "America/New_York");
  expect(instant?.toISOString()).toBe(utc);
  expect(formatCohortDateTime(instant!, "America/New_York")).toBe(wall);
});
it("handles a fractional-hour timezone", () => {
  expect(parseCohortDateTime("2026-07-01T09:00", "Asia/Kolkata")?.toISOString()).toBe("2026-07-01T03:30:00.000Z");
});
it("rejects an invalid timezone without throwing", () => {
  expect(parseCohortDateTime("2026-07-01T09:00", "Mars/Olympus")).toBeNull();
});
