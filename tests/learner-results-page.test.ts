import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * `/learn/[enrolmentId]/results` (`src/app/(learner)/learn/[enrolmentId]/results/page.tsx`,
 * ASM-07, plan 10-15).
 *
 * Graded like `tests/learner-lesson-list-page.test.ts` /
 * `tests/learner-dashboard-page.test.ts`: the page is a Server Component
 * with a dynamic-route `params` promise, invoked directly, then rendered to
 * a markup string via `react-dom/server`'s `renderToStaticMarkup` (no jsdom
 * needed — this file runs under Vitest's "node" project) so assertions can
 * inspect real rendered HTML, including anything nested inside an
 * attribute, not just a visible text node.
 */

const NOT_FOUND = "notFound";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    getCurrentActor: vi.fn(),
    loadLearnerPath: vi.fn(),
    getOwnResults: vi.fn(),
    redirect: vi.fn((url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    }),
    notFound: vi.fn(() => {
      throw new Error(NOT_FOUND);
    }),
  },
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: mocks.notFound }));
vi.mock("@/server/auth/current-actor", () => ({ getCurrentActor: mocks.getCurrentActor }));
vi.mock("@/server/services/learner-access", () => ({ loadLearnerPath: mocks.loadLearnerPath }));
vi.mock("@/server/services/learner-results-service", () => ({ getOwnResults: mocks.getOwnResults }));

import Page from "@/app/(learner)/learn/[enrolmentId]/results/page";

type Over = Record<string, unknown>;

const ACTOR = { userId: "user-a", roles: [] };

function pathFixture(over: Over = {}) {
  return {
    enrolment: { id: "enrolment-1" },
    courses: [],
    progress: new Set<string>(),
    sequencing: [],
    ...over,
  };
}

function resultCard(over: Over = {}) {
  return {
    assessmentId: "assessment-1",
    title: "Module Quiz",
    type: "QUIZ",
    effectiveScore: 8,
    maxScore: 10,
    passed: true,
    passMark: 6,
    feedback: null,
    attemptsRemaining: null,
    history: [
      { kind: "attempt", ref: "attempt-1", number: 1, at: new Date("2026-09-01T10:00:00.000Z"), status: "SUBMITTED", score: 8 },
    ],
    overrides: [],
    ...over,
  };
}

function pageParams(enrolmentId = "enrolment-1") {
  return { params: Promise.resolve({ enrolmentId }) };
}

const run = (enrolmentId?: string) => Page(pageParams(enrolmentId));
const renderPage = async (enrolmentId?: string) => renderToStaticMarkup((await run(enrolmentId)) as never);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  });
  mocks.notFound.mockImplementation(() => {
    throw new Error(NOT_FOUND);
  });
  mocks.getCurrentActor.mockResolvedValue(ACTOR);
  mocks.loadLearnerPath.mockResolvedValue(pathFixture());
  mocks.getOwnResults.mockResolvedValue([]);
});

describe("/learn/[enrolmentId]/results", () => {
  it("redirects a signed-out visitor to sign-in instead of rendering", async () => {
    mocks.getCurrentActor.mockResolvedValue(null);

    await expect(run()).rejects.toThrow("NEXT_REDIRECT:/signin");
    expect(mocks.loadLearnerPath).not.toHaveBeenCalled();
  });

  it("calls notFound() for a stranger's enrolment id (the existing ownership check)", async () => {
    mocks.loadLearnerPath.mockResolvedValue(null);

    await expect(run()).rejects.toThrow(NOT_FOUND);
    expect(mocks.notFound).toHaveBeenCalled();
    expect(mocks.getOwnResults).not.toHaveBeenCalled();
  });

  it("renders the §6 empty state when the service returns an empty array", async () => {
    mocks.getOwnResults.mockResolvedValue([]);

    const html = await renderPage();

    expect(html).toContain("Your results");
    expect(html).toContain("No results yet");
    expect(html).toContain("Complete a quiz or submit an assignment to see your results here.");
  });

  it("renders a card per released result, in the order the service returned them", async () => {
    mocks.getOwnResults.mockResolvedValue([
      resultCard({ assessmentId: "a-1", title: "First Quiz" }),
      resultCard({ assessmentId: "a-2", title: "Second Assignment", type: "ASSIGNMENT" }),
    ]);

    const html = await renderPage();

    const firstIndex = html.indexOf("First Quiz");
    const secondIndex = html.indexOf("Second Assignment");
    expect(firstIndex).toBeGreaterThan(-1);
    expect(secondIndex).toBeGreaterThan(firstIndex);
  });

  it("renders no trace of a draft-backed assessment the service never returned", async () => {
    // Only the released assessment is ever handed to the page — exactly what
    // the real `getOwnResults` guarantees (T-10-04: RELEASED filtered at the
    // database). "Unreleased Assignment" stands in for a draft-backed
    // assessment that must never reach this component; asserting its title
    // is absent from the FULL serialised markup (not just a visible
    // fragment) catches a leak nested in an attribute too, not only a
    // rendered text node.
    mocks.getOwnResults.mockResolvedValue([resultCard({ assessmentId: "a-released", title: "Released Quiz" })]);

    const html = await renderPage();

    expect(html).toContain("Released Quiz");
    expect(html).not.toContain("Unreleased Assignment");
    expect(html).not.toContain("DRAFT");
    expect(html).not.toContain("Draft");
  });

  it("renders the unmet-pass copy with the remaining-attempt count", async () => {
    mocks.getOwnResults.mockResolvedValue([
      resultCard({ passed: false, attemptsRemaining: 2, title: "Retry Quiz" }),
    ]);

    const html = await renderPage();

    expect(html).toContain("You haven&#x27;t yet passed Retry Quiz. 2 attempt(s) remaining.");
    expect(html).toContain("Not yet passed");
  });

  it("switches to the used-all-attempts copy when attemptsRemaining is 0", async () => {
    mocks.getOwnResults.mockResolvedValue([
      resultCard({ passed: false, attemptsRemaining: 0, title: "Exhausted Quiz" }),
    ]);

    const html = await renderPage();

    expect(html).toContain("You&#x27;ve used all your attempts for Exhausted Quiz.");
    expect(html).not.toContain("attempt(s) remaining");
  });

  it("renders neither unmet-pass variant for an already-passed assessment", async () => {
    mocks.getOwnResults.mockResolvedValue([
      resultCard({ passed: true, attemptsRemaining: 0, title: "Passed Quiz" }),
    ]);

    const html = await renderPage();

    expect(html).not.toContain("attempt(s) remaining");
    expect(html).not.toContain("used all your attempts");
  });

  it("renders an override row with its previous and new scores", async () => {
    mocks.getOwnResults.mockResolvedValue([
      resultCard({
        overrides: [
          {
            previousScore: 5,
            newScore: 8,
            reason: "Rechecked working",
            actorName: "Jordan Lee",
            at: new Date("2026-09-05T09:00:00.000Z"),
          },
        ],
      }),
    ]);

    const html = await renderPage();

    expect(html).toContain("Overridden from 5 to 8 by Jordan Lee");
    expect(html).toContain("Rechecked working");
  });
});
