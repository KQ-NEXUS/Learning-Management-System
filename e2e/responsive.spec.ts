/**
 * Responsive range and 200 percent zoom (Phase 15, plan 15-20; D-15, NFR-10).
 *
 * Tracer: the sign-in page with its failure message, at every viewport and at the
 * zoom size, must not scroll sideways. The alert wraps inside its box (S4/S5
 * messages at 320 pixels and 200 percent zoom).
 *
 * Sweep: every screen in e2e/screens.manifest.ts marked `primary`, in every state
 * the manifest lists for it (including the S5 rate-limit messages, the S4 failed
 * sign-in, the S1 operations states and the S2/S3 privacy lookup and record), at
 * each of the seven viewports and the 200 percent zoom size (640 by 360). Each
 * visit must keep the page from scrolling sideways, must not hide overflow, and
 * may scroll a wide block only inside an allow-listed, labelled, focusable region.
 *
 * Results: Playwright starts a new worker after any failed test, so each screen
 * writes its own part file (test-results/responsive-parts/<run id>/<screen>.json)
 * and the combined evidence file is rewritten from all parts after every screen.
 *
 * Environment: RESPONSIVE_ONLY=id,id limits the sweep to those screens (the
 * evidence is then marked partial); RESPONSIVE_OUT overrides the output path.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { SCREENS, type Screen } from "./screens.manifest";
import { JOURNEY } from "./support/journey-fixtures";
import {
  clearThrottles,
  contextFor,
  disconnectPrisma,
  ensureExportHistoryRow,
  ensurePendingOrder,
  getPrisma,
  prepareAction,
  resolveFixtures,
  settle,
  urlFor,
  type Fixtures,
} from "./support/a11y";
import {
  ALL_SIZES,
  VIEWPORTS,
  ZOOM_200,
  assertNoHorizontalScroll,
  checkHorizontalScroll,
  type OverflowReport,
  type ScrollAllowance,
} from "./support/viewports";

const STAMP = Date.now().toString(36);

/**
 * Blocks that may scroll sideways inside their own box instead of reflowing. Each has a reason, and the check
 * enforces what makes it usable by keyboard: a data table box must be role="region" with tabindex="0" and an
 * aria-label; a tab strip must be labelled, be a tablist or group and hold focusable tabs. A scrolling box that
 * is not on this list, or is on it but lacks those, fails the visit. The sweep records the list and where each
 * entry was seen in the evidence file.
 */
const SCROLL_ALLOW_LIST: ScrollAllowance[] = [
  // The five entries below were added when the staff screens with their own scrolling boxes joined the sweep
  // (launch checklist W-07). They come first: the first matching entry gives a box its reason.
  {
    selector: 'div[role="region"][aria-label="Audit log table"]',
    kind: "region",
    reason:
      "Audit log table (/staff/audit): the four columns (When, Who, Action, Target) hold a timestamp, an action name and a record identifier that each stay on one line, about 690 px in all, which is wider than the page column between 640 px and roughly 1040 px. There the table scrolls inside its own labelled, keyboard-focusable region. Below 640 px the same events are a stacked card list.",
  },
  {
    selector: 'div[role="region"][aria-label="Reconciliation cases table"]',
    kind: "region",
    reason:
      "Reconciliation case queue (/staff/reconciliation): eight columns (select, risk, case, learner and offer, provider, difference, owner, age) do not fit between 640 px and roughly 1100 px, so the table scrolls inside its own labelled, keyboard-focusable region. Below 640 px the same cases are a stacked card list.",
  },
  {
    selector: 'div[role="region"][aria-label="Export history table"]',
    kind: "region",
    reason:
      "Export history table (/staff/reports/exports): four fixed-width columns need 720 px, and around 1024 px the side navigation leaves the page column narrower than that, so there the table scrolls inside its own labelled, keyboard-focusable region. Below 768 px the same exports are a stacked card list.",
  },
  {
    selector: 'div[role="region"][aria-label="Scrollable matching rows"]',
    kind: "region",
    reason:
      "Matching rows of a report (/staff/reports/[dataset]): the columns are the dataset's export columns (eight or more) and each keeps its content on one line, so the table is wider than the page column at most sizes and scrolls inside its own labelled, keyboard-focusable region. Below 640 px the same rows are a stacked list.",
  },
  {
    selector: 'div[role="region"][aria-label="Released results"]',
    kind: "region",
    reason:
      "Released results of one learner (/staff/cohorts/[id]/learners/[enrolmentId]): five columns need 640 px. On a phone the page column is narrower than that, and from 1024 px the record layout gives 400 px to the side column, so the table scrolls inside its own labelled, keyboard-focusable region. This table has no stacked form.",
  },
  {
    selector: 'div[role="region"][aria-label$=" table"]',
    kind: "region",
    reason:
      "Wide data table (ResourceTable): its many columns cannot stack between 640 px and roughly 1300 px, so it scrolls inside its own labelled, keyboard-focusable region. Below 640 px the same rows are a stacked list.",
  },
  {
    selector: '[role="tablist"][aria-label="Record sections"]',
    kind: "tabs",
    reason:
      "Tab strip of a record (cohort detail): seven tabs do not fit a phone in one row. The strip scrolls inside itself and every tab is a focusable control, so the keyboard reaches each one; the tab strip pattern is locked by the record layout tests.",
  },
  {
    selector: '[role="tablist"][aria-label="Support queue"]',
    kind: "tabs",
    reason:
      "Tab strip of the support queue: the queue tabs do not fit a phone in one row. The strip scrolls inside itself and every tab is a focusable control (tests/components/support-workspace.test.tsx locks the scrolling strip).",
  },
  {
    selector: '[role="group"][aria-label]',
    kind: "tabs",
    reason:
      "Filter strips of a list (ResourceTable): the status tabs and the segmented choices (for example the cohort codes) do not fit a phone in one row. The strip is a labelled group that scrolls inside itself, and every choice is a focusable button.",
  },
];

