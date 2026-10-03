/**
 * Audit A-11: editing a session opens the form on the session's own values.
 * The date and times must be the ones staff would read on a clock in the
 * cohort's timezone (they are sent back as wall-clock values and converted
 * server-side), and the meeting link must start blank, since the staff list
 * never carries it (D-25) and a blank field means "keep the current link".
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/primitives", () => ({ FormField: () => null, TextInput: () => null }));

import { sessionFieldsFromRow, toSessionActionFields } from "@/app/staff/cohorts/[id]/SessionFormFields";

const row = {
  title: "Site walk-through",
  startsAt: "2026-10-05T08:00:00.000Z",
  endsAt: "2026-10-05T11:30:00.000Z",
  timezone: "Africa/Lagos",
  location: "Ikeja",
  facilitatorId: "staff-1",
  attendanceExpected: false,
  courseId: null,
};

describe("sessionFieldsFromRow", () => {
  it("shows the date and times as read in the cohort's timezone", () => {
    expect(sessionFieldsFromRow(row)).toMatchObject({
      title: "Site walk-through",
      date: "2026-10-05",
      startTime: "09:00",
      endTime: "12:30",
      location: "Ikeja",
      facilitatorId: "staff-1",
      attendanceExpected: false,
      courseId: "",
    });
  });

  it("uses the cohort's date, not the UTC date, when they differ", () => {
    // 23:30 UTC on the 5th is 19:30 the same day in New York, and 00:30 on the 6th in Lagos.
    const late = { ...row, startsAt: "2026-10-05T23:30:00.000Z", endsAt: "2026-10-06T00:30:00.000Z" };
    expect(sessionFieldsFromRow({ ...late, timezone: "Africa/Lagos" })).toMatchObject({ date: "2026-10-06", startTime: "00:30", endTime: "01:30" });
    expect(sessionFieldsFromRow({ ...late, timezone: "America/New_York" })).toMatchObject({ date: "2026-10-05", startTime: "19:30", endTime: "20:30" });
  });

  it("starts the meeting link and its visibility window blank, so saving unchanged sends neither", () => {
    const fields = sessionFieldsFromRow(row);
    expect(fields.meetingUrl).toBe("");
    expect(fields.linkVisibleFromMinutes).toBe("");

    const payload = toSessionActionFields("cohort-1", fields);
    expect(payload.meetingUrl).toBeUndefined();
    expect(payload.linkVisibleFromMinutes).toBeUndefined();
  });
});
