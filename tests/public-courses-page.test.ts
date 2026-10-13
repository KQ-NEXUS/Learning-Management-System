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
  it("states the value line and links to certificate verification", async () => {
    mocks.listPublicCourses.mockResolvedValue([course()]);
    const html = await renderPage();

    expect(html).toContain("Professional training an employer can verify.");
    expect(html).toMatch(/<a href="\/verify-certificate"[^>]*>Verify a certificate<\/a>/);
  });

  it("shows a View course label on every row, not only an arrow", async () => {
    mocks.listPublicCourses.mockResolvedValue([course(), course({ slug: "fire", title: "Fire Safety" })]);
    const html = await renderPage();

    expect(html.match(/View course/g)).toHaveLength(2);
  });

  it("explains a missing price instead of showing a lone dash", async () => {
    mocks.listPublicCourses.mockResolvedValue([course()]);
    const html = await renderPage();

    expect(html).toContain("Price shown with dates");
    expect(html).not.toContain(">—<");
  });

  it("shows the price when the next cohort has one", async () => {
    mocks.listPublicCourses.mockResolvedValue([
      course({
        nextCohort: {
          startsAt: new Date("2026-11-30T00:00:00Z"),
          hasStarted: false,
          deliveryMode: "in-person",
          priceNgnMinor: 45_000_000,
          priceUsdMinor: null,
        },
      }),
    ]);
    const html = await renderPage();

    expect(html).not.toContain("Price shown with dates");
    expect(html).toContain("450,000");
  });
});