const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUT =
  ".planning/phases/15-launch-readiness-nfr-verification-operational-cutover/evidence/responsive-local.json";
const OUT_PATH = path.resolve(REPO_ROOT, process.env.RESPONSIVE_OUT ?? DEFAULT_OUT);
// Set while the runner loads this file, so every worker it starts shares one run id.
process.env.RESPONSIVE_RUN_ID ??= Date.now().toString(36);
const PARTS_DIR = path.join(REPO_ROOT, "test-results", "responsive-parts", process.env.RESPONSIVE_RUN_ID);

const ONLY = (process.env.RESPONSIVE_ONLY ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const PRIMARY: Screen[] = SCREENS.filter((screen) => screen.primary && (ONLY.length === 0 || ONLY.includes(screen.id)));

type VisitResult = {
  screen: string;
  state: string;
  size: string;
  width: number;
  path: string;
  status: number;
  scrollWidth: number;
  clientWidth: number;
  scrollers: Array<{ element: string; allowedBy: string | null; role: string | null; tabIndex: number | null; ariaLabel: string | null }>;
  problems: string[];
};
type Part = { visits: VisitResult[] };

function toVisit(
  screen: string,
  state: string,
  size: { name: string; width: number },
  finalPath: string,
  status: number,
  report: OverflowReport | null,
  problems: string[],
): VisitResult {
  return {
    screen,
    state,
    size: size.name,
    width: size.width,
    path: finalPath,
    status,
    scrollWidth: report?.scrollWidth ?? 0,
    clientWidth: report?.clientWidth ?? 0,
    scrollers: (report?.scrollers ?? []).map(({ element, allowedBy, role, tabIndex, ariaLabel }) => ({
      element,
      allowedBy,
      role,
      tabIndex,
      ariaLabel,
    })),
    problems,
  };
}

/** Writes this screen's part and rewrites the combined evidence from every part of the run. */
function savePart(name: string, part: Part): void {
  mkdirSync(PARTS_DIR, { recursive: true });
  writeFileSync(path.join(PARTS_DIR, `${name}.json`), JSON.stringify(part), "utf8");

  const order = new Map(SCREENS.map((screen, index) => [screen.id, index]));
  const parts = readdirSync(PARTS_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => ({
      name: file.replace(/\.json$/, ""),
      part: JSON.parse(readFileSync(path.join(PARTS_DIR, file), "utf8")) as Part,
    }))
    .sort((a, b) => (order.get(a.name) ?? 9999) - (order.get(b.name) ?? 9999));
  const visits = parts.flatMap((p) => p.part.visits);
  const failing = visits.filter((visit) => visit.problems.length > 0);

  // Every allow-listed scroller seen in the run, with the reason it is allowed.
  const seen = new Map<string, Set<string>>();
  for (const visit of visits) {
    for (const scroller of visit.scrollers) {
      if (scroller.allowedBy === null) continue;
      const where = seen.get(scroller.allowedBy) ?? new Set<string>();
      where.add(`${visit.screen}/${visit.state}@${visit.size}`);
      seen.set(scroller.allowedBy, where);
    }
  }
  const allowList = SCROLL_ALLOW_LIST.map((allowance) => ({
    selector: allowance.selector,
    reason: allowance.reason,
    seenOn: [...(seen.get(allowance.reason) ?? [])],
  }));

  const file = {
    generatedAt: new Date().toISOString(),
    runId: process.env.RESPONSIVE_RUN_ID,
    partial: ONLY.length > 0,
    viewports: VIEWPORTS.map((v) => `${v.width}x${v.height}`),
    zoom200: `${ZOOM_200.width}x${ZOOM_200.height}`,
    screens: new Set(visits.map((v) => v.screen)).size,
    states: new Set(visits.map((v) => `${v.screen}/${v.state}`)).size,
    visits: visits.length,
    failures: failing.length,
    allowList,
    failureDetails: failing.map((v) => ({ screen: v.screen, state: v.state, size: v.size, problems: v.problems })),
    visitLog: visits,
  };
  mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

let fixtures: Fixtures;

test.describe("responsive range", () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== "chromium", "The sweeps run on Chromium; the other engines are covered by the journey.");
  });

  // A check that cannot fail proves nothing (threat T-15-20-02): each way a page can scroll sideways, or hide
  // that it does, must be reported by the helper, and a properly labelled allow-listed scroller must pass.
  test("control: the scroll check reports real overflow, hidden overflow and unlabelled scrollers", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    const wide = '<div style="width:600px;height:20px;background:#ccc">wide</div>';

    await page.setContent(`<!doctype html><html lang="en"><body><main>${wide}</main></body></html>`);
    const overflowing = await checkHorizontalScroll(page);
    expect(overflowing.problems.join("\n")).toContain("the page scrolls sideways");

    await page.setContent(`<!doctype html><html lang="en"><body style="overflow-x:hidden"><main>${wide}</main></body></html>`);
    const hiddenOnBody = await checkHorizontalScroll(page);
    expect(hiddenOnBody.problems.join("\n")).toContain("hide a sideways scroll");

    const longText = `<p style="white-space:nowrap;margin:0">${"word ".repeat(80)}</p>`;
    await page.setContent(`<!doctype html><html lang="en"><body><div style="overflow-x:hidden"><main>${longText}</main></div></body></html>`);
    const cutOff = await checkHorizontalScroll(page);
    expect(cutOff.report.documentScrolls).toBe(false);
    expect(cutOff.problems.join("\n")).toContain("content is cut off at the right");

    const scroller = (attributes: string) =>
      `<!doctype html><html lang="en"><body><main><div id="box" ${attributes} style="overflow-x:auto;width:200px">${wide}</div></main></body></html>`;
    await page.setContent(scroller(""));
    const unlisted = await checkHorizontalScroll(page);
    expect(unlisted.problems.join("\n")).toContain("not on the responsive allow-list");

    const allow = [{ selector: "#box", reason: "control: a wide block that scrolls inside its own labelled region" }];
    await page.setContent(scroller(""));
    const unlabelled = await checkHorizontalScroll(page, allow);
    expect(unlabelled.problems.join("\n")).toContain('lacks role="region", tabindex="0", an aria-label');

    await page.setContent(scroller('role="region" tabindex="0" aria-label="Wide block"'));
    const labelled = await checkHorizontalScroll(page, allow);
    expect(labelled.problems).toEqual([]);

    await expect(checkHorizontalScroll(page, [{ selector: "#box", reason: " " }])).rejects.toThrow("has no reason");

    // A tab strip: allowed only when labelled, a tablist or group, and holding focusable tabs.
    const strip = (attributes: string, inner: string) =>
      `<!doctype html><html lang="en"><body><main><div id="strip" ${attributes} style="display:flex;gap:32px;overflow-x:auto;width:200px">${inner}</div></main></body></html>`;
    const tabs = Array.from({ length: 8 }, (_, i) => `<button type="button" style="flex-shrink:0;white-space:nowrap">Section number ${i}</button>`).join("");
    const tabsAllow = [{ selector: "#strip", kind: "tabs" as const, reason: "control: a tab strip" }];
    await page.setContent(strip('role="tablist" aria-label="Sections"', tabs));
    expect((await checkHorizontalScroll(page, tabsAllow)).problems).toEqual([]);
    await page.setContent(strip("", tabs));
    expect((await checkHorizontalScroll(page, tabsAllow)).problems.join("; ")).toContain('role="tablist" or role="group", an aria-label');
    await page.setContent(strip('role="tablist" aria-label="Sections"', Array.from({ length: 8 }, (_, i) => `<span style="flex-shrink:0;white-space:nowrap">Section number ${i}</span>`).join("")));
    expect((await checkHorizontalScroll(page, tabsAllow)).problems.join("; ")).toContain("a focusable control inside");
  });

  test.describe("sign-in failure state", () => {
    for (const size of ALL_SIZES) {
      test(`sign-in message wraps with no sideways scroll at ${size.name}`, async ({ browser, baseURL }) => {
        const context = await browser.newContext({
          baseURL,
          viewport: { width: size.width, height: size.height },
          reducedMotion: "reduce",
          colorScheme: "light",
        });
        try {
          const page = await context.newPage();
          await page.goto("/signin", { waitUntil: "domcontentloaded" });
          await page.getByLabel("Email address").waitFor({ state: "visible", timeout: 30_000 });
          await assertNoHorizontalScroll(page, [], `sign-in (empty) at ${size.name}`);

          // A different unknown address for each size: a repeated address would trip the per-address limit.
          await page.getByLabel("Email address").fill(`nobody-${size.width}-${STAMP}@a11y.test`);
          await page.locator('input[name="password"]').fill("Wrong-password-1");
          await page.getByRole("button", { name: "Sign in" }).click();
          const alert = page.getByRole("alert").filter({ hasText: "Those details do not match an account" }).first();
          await alert.waitFor({ state: "visible", timeout: 30_000 });

          await assertNoHorizontalScroll(page, [], `sign-in failure message at ${size.name}`);
        } finally {
          await context.close();
        }
      });
    }
  });

  // -------------------------------------------------------------------------
  // The sweep over every primary screen
  // -------------------------------------------------------------------------

  test.describe("every primary screen", () => {
    test.beforeAll(async ({ browser, baseURL }) => {
      test.setTimeout(180_000);
      if (PRIMARY.length === 0) return;
      fixtures = await resolveFixtures();
      // The export history table is drawn only when the signed-in person has an export; a seeded database has none.
      if (PRIMARY.some((screen) => screen.id === "staff-report-exports")) await ensureExportHistoryRow();
      if (PRIMARY.some((screen) => Object.values(screen.params ?? {}).includes("pendingOrderId"))) {
        await ensurePendingOrder(browser, baseURL ?? "http://localhost:3010", fixtures, JOURNEY.courseSlug);
      }
    });

    test.afterAll(async () => {
      await disconnectPrisma();
    });

    // The manifest's lesson screen is the first lesson of the course (a reading). The two assessment lessons
    // the learner can open (a quiz and an assignment) are the same page with other content, so they are
    // swept here as well, by looking them up for the learner's own enrolment.
    test(`lesson (quiz and assignment): no sideways scroll at ${ALL_SIZES.length} sizes`, async ({ browser, baseURL }) => {
      test.setTimeout(300_000);
      test.skip(ONLY.length > 0 && !ONLY.includes("lesson-assessments"), "limited by RESPONSIVE_ONLY");
      const origin = baseURL ?? "http://localhost:3010";
      const prisma = await getPrisma();
      const enrolment = await prisma.enrolment.findUnique({ where: { id: fixtures.ownEnrolmentId }, select: { cohortId: true } });
      const cohortCourses = await prisma.cohortCourse.findMany({ where: { cohortId: enrolment?.cohortId ?? "" }, select: { courseId: true } });
      const lessons = await prisma.lesson.findMany({
        where: { type: { in: ["QUIZ", "ASSIGNMENT"] }, module: { courseId: { in: cohortCourses.map((row) => row.courseId) } } },
        select: { id: true, type: true },
        orderBy: [{ type: "asc" }, { position: "asc" }],
      });
      expect(lessons.length, "the learner's course has a quiz and an assignment lesson").toBeGreaterThanOrEqual(2);

      const failures: string[] = [];
      const part: Part = { visits: [] };
      try {
        for (const lesson of lessons) {
          const stateId = lesson.type.toLowerCase();
          const route = `/learn/${fixtures.ownEnrolmentId}/lessons/${lesson.id}`;
          for (const size of ALL_SIZES) {
            const context = await contextFor(browser, origin, "learner", size);
            const page = await context.newPage();
            try {
              const response = await page.goto(route, { waitUntil: "domcontentloaded" });
              const status = response?.status() ?? 0;
              await settle(page);
              const finalPath = new URL(page.url()).pathname;
              const problems: string[] = [];
              const headings = await page.locator("h1").allTextContents();
              const fellBack = headings.map((h) => h.trim()).find((h) => ["We can't find that page", "Something went wrong"].includes(h));
              if (fellBack) problems.push(`the page shows "${fellBack}" instead of the screen`);
              if (status !== 200) problems.push(`HTTP ${status}, expected 200`);
              if (finalPath !== route) problems.push(`ended on ${finalPath}, expected ${route}`);
              const check = await checkHorizontalScroll(page, SCROLL_ALLOW_LIST);
              problems.push(...check.problems);
              part.visits.push(toVisit("lesson-assessments", stateId, size, finalPath, status, check.report, problems));
              for (const problem of problems) failures.push(`${stateId} @${size.name}: ${problem}`);
            } catch (error) {
              const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
              part.visits.push(toVisit("lesson-assessments", stateId, size, "", 0, null, [message]));
              failures.push(`${stateId} @${size.name}: ${message}`);
            } finally {
              await context.close();
            }
          }
        }
      } finally {
        savePart("lesson-assessments", part);
      }
      expect(failures, failures.join("\n")).toEqual([]);
    });

    for (const screen of PRIMARY) {
      test(`${screen.id}: no sideways scroll in ${screen.states.length} state(s) at ${ALL_SIZES.length} sizes`, async ({
        browser,
        baseURL,
      }) => {
        test.setTimeout(600_000);
        const origin = baseURL ?? "http://localhost:3010";
        const failures: string[] = [];
        const part: Part = { visits: [] };

        try {
          for (const state of screen.states) {
            const persona = state.persona ?? screen.persona;
            const target = urlFor(screen, state, fixtures);
            const expectedPath = state.redirectsTo ?? target.split("?")[0];

            for (const size of ALL_SIZES) {
              const context = await contextFor(browser, origin, persona, size);
              const page = await context.newPage();
              // The failed sign-in state always uses one unknown address, and five failures lock it for a
              // while; clear that counter so every size meets the failure message, not the lock message.
              if (screen.id === "signin") await clearThrottles(["email:nobody@a11y.test"]);
              const action = state.action ? await prepareAction(state.action, page, fixtures) : null;
              try {
                const response = await page.goto(target, { waitUntil: "domcontentloaded" });
                const status = response?.status() ?? 0;
                await settle(page);
                await action?.run();
                await settle(page);

                const finalPath = new URL(page.url()).pathname;
                const problems: string[] = [];
                const headings = await page.locator("h1").allTextContents();
                const fellBack = headings
                  .map((h) => h.trim())
                  .find((h) => ["We can't find that page", "Something went wrong"].includes(h));
                if (fellBack && !state.expectNotFound) problems.push(`the page shows "${fellBack}" instead of the screen`);
                if (status !== (state.status ?? 200)) problems.push(`HTTP ${status}, expected ${state.status ?? 200}`);
                if (finalPath !== expectedPath) problems.push(`ended on ${finalPath}, expected ${expectedPath}`);

                const check = await checkHorizontalScroll(page, SCROLL_ALLOW_LIST);
                problems.push(...check.problems);
                part.visits.push(toVisit(screen.id, state.id, size, finalPath, status, check.report, problems));
                for (const problem of problems) failures.push(`${state.id} @${size.name}: ${problem}`);
              } catch (error) {
                const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
                part.visits.push(toVisit(screen.id, state.id, size, "", 0, null, [message]));
                failures.push(`${state.id} @${size.name}: ${message}`);
              } finally {
                await action?.cleanup();
                await context.close();
              }
            }
          }
        } finally {
          savePart(screen.id, part);
        }

        expect(failures, `${screen.id}\n${failures.join("\n")}`).toEqual([]);
      });
    }
  });
});
