import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * `/courses` rows: a visible "View course" label at every width, a words-not-a-dash
 * price for courses with no dates yet, and the verify-a-certificate value line.
 * Server Component invoked directly and rendered to markup, like `learner-dashboard-page.test.ts`.
 */

const { mocks } = vi.hoisted(() => ({ mocks: { listPublicCourses: vi.fn() } }));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode } & Record<string, unknown>) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("@/server/services/public-catalogue-service", () => ({ listPublicCourses: mocks.listPublicCourses }));
vi.mock("@/app/(public)/CheckoutNotice", () => ({ CheckoutNotice: () => null }));

import Page from "@/app/(public)/courses/page";

async function renderPage() {
  const element = await Page({ searchParams: Promise.resolve({}) });
  return renderToStaticMarkup(element);
}

const course = (over: Record<string, unknown> = {}) => ({
  slug: "safety",
  title: "Workplace Safety",
  summary: "Practical safety training.",
  durationHours: 12,
  nextCohort: null,
  ...over,
});

beforeEach(() => mocks.listPublicCourses.mockReset());

describe("/courses", () => {
  it("closes the list with IETC's company certification, which is not a class", async () => {
    mocks.listPublicCourses.mockResolvedValue([course()]);
    const html = await renderPage();

    expect(html).toContain("IETC Company Certification");
    expect(html).toContain("This is not a class.");
  });

  it("makes every course a card linking to its own page, with the course count", async () => {
    mocks.listPublicCourses.mockResolvedValue([course(), course({ slug: "fire", title: "Fire Safety" })]);
    const html = await renderPage();

    expect(html).toContain('href="/courses/safety"');
    expect(html).toContain('href="/courses/fire"');
    expect(html).toContain("2 courses");
  });

  it("explains a missing price in words instead of showing a lone dash", async () => {
    mocks.listPublicCourses.mockResolvedValue([course()]);
    const html = await renderPage();

    expect(html).toContain("Price to be announced");
    expect(html).toContain("No dates yet");
    expect(html).not.toContain(">—<");
  });

  it("shows the price when the next cohort has one", async () => {
    mocks.listPublicCourses.mockResolvedValue([
      course({
        nextCohort: {
          startsAt: new Date("2026-11-30T00:00:00Z"),
          hasStarted: false,
          deliveryMode: "INSTRUCTOR_LED",
          priceNgnMinor: 45_000_000,
          priceUsdMinor: null,
        },
      }),
    ]);
    const html = await renderPage();

    expect(html).not.toContain("Price to be announced");
    expect(html).toContain("450,000");
  });
});
