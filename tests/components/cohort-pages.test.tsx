import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), can: vi.fn(), scope: vi.fn() }));
vi.mock("@/server/permissions", () => ({ can: mocks.can, AuthenticationError: class extends Error {}, AuthorizationError: class extends Error {} }));
vi.mock("@/server/services/cohort-scope", () => ({ cohortResourceScope: mocks.scope }));
vi.mock("@/server/services/cohort-service", () => ({ cohortService: { get: mocks.get },
  loadCohortReadinessAggregate: async () => ({}), loadCohortInstructors: async () => [] }));
vi.mock("@/server/services/readiness-service", () => ({ evaluateCohortReadiness: () => [] }));
vi.mock("@/server/services/scheduled-session-service", () => ({ listSessionsForCohort: async () => [] }));
vi.mock("@/server/services/roster-service", () => ({ loadCohortRoster: async () => [], loadAttendanceExceptions: async () => [] }));
vi.mock("@/server/services/course-service", () => ({ courseService: { get: async () => null, list: async () => [] } }));
vi.mock("@/server/services/programme-service", () => ({ programmeService: { get: async () => null, list: async () => [] } }));
vi.mock("@/app/staff/cohorts/CohortForm", () => ({ CohortForm: () => null }));
vi.mock("@/components/catalogue/CohortDetailActions", () => ({ CohortDetailActions: () => null }));
vi.mock("@/app/staff/cohorts/[id]/SessionsTab", () => ({ SessionsTab: () => null }));
vi.mock("@/app/staff/cohorts/[id]/RosterTab", () => ({ RosterTab: () => null }));
vi.mock("@/app/staff/cohorts/[id]/ExceptionsTab", () => ({ ExceptionsTab: () => null }));
vi.mock("@/app/staff/cohorts/[id]/InstructorsPanel", () => ({ InstructorsPanel: () => null }));
import DetailPage from "@/app/staff/cohorts/[id]/page";
import EditPage from "@/app/staff/cohorts/[id]/edit/page";

function seed(timezone = "Africa/Lagos") {
  mocks.get.mockResolvedValue({ id: "cohort-1", title: "Cohort", code: "C1", status: "DRAFT", courseId: "course-1",
    timezone, deliveryMode: "SELF_PACED", currency: "NGN", priceMinor: 0,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    startsAt: new Date("2026-07-01T08:00:00Z"), endsAt: new Date("2026-08-01T16:00:00Z"),
    enrolmentOpensAt: new Date("2026-05-01T08:00:00Z"), enrolmentClosesAt: new Date("2026-06-01T16:00:00Z") });
}
it.each([["Africa/Lagos", "09", "17"], ["America/New_York", "04", "12"]])("formats every edit date in %s", async (zone, start, end) => {
  seed(zone);
  const page = await EditPage({ params: Promise.resolve({ id: "cohort-1" }) });
  const form = page.props.children[1];
  expect(form.props.values).toMatchObject({ startsAt: `2026-07-01T${start}:00`, endsAt: `2026-08-01T${end}:00`,
    enrolmentOpensAt: `2026-05-01T${start}:00`, enrolmentClosesAt: `2026-06-01T${end}:00` });
});
it.each(["courseIds", "programmeId"])("uses resolved %s ancestry for detail controls", async (ancestor) => {
  seed();
  const resource = { cohortId: "cohort-1", courseIds: ["course-1"], programmeId: "programme-1" };
  mocks.scope.mockResolvedValue(resource);
  mocks.can.mockImplementation(async (_permission, scope) => Boolean(scope[ancestor]));
  const page = await DetailPage({ params: Promise.resolve({ id: "cohort-1" }), searchParams: Promise.resolve({}) });
  expect(page.props.actions.props).toMatchObject({ canPublish: true, canManage: true });
  expect(mocks.scope).toHaveBeenCalledWith("cohort-1");
  expect(mocks.can).toHaveBeenCalledWith("cohorts.manage", resource);
  expect(mocks.can).toHaveBeenCalledWith("cohorts.publish", resource);
});
