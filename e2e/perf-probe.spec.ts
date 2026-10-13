/**
 * Time-to-usable probe (Phase 15, plan 15-18; D-03, NFR-02, ledger OQ3).
 *
 * k6 (plan 15-14) gives server timings and the error rate under load. NFR-02 is
 * about usable primary content in a browser, so this spec times, per core view,
 * from the start of navigation to the moment the page's own `[data-primary-content]`
 * wrapper is visible (`performance.now()` inside the page, which counts from
 * navigation start). The navigation waits for `commit` only, so nothing is hidden
 * by waiting for the load event.
 *
 * Method, fixed before any loaded or signed run:
 * - Chromium only, with network emulation matching Chrome DevTools "Regular 4G"
 *   (4 Mbps down, 3 Mbps up, 20 ms latency) applied through a CDP session.
 * - PROBE_SAMPLES samples per view (default 30), counting the first one. The
 *   first sample of each view runs in a fresh browser context with an empty cache
 *   and is reported separately as "cold"; the rest are "warm". p50, p75 and p95 are
 *   nearest-rank percentiles (e2e/support/percentiles.ts) over the warm samples.
 * - The view order is shuffled for each run (PROBE_SEED fixes it); the order
 *   actually run is recorded. All samples of one view are the same request, so
 *   there is no order to randomise inside a view.
 * - A view fails when its warm p75 exceeds 2500 ms. The threshold is not settable.
 * - Largest Contentful Paint is recorded as supporting data only.
 *
 * Which numbers count: the signed NFR-02 p75 comes only from the staging run under
 * 150 learners and 10 staff of load (plan 15-30). A run on a laptop with no load
 * (plan 15-18) or with laptop load (plan 15-28) is relative evidence only.
 *
 * Sessions: the seeded load accounts from plan 15-14. The raw session tokens are
 * read from the gitignored perf/results/tokens.json (override with PROBE_TOKENS),
 * set as the lms.session cookie on the browser context, and never printed.
 *
 * Environment: PROBE_SAMPLES (default 30), PROBE_OUT (default perf/results/probe.json),
 * PROBE_TOKENS, PROBE_SEED, E2E_BASE_URL (through the Playwright config).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { percentiles } from "./support/percentiles";

const SESSION_COOKIE = "lms.session";

/** NFR-02: p75 of usable primary content under 2.5 s. */
const P75_BUDGET_MS = 2500;

/** Chrome DevTools "Regular 4G": 4 Mbps down, 3 Mbps up, 20 ms round-trip latency. */
const NETWORK_PROFILE = {
  name: "Regular 4G",
  downloadMbps: 4,
  uploadMbps: 3,
  latencyMs: 20,
} as const;

const REPO_ROOT = path.resolve(__dirname, "..");

const SAMPLES = (() => {
  const raw = Number(process.env.PROBE_SAMPLES ?? 30);
  if (!Number.isInteger(raw) || raw < 2) {
    throw new Error("PROBE_SAMPLES must be a whole number of at least 2 (one cold sample plus warm samples).");
  }
  return raw;
})();

const OUT_PATH = path.resolve(REPO_ROOT, process.env.PROBE_OUT ?? "perf/results/probe.json");
const TOKENS_PATH = path.resolve(REPO_ROOT, process.env.PROBE_TOKENS ?? "perf/results/tokens.json");

// Set before the worker starts so the runner and the worker shuffle the same way.
process.env.PROBE_SEED ??= String(Math.floor(Math.random() * 2 ** 31));
const SEED = Number(process.env.PROBE_SEED);

type Tokens = {
  learners: string[];
  staff: string[];
  learnerContext: { enrolmentId: string; lessonIds: string[] }[];
  ids: { cohortId?: string; assessmentId?: string };
};

type Persona = "learner" | "staff";

type ProbeView = {
  name: string;
  persona: Persona;
  /** Builds the path from the seeded ids. Throws a plain message when an id is missing. */
  path: (tokens: Tokens) => string;
};

function learnerContext(tokens: Tokens) {
  const context = tokens.learnerContext?.[0];
  if (!context?.enrolmentId) throw new Error("The tokens file has no learner enrolment. Run scripts/load/seed-load.ts first.");
  return context;
}

