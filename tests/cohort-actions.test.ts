import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), get: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error("redirect:" + url); } }));
vi.mock("@/server/services/cohort-service", () => ({
  cohortService: { create: mocks.create, get: mocks.get }, updateCohort: mocks.update, OfferLockedError: class extends Error {},
}));
import { createCohortAction, updateCohortAction } from "@/app/staff/cohorts/actions";

const previous = { ok: false as const, errors: [], message: null };
function form(timezone = "Africa/Lagos") {
  const data = new FormData();
  Object.entries({ code: "C1", title: "Cohort", courseId: "course-1", deliveryMode: "SELF_PACED", timezone,
    startsAt: "2026-07-01T09:00", endsAt: "2026-08-01T17:00", enrolmentOpensAt: "2026-05-01T09:00",
    enrolmentClosesAt: "2026-06-01T17:00", capacity: "20", priceMinor: "0", currency: "NGN",
    cohortId: "cohort-1", expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
  }).forEach(([key, value]) => data.set(key, value));
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({ id: "cohort-1" });
  mocks.get.mockResolvedValue({ updatedAt: new Date("2026-01-01T00:00:00.000Z") });
});
it.each([["Africa/Lagos", "08"], ["America/New_York", "13"]])("creates dates in %s, independent of the server zone", async (zone, hour) => {
  await expect(createCohortAction(previous, form(zone))).rejects.toThrow("redirect:/staff/cohorts/cohort-1");
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ startsAt: new Date(`2026-07-01T${hour}:00:00Z`) }));
});
it("passes the editor version into the conditional write with zoned dates", async () => {
  expect(await updateCohortAction(previous, form())).toEqual({ ok: true, id: "cohort-1" });
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
    expectedUpdatedAt: new Date("2026-01-01T00:00:00.000Z"),
    data: expect.objectContaining({ startsAt: new Date("2026-07-01T08:00:00Z"), endsAt: new Date("2026-08-01T16:00:00Z"),
      enrolmentOpensAt: new Date("2026-05-01T08:00:00Z"), enrolmentClosesAt: new Date("2026-06-01T16:00:00Z") }),
  }));
});
it.each(["2026-02-30T09:00", "2026-03-08T02:30", "2026-07-01T09:00Z"])("rejects invalid or nonexistent New York wall time %s", async (value) => {
  const data = form("America/New_York");
  data.set("startsAt", value);
  expect(await updateCohortAction(previous, data)).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.objectContaining({ name: "startsAt" })]) });
  expect(mocks.update).not.toHaveBeenCalled();
});
