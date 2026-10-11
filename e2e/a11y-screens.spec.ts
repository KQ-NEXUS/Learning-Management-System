/**
 * Real-browser accessibility sweep (Phase 15, plan 15-19; D-13, NFR-09).
 *
 * For every screen and state in e2e/screens.manifest.ts, signs in as the
 * screen's persona, opens the page at 1440 by 900 and then 390 by 844, waits for
 * the page's main content, puts the page into the state (failed sign-in, a
 * rate-limit message, operations with failures, privacy after anonymisation...),
 * and runs axe with the five WCAG tags (wcag2a, wcag2aa, wcag21a, wcag21aa,
 * wcag22aa) plus the landmark rules. Unlike the jsdom helper in
 * tests/support/axe.ts, colour contrast and landmarks run here, because a real
 * browser has layout.
 *
 * The only findings that do not fail a screen are target-size findings on
 * inline links inside tables: ledger OQ10 defers them, and they are recorded as
 * waiver candidates in the evidence for a time-boxed D-07 waiver (not a security
 * item).
 *
 * Results: Playwright starts a fresh worker after any failed test, which would
 * lose anything held in memory. Each test therefore writes its own part file
 * (test-results/a11y-parts/<run id>/<screen>.json) and rewrites the combined
 * file at A11Y_OUT (default: the plan 15-19 evidence file) from all parts of the
 * run: screens, states, widths, every violation, the spike result and a log of
 * every visit.
 *
 * Environment: A11Y_ONLY=id,id limits the run to those screens (the file is
 * marked partial); A11Y_OUT overrides the output path.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { EXCLUDED_PAGES, SCREENS, WIDTHS, type Screen } from "./screens.manifest";
import { JOURNEY } from "./support/journey-fixtures";
import {
  AXE_TAGS,
  LANDMARK_RULES,
  contextFor,
  disconnectPrisma,
  ensurePendingOrder,
  formatFindings,
  prepareAction,
  resolveFixtures,
  runAxe,
  runTargetSizeSpike,
  settle,
  urlFor,
  type AxeFinding,
  type Fixtures,
  type SpikeResult,
} from "./support/a11y";

const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUT =
  ".planning/phases/15-launch-readiness-nfr-verification-operational-cutover/evidence/a11y-axe-local.json";
const OUT_PATH = path.resolve(REPO_ROOT, process.env.A11Y_OUT ?? DEFAULT_OUT);

// Set while the runner loads this file, so every worker it starts shares one run id.
process.env.A11Y_RUN_ID ??= Date.now().toString(36);
const PARTS_DIR = path.join(REPO_ROOT, "test-results", "a11y-parts", process.env.A11Y_RUN_ID);

const ONLY = (process.env.A11Y_ONLY ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const SELECTED: Screen[] = ONLY.length > 0 ? SCREENS.filter((screen) => ONLY.includes(screen.id)) : SCREENS;

type Violation = AxeFinding & { screen: string; state: string; width: number };
type Visit = { screen: string; state: string; width: number; path: string; status: number; heading: string };
type Part = { visits: Visit[]; violations: Violation[]; spike?: SpikeResult };

/** Writes this test's part and rewrites the combined evidence from every part of the run. */
function savePart(name: string, part: Part): void {
  mkdirSync(PARTS_DIR, { recursive: true });
  writeFileSync(path.join(PARTS_DIR, `${name}.json`), JSON.stringify(part), "utf8");

  const order = new Map(SCREENS.map((screen, index) => [screen.id, index]));
  const parts = readdirSync(PARTS_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => ({ name: file.replace(/\.json$/, ""), part: JSON.parse(readFileSync(path.join(PARTS_DIR, file), "utf8")) as Part }))
    .sort((a, b) => (order.get(a.name) ?? -1) - (order.get(b.name) ?? -1));

  const visits = parts.flatMap((p) => p.part.visits);
  const violations = parts.flatMap((p) => p.part.violations);
  const spike = parts.find((p) => p.part.spike)?.part.spike ?? null;
  const open = violations.filter((v) => !v.waiverCandidate);
  const file = {
    generatedAt: new Date().toISOString(),
    runId: process.env.A11Y_RUN_ID,
    partial: ONLY.length > 0,
    tags: AXE_TAGS,
    landmarkRules: LANDMARK_RULES,
    widths: WIDTHS.map((w) => w.width),
    screens: new Set(visits.map((v) => v.screen)).size,
    states: new Set(visits.map((v) => `${v.screen}/${v.state}`)).size,
    visits: visits.length,
    excludedPages: EXCLUDED_PAGES.length,
    openViolations: open.length,
    waiverCandidates: violations.length - open.length,
    spike,
    violations,
    visitLog: visits,
  };
  mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

let fixtures: Fixtures;

test.describe("axe sweep, WCAG 2.2 AA rules, real browser", () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== "chromium", "The sweep runs on Chromium; the other engines are covered by the journey.");
  });

  test.beforeAll(async ({ browser, baseURL }) => {
    test.setTimeout(180_000);
    fixtures = await resolveFixtures();
    if (SELECTED.some((screen) => Object.values(screen.params ?? {}).includes("pendingOrderId"))) {
      await ensurePendingOrder(browser, baseURL ?? "http://localhost:3010", fixtures, JOURNEY.courseSlug);
    }
  });

  test.afterAll(async () => {
    await disconnectPrisma();
  });

  test("spike: the wcag22aa tag selection flags a 10 pixel button (ledger A8)", async ({ page }) => {
    const spike = await runTargetSizeSpike(page);
    savePart("spike", { visits: [], violations: [], spike });
    expect(spike.flagged, "axe target-size must report the deliberately small buttons").toBe(true);
    expect(spike.contrastFlagged, "axe color-contrast must run in a real browser").toBe(true);
    expect(spike.landmarkFlagged, "axe landmark (region) rule must run").toBe(true);
  });

  for (const screen of SELECTED) {
    test(`${screen.id}: no axe violations in ${screen.states.length} state(s) at two widths`, async ({ browser, baseURL }) => {
      test.setTimeout(240_000);
      const origin = baseURL ?? "http://localhost:3010";
      const failures: string[] = [];
      const part: Part = { visits: [], violations: [] };

      try {
        for (const state of screen.states) {
          const persona = state.persona ?? screen.persona;
          const target = urlFor(screen, state, fixtures);
          const expectedPath = state.redirectsTo ?? target.split("?")[0];

          for (const size of WIDTHS) {
            const context = await contextFor(browser, origin, persona, size);
            const page = await context.newPage();
            const action = state.action ? await prepareAction(state.action, page, fixtures) : null;
            try {
              const response = await page.goto(target, { waitUntil: "domcontentloaded" });
              const status = response?.status() ?? 0;
              await settle(page);
              await action?.run();
              await settle(page);

              const finalPath = new URL(page.url()).pathname;
              const heading = ((await page.locator("h1").first().textContent({ timeout: 2_000 }).catch(() => null)) ?? "")
                .trim()
                .slice(0, 80);
              part.visits.push({ screen: screen.id, state: state.id, width: size.width, path: finalPath, status, heading });

              // A page that quietly fell back to its not-found or error page would pass axe and prove nothing.
              const headings = await page.locator("h1").allTextContents();
              const fellBack = headings.map((h) => h.trim()).find((h) => ["We can't find that page", "Something went wrong"].includes(h));
              if (fellBack && !state.expectNotFound) failures.push(`${state.id} @${size.width}: the page shows "${fellBack}" instead of the screen`);
              const wantedStatus = state.status ?? 200;
              if (status !== wantedStatus) failures.push(`${state.id} @${size.width}: HTTP ${status}, expected ${wantedStatus} for ${target}`);
              if (finalPath !== expectedPath) failures.push(`${state.id} @${size.width}: ended on ${finalPath}, expected ${expectedPath}`);

              const findings = await runAxe(page);
              for (const finding of findings) {
                part.violations.push({ screen: screen.id, state: state.id, width: size.width, ...finding });
              }
              const blocking = findings.filter((f) => !f.waiverCandidate);
              if (blocking.length > 0) failures.push(`${state.id} @${size.width}:\n${formatFindings(blocking)}`);
            } catch (error) {
              failures.push(`${state.id} @${size.width}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
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
