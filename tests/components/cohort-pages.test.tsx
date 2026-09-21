function usd(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format(amount);
}

import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  can: vi.fn(),
  scope: vi.fn(),
  evaluateReadiness: vi.fn((): unknown[] => []),
}));
vi.mock("@/server/permissions", () => ({ can: mocks.can, AuthenticationError: class extends Error {}, AuthorizationError: class extends Error {} }));
vi.mock("@/server/services/cohort-scope", () => ({ cohortResourceScope: mocks.scope }));
vi.mock("@/server/services/cohort-service", () => ({ cohortService: { get: mocks.get },
  loadCohortReadinessAggregate: async () => ({}), loadCohortInstructors: async () => [] }));
vi.mock("@/server/services/readiness-service", () => ({ evaluateCohortReadiness: mocks.evaluateReadiness }));
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
vi.mock("@/app/staff/cohorts/[id]/GradingTab", () => ({ GradingTab: () => null }));
import DetailPage from "@/app/staff/cohorts/[id]/page";
import EditPage from "@/app/staff/cohorts/[id]/edit/page";

function seed(timezone = "Africa/Lagos", priceOverrides: { priceNgnMinor?: number | null; priceUsdMinor?: number | null } = {}) {
  mocks.get.mockResolvedValue({ id: "cohort-1", title: "Cohort", code: "C1", status: "DRAFT", courseId: "course-1",
    timezone, deliveryMode: "SELF_PACED", currency: "NGN", priceMinor: 0,
    priceNgnMinor: priceOverrides.priceNgnMinor ?? null,
    priceUsdMinor: priceOverrides.priceUsdMinor ?? null,
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

// D-06/D-08 — dual-price Overview facts and per-rail readiness (07-05).

type FactRow = { label: string; value: string };

function overviewFacts(page: Awaited<ReturnType<typeof DetailPage>>): FactRow[] {
  const overviewSection = page.props.sections[0];
  const overviewContent = overviewSection.content;
  // children[0] is the "Cohort details" section: heading, then a div wrapping <DetailFacts>.
  return overviewContent.props.children[0].props.children[1].props.children.props.facts as FactRow[];
}

function readinessItemsProp(page: Awaited<ReturnType<typeof DetailPage>>) {
  const overviewSection = page.props.sections[0];
  const overviewContent = overviewSection.content;
  // children[1] is the right-hand column: readiness panel first, then instructors.
  return overviewContent.props.children[1].props.children[1].props.items as Array<{ id: string; state: string; label: string }>;
}

it("renders 'Not set' for both price facts when neither rail is priced — never an empty cell, never 0", async () => {
  seed();
  const page = await DetailPage({ params: Promise.resolve({ id: "cohort-1" }), searchParams: Promise.resolve({}) });
  const facts = overviewFacts(page);
  expect(facts.find((f) => f.label === "NGN price")?.value).toBe("Not set");
  expect(facts.find((f) => f.label === "USD price")?.value).toBe("Not set");
});

it("renders the formatted amount for a priced rail and 'Not set' for the unpriced rail", async () => {
  seed("Africa/Lagos", { priceNgnMinor: 45000000 });
  const page = await DetailPage({ params: Promise.resolve({ id: "cohort-1" }), searchParams: Promise.resolve({}) });
  const facts = overviewFacts(page);
  const ngnFact = facts.find((f) => f.label === "NGN price");
  expect(ngnFact?.value).not.toBe("Not set");
  expect(ngnFact?.value).toContain("450,000");
  expect(facts.find((f) => f.label === "USD price")?.value).toBe("Not set");
});

it("renders the USD price fact and leaves NGN 'Not set' for a USD-only cohort", async () => {
  seed("Africa/Lagos", { priceUsdMinor: 50000 });
  const page = await DetailPage({ params: Promise.resolve({ id: "cohort-1" }), searchParams: Promise.resolve({}) });
  const facts = overviewFacts(page);
  expect(facts.find((f) => f.label === "USD price")?.value).toBe(usd(500));
  expect(facts.find((f) => f.label === "NGN price")?.value).toBe("Not set");
});

it("wires two independent per-rail readiness items into the ReadinessPanel — one PASS, one FAIL, form validation never involved", async () => {
  seed("Africa/Lagos", { priceNgnMinor: 45000000 });
  mocks.evaluateReadiness.mockReturnValueOnce([
    { id: "price-ngn", category: "Price", label: "NGN price set (Paystack)", state: "PASS", blocking: true },
    { id: "price-usd", category: "Price", label: "USD price set (Stripe)", state: "FAIL", blocking: true },
  ]);
  const page = await DetailPage({ params: Promise.resolve({ id: "cohort-1" }), searchParams: Promise.resolve({}) });
  const items = readinessItemsProp(page);
  expect(items.find((i) => i.id === "price-ngn")).toMatchObject({ state: "PASS", label: "NGN price set (Paystack)" });
  expect(items.find((i) => i.id === "price-usd")).toMatchObject({ state: "FAIL", label: "USD price set (Stripe)" });
});

it("EditPage passes each stored dual-price rail (a null rail included) straight into the form's initial values", async () => {
  seed("Africa/Lagos", { priceNgnMinor: 45000000, priceUsdMinor: null });
  const page = await EditPage({ params: Promise.resolve({ id: "cohort-1" }) });
  const form = page.props.children[1];
  expect(form.props.values).toMatchObject({ priceNgnMinor: 45000000, priceUsdMinor: null });
});
