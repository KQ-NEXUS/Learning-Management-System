import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  civilDateIn,
  dayLabel,
  monthGrid,
  monthLabel,
  startOfWeek,
  wallTimeIn,
  weekLabel,
  weekOf,
  yearMonthOf,
} from "@/lib/calendar";

describe("civil dates", () => {
  it("places an instant on the day and time it has in the given timezone", () => {
    // 23:30 UTC on the 5th is already the 6th in Lagos, and still the 5th in New York.
    const instant = "2026-10-05T23:30:00.000Z";
    expect(civilDateIn(instant, "Africa/Lagos")).toBe("2026-10-06");
    expect(wallTimeIn(instant, "Africa/Lagos")).toBe("00:30");
    expect(civilDateIn(instant, "America/New_York")).toBe("2026-10-05");
    expect(wallTimeIn(instant, "America/New_York")).toBe("19:30");
  });

  it("adds days and months across month and year ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29"); // leap year
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(yearMonthOf("2026-10-05")).toBe("2026-10");
  });
});

describe("weeks start on Monday", () => {
  it("finds the Monday of any day's week, including a Sunday", () => {
    expect(startOfWeek("2026-10-05")).toBe("2026-10-05"); // a Monday
    expect(startOfWeek("2026-10-08")).toBe("2026-10-05"); // Thursday
    expect(startOfWeek("2026-10-11")).toBe("2026-10-05"); // Sunday belongs to the week that began on the 5th
  });

  it("lists Monday to Sunday", () => {
    expect(weekOf("2026-10-08")).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
    ]);
  });
});

describe("monthGrid", () => {
  it("covers the month in whole Monday-to-Sunday weeks, padding with neighbouring days", () => {
    const grid = monthGrid("2026-10"); // 1 October 2026 is a Thursday
    expect(grid[0][0]).toBe("2026-09-28");
    expect(grid[0][3]).toBe("2026-10-01");
    expect(grid.at(-1)!.at(-1)).toBe("2026-11-01");
    expect(grid).toHaveLength(5);
    expect(grid.every((week) => week.length === 7)).toBe(true);
    expect(grid.flat().filter((date) => date.startsWith("2026-10-"))).toHaveLength(31);
  });

  it("needs four rows for a February that starts on a Monday, and six for a long month that starts late in the week", () => {
    expect(monthGrid("2027-02")).toHaveLength(4); // 1 February 2027 is a Monday, 28 days
    expect(monthGrid("2026-08")).toHaveLength(6); // 1 August 2026 is a Saturday, 31 days
  });
});

describe("labels", () => {
  it("names months, days and weeks in words", () => {
    expect(monthLabel("2026-10")).toBe("October 2026");
    expect(dayLabel("2026-10-05")).toBe("Monday 5 October 2026");
    expect(weekLabel("2026-10-08")).toBe("5 to 11 October 2026");
    expect(weekLabel("2026-10-01")).toBe("28 September to 4 October 2026");
  });
});
