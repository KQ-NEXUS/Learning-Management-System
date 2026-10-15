import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * `/` — the IETC landing page. A signed-in person still goes straight home; a visitor sees
 * the next dated classes (soonest first, at most four, undated courses left out), the
 * course count, and a quiet line instead of an empty grid when nothing is dated.
 * Server Component invoked directly and rendered to markup, like `public-courses-page.test.ts`.
 */

const { mocks } = vi.hoisted(() => ({
  mocks: { listPublicCourses: vi.fn(), getCurrentActor: vi.fn(), redirect: vi.fn() },
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode } & Record<string, unknown>) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => createElement("img", { src, alt }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  redirect: (path: string) => {
    mocks.redirect(path);
    throw new Error(`NEXT_REDIRECT ${path}`);
  },
}));
vi.mock("@/server/auth/current-actor", () => ({ getCurrentActor: mocks.getCurrentActor }));
vi.mock("@/server/auth/landing", () => ({ landingPathFor: (actor: { isStaff: boolean }) => (actor.isStaff ? "/staff" : "/dashboard") }));
vi.mock("@/server/services/public-catalogue-service", () => ({ listPublicCourses: mocks.listPublicCourses }));
vi.mock("@/app/(checkout)/actions", () => ({ enrollAction: vi.fn() }));
vi.mock("@/components/site/SiteMenu", () => ({ SiteMenu: () => null }));
vi.mock("@/components/site/VerifyStrip", () => ({ VerifyStrip: () => null }));

import Landing from "@/app/page";
import { courseTint, startLabel } from "@/components/site/CourseCard";

const cohort = (startsAt: string, over: Record<string, unknown> = {}) => ({
  id: `c-${startsAt}`,
  startsAt: new Date(startsAt),
  hasStarted: false,
  deliveryMode: "BLENDED",
  priceNgnMinor: 35_000_000,
  priceUsdMinor: null,
  seatsAvailable: 5,
  ...over,
});
const course = (slug: string, nextCohort: unknown = null) => ({
  slug,
  title: `Course ${slug}`,
  summary: null,
  durationHours: 40,
  nextCohort,
});

beforeEach(() => {
  mocks.listPublicCourses.mockReset();
  mocks.getCurrentActor.mockReset().mockResolvedValue(null);
  mocks.redirect.mockReset();
});

describe("/ (landing)", () => {
  it("sends someone already signed in to their own home", async () => {
    mocks.getCurrentActor.mockResolvedValue({ isStaff: false });
    await expect(Landing()).rejects.toThrow("NEXT_REDIRECT /dashboard");
    expect(mocks.listPublicCourses).not.toHaveBeenCalled();
  });

  it("shows at most four dated classes, soonest first, and counts every course", async () => {
    mocks.listPublicCourses.mockResolvedValue([
      course("late", cohort("2026-12-07T09:00:00Z")),
      course("undated"),
      course("soon", cohort("2026-11-02T09:00:00Z")),
      course("mid", cohort("2026-11-16T09:00:00Z")),
      course("next", cohort("2026-11-09T09:00:00Z")),
      course("last", cohort("2027-01-11T09:00:00Z")),
    ]);
    const html = renderToStaticMarkup(await Landing());
    const order = ["soon", "next", "mid", "late"].map((slug) => html.indexOf(`/courses/${slug}"`));
    expect(order.every((at) => at > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).not.toContain('/courses/last"');
    expect(html).not.toContain('/courses/undated"');
    expect(html).toContain("All 6 courses");
    expect(html).toContain("₦350,000");
  });

  it("says dates are being set instead of drawing an empty grid", async () => {
    mocks.listPublicCourses.mockResolvedValue([course("undated")]);
    const html = renderToStaticMarkup(await Landing());
    expect(html).toContain("New class dates are being set.");
    expect(html).toContain("All 1 course");
  });
});

describe("course card labels and colour", () => {
  it("keeps one colour per course and the neutral tint when there are no dates", () => {
    expect(courseTint("iso-45001", true)).toBe(courseTint("iso-45001", true));
    expect(courseTint("iso-45001", false)).toBe("bg-tint-4");
  });

  it("names the start in Lagos time, or says enrolment is open, or that no dates exist", () => {
    // 23:30 UTC on 1 Nov is 00:30 on 2 Nov in Lagos.
    expect(startLabel(course("a", cohort("2026-11-01T23:30:00Z")) as never)).toBe("Starts 2 Nov");
    expect(startLabel(course("a", cohort("2026-10-01T09:00:00Z", { hasStarted: true })) as never)).toBe("Enrolling now");
    expect(startLabel(course("a") as never)).toBe("No dates yet");
  });
});