function staffIds(tokens: Tokens) {
  const { cohortId, assessmentId } = tokens.ids ?? {};
  if (!cohortId || !assessmentId) {
    throw new Error("The tokens file has no cohort or assignment id. Run scripts/load/seed-load.ts first.");
  }
  return { cohortId, assessmentId };
}

/** The thirteen core views, named like the k6 page tags in perf/lib/config.js. */
const VIEWS: ProbeView[] = [
  { name: "dashboard", persona: "learner", path: () => "/dashboard" },
  { name: "learn", persona: "learner", path: () => "/learn" },
  { name: "course-home", persona: "learner", path: (t) => `/learn/${learnerContext(t).enrolmentId}` },
  {
    name: "lesson",
    persona: "learner",
    path: (t) => {
      const context = learnerContext(t);
      if (!context.lessonIds?.[0]) throw new Error("The tokens file has no lesson id. Run scripts/load/seed-load.ts first.");
      return `/learn/${context.enrolmentId}/lessons/${context.lessonIds[0]}`;
    },
  },
  { name: "results", persona: "learner", path: (t) => `/learn/${learnerContext(t).enrolmentId}/results` },
  { name: "sessions", persona: "learner", path: (t) => `/learn/${learnerContext(t).enrolmentId}/sessions` },
  { name: "support", persona: "learner", path: () => "/support" },
  { name: "staff-overview", persona: "staff", path: () => "/staff" },
  { name: "staff-cohorts", persona: "staff", path: () => "/staff/cohorts" },
  { name: "staff-cohort", persona: "staff", path: (t) => `/staff/cohorts/${staffIds(t).cohortId}` },
  {
    name: "staff-grading",
    persona: "staff",
    path: (t) => {
      const { cohortId, assessmentId } = staffIds(t);
      return `/staff/cohorts/${cohortId}/grading/${assessmentId}`;
    },
  },
  { name: "staff-support", persona: "staff", path: () => "/staff/support" },
  { name: "staff-payments", persona: "staff", path: () => "/staff/payments" },
];

/** Small seeded generator so a run's view order can be repeated. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const random = mulberry32(seed);
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function loadTokens(): Tokens {
  let parsed: Tokens;
  try {
    parsed = JSON.parse(readFileSync(TOKENS_PATH, "utf8")) as Tokens;
  } catch {
    throw new Error(
      `Cannot read the session tokens file (${path.relative(REPO_ROOT, TOKENS_PATH)}). Run scripts/load/seed-load.ts against the local database first.`,
    );
  }
  if (!parsed.learners?.length || !parsed.staff?.length) {
    throw new Error("The tokens file has no learners or staff. Run scripts/load/seed-load.ts first.");
  }
  return parsed;
}

/**
 * Runs in the page before any of its scripts, on every navigation. It records
 * the first moment the primary wrapper has a real box and is not hidden, and
 * the latest largest-contentful-paint time as supporting data.
 */
function installProbeHooks(): void {
  const w = window as unknown as Record<string, number | undefined>;
  const check = () => {
    if (w.__primaryAt !== undefined) return;
    const el = document.querySelector("[data-primary-content]");
    if (el) {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none") {
        w.__primaryAt = performance.now();
        return;
      }
    }
    requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.__lcp = entry.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch {
    // LCP is supporting data only; a browser without it still gives the primary time.
  }
}

async function newProbeContext(browser: Browser, baseURL: string, token: string): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL });
  const secure = baseURL.startsWith("https:");
  await context.addCookies([
    { name: SESSION_COOKIE, value: token, url: baseURL, httpOnly: true, secure, sameSite: "Lax" },
  ]);
  await context.addInitScript(installProbeHooks);
  return context;
}

type ViewResult = {
  name: string;
  persona: Persona;
  path: string;
  runOrder: number;
  samples: number;
  warmSamples: number;
  coldMs: number;
  p50: number;
  p75: number;
  p95: number;
  budgetMs: number;
  withinBudget: boolean;
  lcp: { samples: number; p50: number | null; p75: number | null; p95: number | null };
  allMs: number[];
};

type ProbeFile = {
  generatedAt: string;
  baseUrl: string;
  network: typeof NETWORK_PROFILE;
  samplesRequested: number;
  method: string;
  seed: number;
  budgetMs: number;
  views: ViewResult[];
};

const results: ViewResult[] = [];
let runCounter = 0;

