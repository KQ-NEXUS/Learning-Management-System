import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * `/learn` — "My learning" (`src/app/(learner)/learn/page.tsx`): every enrolment the signed-in
 * learner holds, in progress first, then completed. Invoked directly like the dashboard page
 * test; `next/link` is a plain `<a>` so hrefs are assertable.
 */

const { mocks } = vi.hoisted(() => ({
  mocks: {
    getCurrentActor: vi.fn(),
    loadLearnerDashboard: vi.fn(),
    redirect: vi.fn((url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    }),
  },
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode } & Record<string, unknown>) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("@/server/auth/current-actor", () => ({ getCurrentActor: mocks.getCurrentActor }));
vi.mock("@/server/services/enrolment-dashboard-service", () => ({
  loadLearnerDashboard: mocks.loadLearnerDashboard,
}));

import Page from "@/app/(learner)/learn/page";

function card(over: Record<string, unknown>) {
  return {
    enrolmentId: "enr-1",
    enrolmentStatus: "ACTIVE",
    cohortTitle: "Safety Leadership Programme — January 2026",
    progress: { requiredLessonsComplete: 4, requiredLessonsTotal: 10, structure: "structure" },
    ...over,
  };
}

async function render() {
  return renderToStaticMarkup(await Page());
}

describe("/learn (My learning)", () => {
  beforeEach(() => {
    mocks.getCurrentActor.mockReset().mockResolvedValue({ userId: "user-a", roles: [] });
    mocks.loadLearnerDashboard.mockReset();
    mocks.redirect.mockClear();
  });

  it("redirects an anonymous visitor to sign-in", async () => {
    mocks.getCurrentActor.mockResolvedValue(null);
    await expect(Page()).rejects.toThrow("NEXT_REDIRECT:/signin");
  });

  it("lists in-progress enrolments before completed ones, each linking to its course home", async () => {
    mocks.loadLearnerDashboard.mockResolvedValue({
      cards: [
        card({ enrolmentId: "enr-done", enrolmentStatus: "COMPLETED", cohortTitle: "Incident Investigation — Autumn" }),
        card({ enrolmentId: "enr-live" }),
      ],
    });
    const html = await render();

    expect(html).toContain("My learning");
    expect(html).toContain("Safety Leadership Programme — January 2026");
    expect(html).toContain("4 of 10 lessons");
    expect(html.indexOf("In progress")).toBeLessThan(html.indexOf("Completed"));
    expect(html).toContain('href="/learn/enr-live"');
    // A completed enrolment stays reachable from this page.
    expect(html).toContain('href="/learn/enr-done"');
  });

  it("points a learner with no enrolments at the catalogue", async () => {
    mocks.loadLearnerDashboard.mockResolvedValue({ cards: [] });
    const html = await render();

    expect(html).toContain("not enrolled on anything yet");
    expect(html).toContain('href="/courses"');
  });
});
