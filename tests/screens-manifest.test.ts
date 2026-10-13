import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXCLUDED_PAGES,
  FIXTURE_KEYS,
  SCREENS,
  STATE_ACTION_IDS,
  manifestProblems,
  routeTemplateFor,
  type ExcludedPage,
  type Screen,
} from "../e2e/screens.manifest";

// Completeness guard for the accessibility and responsive sweeps (Phase 15,
// plan 15-19; D-13, NFR-09). Every `page.tsx` under src/app must be a screen in
// e2e/screens.manifest.ts or carry a written reason for being left out, so a new
// page cannot ship without the sweeps knowing about it. The negative cases run
// the same pure checker over tampered in-memory copies.

const APP_DIR = join(process.cwd(), "src", "app");

function pageFiles(): string[] {
  return (readdirSync(APP_DIR, { recursive: true }) as string[])
    .map((file) => file.replace(/\\/g, "/"))
    .filter((file) => file === "page.tsx" || file.endsWith("/page.tsx"))
    .sort();
}

describe("screens manifest completeness (D-13)", () => {
  const pages = pageFiles();

  it("finds the application's pages", () => {
    expect(pages.length).toBeGreaterThan(70);
    expect(pages).toContain("(auth)/signin/page.tsx");
    expect(pages).toContain("staff/operations/page.tsx");
    expect(pages).toContain("staff/privacy/[userId]/page.tsx");
  });

  it("lists every page.tsx as a screen or an excluded page, and nothing else", () => {
    expect(manifestProblems(pages, SCREENS, EXCLUDED_PAGES)).toEqual([]);
  });

  it("derives route templates the way the App Router does (route groups are not part of the URL)", () => {
    expect(routeTemplateFor("page.tsx")).toBe("/");
    expect(routeTemplateFor("(auth)/signin/page.tsx")).toBe("/signin");
    expect(routeTemplateFor("(learner)/learn/[enrolmentId]/results/page.tsx")).toBe("/learn/[enrolmentId]/results");
    expect(routeTemplateFor("staff\\cohorts\\[id]\\page.tsx")).toBe("/staff/cohorts/[id]");
  });

  it("covers at least 30 screens and every one is signed in as a persona the sweep can create", () => {
    expect(SCREENS.length).toBeGreaterThanOrEqual(30);
    const personas = new Set(SCREENS.map((screen) => screen.persona));
    for (const persona of personas) {
      expect(["anonymous", "learner", "admin", "finance", "instructor", "pm"]).toContain(persona);
    }
  });

  it("gives every excluded page a written reason", () => {
    for (const excluded of EXCLUDED_PAGES) {
      expect(excluded.reason.trim().length, excluded.page).toBeGreaterThan(15);
    }
  });

  it("includes the key states the contract names", () => {
    const states = new Set(SCREENS.flatMap((screen) => screen.states.map((state) => `${screen.id}/${state.id}`)));
    for (const required of [
      "signin/failed",
      "signin/throttled",
      "register/limited",
      "forgot-password/limited",
      "verify/resend-limited",
      "verify-certificate-ref/limited",
      "support-new/limited",
      "staff-operations/all-clear",
      "staff-operations/with-failures",
      "staff-privacy-record/before",
      "staff-privacy-record/after",
      "staff-courses-new/empty",
    ]) {
      expect(states.has(required), required).toBe(true);
    }
  });

  it("only names actions and fixtures the sweep implements", () => {
    for (const screen of SCREENS) {
      for (const state of screen.states) {
        if (state.action) expect(STATE_ACTION_IDS, `${screen.id}/${state.id}`).toContain(state.action);
      }
      for (const source of Object.values(screen.params ?? {})) {
        if (!source.startsWith("=")) expect(FIXTURE_KEYS, screen.id).toContain(source);
      }
    }
  });
});

describe("the checker catches regressions in an in-memory copy", () => {
  const pages = pageFiles();

  it("fails, naming the page, when a new page.tsx has neither a screen nor an exclusion", () => {
    const problems = manifestProblems([...pages, "staff/brand-new/page.tsx"], SCREENS, EXCLUDED_PAGES);
    expect(problems.join("\n")).toContain("staff/brand-new/page.tsx");
  });

  it("fails when a screen's page no longer exists", () => {
    const problems = manifestProblems(
      pages.filter((page) => page !== "staff/operations/page.tsx"),
      SCREENS,
      EXCLUDED_PAGES,
    );
    expect(problems.join("\n")).toContain("staff/operations/page.tsx");
  });

  it("fails when an excluded page has no reason or is also a screen", () => {
    const blank: ExcludedPage[] = [{ page: "(auth)/signin/page.tsx", reason: " " }];
    const withoutSignin = SCREENS.filter((screen) => screen.page !== "(auth)/signin/page.tsx");
    expect(manifestProblems(pages, withoutSignin, blank).join("\n")).toContain("reason");
    const both: ExcludedPage[] = [{ page: "(auth)/signin/page.tsx", reason: "Left out on purpose for this test only." }];
    expect(manifestProblems(pages, SCREENS, both).join("\n")).toContain("both");
  });

  it("fails when a route template does not match its page or a parameter has no fixture", () => {
    const wrongRoute: Screen[] = SCREENS.map((screen) =>
      screen.id === "signin" ? { ...screen, route: "/sign-in" } : screen,
    );
    expect(manifestProblems(pages, wrongRoute, EXCLUDED_PAGES).join("\n")).toContain("/sign-in");

    const noParams: Screen[] = SCREENS.map((screen) =>
      screen.route.includes("[") ? { ...screen, params: {} } : screen,
    );
    expect(manifestProblems(pages, noParams, EXCLUDED_PAGES).join("\n")).toContain("parameter");
  });
});