function writeResults(baseUrl: string): void {
  const file: ProbeFile = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    network: NETWORK_PROFILE,
    samplesRequested: SAMPLES,
    method:
      "Chromium, CDP network emulation, navigation waitUntil commit, performance.now() when [data-primary-content] is visible; first sample per view is cold (fresh context), the rest are warm; nearest-rank percentiles over warm samples.",
    seed: SEED,
    budgetMs: P75_BUDGET_MS,
    views: [...results],
  };
  mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

test.describe("time to usable primary content", () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== "chromium", "The probe uses Chromium network emulation; other engines are not timed.");
  });

  for (const view of shuffled(VIEWS, SEED)) {
    test(`probe ${view.name}`, async ({ browser, baseURL }) => {
      test.setTimeout(Math.max(90_000, SAMPLES * 20_000 + 60_000));
      const origin = baseURL ?? "http://localhost:3010";
      const tokens = loadTokens();
      const route = view.path(tokens);
      const token = view.persona === "learner" ? tokens.learners[0] : tokens.staff[0];

      const warmMs: number[] = [];
      const lcpMs: number[] = [];
      const allMs: number[] = [];
      let coldMs = Number.NaN;

      // One fresh context per view: its first sample starts with an empty browser cache (cold).
      const context = await newProbeContext(browser, origin, token);
      try {
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        await cdp.send("Network.enable");
        await cdp.send("Network.emulateNetworkConditions", {
          offline: false,
          latency: NETWORK_PROFILE.latencyMs,
          downloadThroughput: (NETWORK_PROFILE.downloadMbps * 1_000_000) / 8,
          uploadThroughput: (NETWORK_PROFILE.uploadMbps * 1_000_000) / 8,
        });

        for (let sample = 0; sample < SAMPLES; sample += 1) {
          // A blank page first, so the previous sample's wrapper can never be mistaken for this one.
          await page.goto("about:blank");
          await page.goto(route, { waitUntil: "commit" });
          await page.waitForFunction(() => (window as unknown as Record<string, number | undefined>).__primaryAt !== undefined, undefined, {
            timeout: 30_000,
          });
          const primaryAt = await page.evaluate(() => (window as unknown as Record<string, number>).__primaryAt);
          // Supporting data only: LCP settles after the primary content, so read it once the page has loaded.
          await page.waitForLoadState("load", { timeout: 30_000 }).catch(() => undefined);
          const lcp = await page.evaluate(() => (window as unknown as Record<string, number | undefined>).__lcp ?? null);

          // A redirect to the sign-in page would never show the wrapper, so reaching here means the view rendered.
          expect(page.url()).not.toContain("/signin");
          allMs.push(Math.round(primaryAt));
          if (sample === 0) coldMs = Math.round(primaryAt);
          else warmMs.push(Math.round(primaryAt));
          if (lcp !== null && sample > 0) lcpMs.push(Math.round(lcp));
        }
      } finally {
        await context.close();
      }

      const warm = percentiles(warmMs, [50, 75, 95]);
      const lcp = lcpMs.length > 0 ? percentiles(lcpMs, [50, 75, 95]) : null;
      runCounter += 1;
      const result: ViewResult = {
        name: view.name,
        persona: view.persona,
        path: route.replace(/[0-9a-z]{20,}/gi, ":id"),
        runOrder: runCounter,
        samples: allMs.length,
        warmSamples: warmMs.length,
        coldMs,
        p50: warm[50],
        p75: warm[75],
        p95: warm[95],
        budgetMs: P75_BUDGET_MS,
        withinBudget: warm[75] <= P75_BUDGET_MS,
        lcp: { samples: lcpMs.length, p50: lcp?.[50] ?? null, p75: lcp?.[75] ?? null, p95: lcp?.[95] ?? null },
        allMs,
      };
      results.push(result);
      // Written before the assertion so a failing view still leaves its numbers behind.
      writeResults(origin);
      console.log(
        `probe ${view.name}: cold ${result.coldMs} ms, warm p50 ${result.p50}, p75 ${result.p75}, p95 ${result.p95} ms (${result.warmSamples} warm samples)`,
      );

      expect(result.p75, `${view.name} warm p75 (ms) must not exceed ${P75_BUDGET_MS}`).toBeLessThanOrEqual(P75_BUDGET_MS);
    });
  }
});
