/**
 * Keyboard-only journeys (Phase 15, plan 15-20; D-13, NFR-09).
 *
 * Three tests (public, learner, staff). After the first page of a journey is opened by address, every
 * move is made with the keyboard: Tab to a link and press Enter, type into fields, press Escape. At
 * every Tab stop the test checks, in the page itself:
 *   - the first Tab on a shell page lands on "Skip to main content", and Enter moves focus into main;
 *   - the focused element has a visible focus outline (computed outline style not none, width above 0);
 *   - the focused element is not covered: the element found at the centre of its visible part is the
 *     element itself (or part of it), so a sticky or fixed bar is not on top of it;
 *   - within each landmark (header, nav, main, aside, footer, dialog, menu) focus moves forward in
 *     document order, so focus order follows reading order;
 *   - Tab never stays on one element for more than three presses (no keyboard trap).
 * And on the actions: RowActionMenu and ConfirmModal return focus to their trigger on Escape, and a
 * failed form moves focus to its alert.
 *
 * Results: each test writes its own part (test-results/keyboard-parts/<run id>/<test>.json) and the
 * combined evidence is rewritten after every test, because Playwright starts a new worker after a
 * failed test. KEYBOARD_OUT overrides the output path.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { JOURNEY } from "./support/journey-fixtures";

const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUT =
  ".planning/phases/15-launch-readiness-nfr-verification-operational-cutover/evidence/keyboard-local.json";
const OUT_PATH = path.resolve(REPO_ROOT, process.env.KEYBOARD_OUT ?? DEFAULT_OUT);
process.env.KEYBOARD_RUN_ID ??= Date.now().toString(36);
const PARTS_DIR = path.join(REPO_ROOT, "test-results", "keyboard-parts", process.env.KEYBOARD_RUN_ID);

const DEV_PASSWORD = "Passw0rd!dev";
const STAMP = Date.now().toString(36);
/** More presses than this on one element in a row is a keyboard trap. */
const MAX_SAME_ELEMENT = 3;

// ---------------------------------------------------------------------------
// Sampling the focused element
// ---------------------------------------------------------------------------

type Stop = {
  tag: string;
  role: string | null;
  type: string | null;
  id: string;
  name: string;
  href: string | null;
  haspopup: string | null;
  region: string;
  outlineWidth: number;
  outlineStyle: string;
  size: { w: number; h: number };
  inViewport: boolean;
  /** What sits on top of the focused element at the centre of its visible part, or null when it is the element. */
  coveredBy: string | null;
  /** Focus moved backwards in document order inside its landmark. */
  backwards: boolean;
  /** The very element that had focus before this press. */
  same: boolean;
};

/** Lets smooth scrolling and focus scrolling finish before the element is measured. */
async function scrollSettled(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let last = Number.NaN;
        let stable = 0;
        const frame = () => {
          const position = window.scrollY * 100000 + window.scrollX;
          if (position === last) {
            stable += 1;
            if (stable >= 3) return resolve();
          } else {
            stable = 0;
            last = position;
          }
          requestAnimationFrame(frame);
        };
        frame();
      }),
  );
}

async function sampleFocus(page: Page): Promise<Stop | null> {
  return page.evaluate(() => {
    const w = window as unknown as { __kbLast?: Element | null; __kbByRegion?: WeakMap<object, Element> };
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body || el === document.documentElement) return null;

    const describe = (node: Element): string => {
      const label = node.getAttribute("aria-label");
      const text = (node.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      const id = node.id ? `#${node.id}` : "";
      return `${node.tagName.toLowerCase()}${id}${label ? `[aria-label="${label}"]` : ""}${text ? ` "${text}"` : ""}`;
    };

    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(rect.left, 0);
    const right = Math.min(rect.right, vw);
    const top = Math.max(rect.top, 0);
    const bottom = Math.min(rect.bottom, vh);
    const inViewport = rect.width > 0 && rect.height > 0 && right > left && bottom > top;

    let coveredBy: string | null = null;
    if (inViewport) {
      const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
      if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) {
        const labels = (el as HTMLInputElement).labels;
        const insideOwnLabel = labels ? Array.from(labels).some((l) => l.contains(hit)) : false;
        if (!insideOwnLabel) {
          let positioned = "";
          for (let p: Element | null = hit; p; p = p.parentElement) {
            const position = getComputedStyle(p).position;
            if (position === "fixed" || position === "sticky") {
              positioned = `${position} `;
              break;
            }
          }
          coveredBy = `${positioned}${describe(hit)}`;
        }
      }
    }

    const regionEl = el.closest('header, nav, main, aside, footer, [role="dialog"], [role="alertdialog"], [role="menu"]');
    const regionKey: object = regionEl ?? document.body;
    const region = regionEl
      ? `${regionEl.tagName.toLowerCase()}${regionEl.getAttribute("aria-label") ? `[${regionEl.getAttribute("aria-label")}]` : ""}`
      : "document";
    // The skip link is the first stop of a page: reaching it again means Tab wrapped round from the end,
    // so the order memory starts afresh.
    if (el.tagName === "A" && el.getAttribute("href") === "#main-content") w.__kbByRegion = new WeakMap();
    const byRegion = (w.__kbByRegion ??= new WeakMap());
    const before = byRegion.get(regionKey);
    let backwards = false;
    // A dialog or menu traps focus on purpose: from its last control Tab wraps to its first, so the order
    // rule applies to the page's landmarks only.
    const trapped = !!regionEl && regionEl.matches('[role="dialog"], [role="alertdialog"], [role="menu"]');
    if (!trapped && before && before !== el && before.isConnected) {
      backwards = !(before.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
    }
    byRegion.set(regionKey, el);

    const same = w.__kbLast === el;
    w.__kbLast = el;

    const labelledBy = el.getAttribute("aria-labelledby");
    const labelText = labelledBy ? (document.getElementById(labelledBy)?.textContent ?? "") : "";
    const name = (
      el.getAttribute("aria-label") ||
      labelText ||
      (el as HTMLInputElement).labels?.[0]?.textContent ||
      el.textContent ||
      (el as HTMLInputElement).value ||
      ""
    )
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 80);

    return {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role"),
      type: el.getAttribute("type"),
      id: el.id,
      name,
      href: el.getAttribute("href"),
      haspopup: el.getAttribute("aria-haspopup"),
      region,
      outlineWidth: Number.parseFloat(style.outlineWidth) || 0,
      outlineStyle: style.outlineStyle,
      size: { w: Math.round(rect.width), h: Math.round(rect.height) },
      inViewport,
      coveredBy,
      backwards,
      same,
    };
  });
}

// ---------------------------------------------------------------------------
// A run: the stops seen, the steps taken and every problem found
// ---------------------------------------------------------------------------

type RunRecord = { name: string; stops: number; pages: Array<{ page: string; stops: number }>; steps: string[]; problems: string[] };

class Run {
  readonly steps: string[] = [];
  readonly problems: string[] = [];
  readonly pages: Array<{ page: string; stops: number }> = [];
  stops = 0;
  private sameRun = 0;
  private pageStops = 0;
  private pageName = "";

  constructor(readonly name: string) {}

  step(text: string): void {
    this.steps.push(text);
  }

  problem(text: string): void {
    this.problems.push(text);
  }

  /** Marks the start of a new screen so the stops are counted per screen. */
  enterPage(label: string): void {
    this.closePage();
    this.pageName = label;
    this.pageStops = 0;
    this.sameRun = 0;
    this.step(`on ${label}`);
  }

  closePage(): void {
    if (this.pageName) this.pages.push({ page: this.pageName, stops: this.pageStops });
    this.pageName = "";
  }

  /** Presses Tab, measures the new focus owner and records what is wrong with it. */
  async tab(page: Page): Promise<Stop | null> {
    await page.keyboard.press("Tab");
    await scrollSettled(page);
    const stop = await sampleFocus(page);
    if (!stop) {
      this.sameRun = 0;
      if (process.env.KEYBOARD_TRACE) console.log(`[${this.name}] ${this.pageName} focus left the page (end of the Tab order)`);
      // The next Tab starts again at the top of the page, so the document-order memory starts afresh.
      await page.evaluate(() => {
        (window as unknown as { __kbByRegion?: WeakMap<object, Element> }).__kbByRegion = new WeakMap();
      });
      return null;
    }
    this.stops += 1;
    this.pageStops += 1;
    if (process.env.KEYBOARD_TRACE) console.log(`[${this.name}] ${this.pageName} #${this.pageStops} ${stop.tag}${stop.role ? "[" + stop.role + "]" : ""} "${stop.name}" ${stop.href ?? ""} (${stop.region})${stop.coveredBy ? " COVERED " + stop.coveredBy : ""}`);
    const where = `${this.pageName}: stop ${this.pageStops} (${stop.tag}${stop.role ? `[role=${stop.role}]` : ""} "${stop.name}" in ${stop.region})`;
    if (stop.outlineStyle === "none" || stop.outlineWidth <= 0) this.problem(`${where} has no visible focus outline`);
    if (!stop.inViewport) this.problem(`${where} is outside the visible window`);
    if (stop.coveredBy) this.problem(`${where} is covered by ${stop.coveredBy}`);
    if (stop.backwards) this.problem(`${where} came before the previous stop of its landmark in document order`);
    this.sameRun = stop.same ? this.sameRun + 1 : 0;
    if (this.sameRun >= MAX_SAME_ELEMENT) this.problem(`${where}: focus stayed on this element for ${this.sameRun + 1} presses (keyboard trap)`);
    return stop;
  }

  /** Tabs until a stop matches, or records a problem and throws when it is not reached. */
  async tabUntil(page: Page, what: string, match: (stop: Stop) => boolean, max = 120): Promise<Stop> {
    for (let i = 0; i < max; i++) {
      const stop = await this.tab(page);
      if (!stop) break;
      if (match(stop)) {
        this.step(`Tab to ${what} (${i + 1} press${i === 0 ? "" : "es"})`);
        return stop;
      }
      if (this.sameRun >= MAX_SAME_ELEMENT) break;
    }
    this.problem(`${this.pageName}: could not reach ${what} with the Tab key`);
    throw new Error(`${this.pageName}: could not reach ${what} with the Tab key`);
  }

  /** Tabs through up to `count` stops (stops early at the end of the page). */
  async tabThrough(page: Page, what: string, count: number): Promise<number> {
    let seen = 0;
    for (let i = 0; i < count; i++) {
      const stop = await this.tab(page);
      if (!stop) break;
      seen += 1;
      if (this.sameRun >= MAX_SAME_ELEMENT) break;
    }
    this.step(`Tab through ${what}: ${seen} stops`);
    return seen;
  }

  record(): RunRecord {
    this.closePage();
    return { name: this.name, stops: this.stops, pages: this.pages, steps: this.steps, problems: this.problems };
  }
}

function saveRun(run: Run): void {
  const record = run.record();
  mkdirSync(PARTS_DIR, { recursive: true });
  writeFileSync(path.join(PARTS_DIR, `${record.name}.json`), JSON.stringify(record), "utf8");

  const order = ["public", "learner", "staff"];
  const runs = readdirSync(PARTS_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => JSON.parse(readFileSync(path.join(PARTS_DIR, file), "utf8")) as RunRecord)
    .sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  const file = {
    generatedAt: new Date().toISOString(),
    runId: process.env.KEYBOARD_RUN_ID,
    journeys: runs.map((r) => r.name),
    stops: runs.reduce((sum, r) => sum + r.stops, 0),
    failures: runs.reduce((sum, r) => sum + r.problems.length, 0),
    runs,
  };
  mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// Journey helpers
// ---------------------------------------------------------------------------

/** Waits for the screen to be there and hydrated, so typing and Enter are not lost. */
async function ready(page: Page): Promise<void> {
  await page.locator("main, [data-primary-content]").first().waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForLoadState("load", { timeout: 30_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts?.ready).catch(() => undefined);
  await page.waitForTimeout(400);
}

/** Opens the first page of a journey by address; everything after it is keyboard. */
async function open(page: Page, run: Run, route: string, label: string): Promise<void> {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await ready(page);
  run.enterPage(label);
}

/** Presses Enter on the focused link and waits for the new screen. */
async function followLink(page: Page, run: Run, target: RegExp, label: string): Promise<void> {
  await Promise.all([page.waitForURL(target, { timeout: 45_000 }), page.keyboard.press("Enter")]);
  await ready(page);
  run.enterPage(label);
}

/** The first Tab must land on the skip link, in view; Enter must move focus into main. */
async function checkSkipLink(page: Page, run: Run, { activate }: { activate: boolean }): Promise<void> {
  const first = await run.tab(page);
  if (!first || first.name !== "Skip to main content" || !first.href?.endsWith("#main-content")) {
    run.problem(`${run.name}: the first Tab on ${first ? `"${first.name}"` : "nothing"} instead of the skip link`);
    return;
  }
  run.step("first Tab is the skip link");
  if (!activate) return;
  await page.keyboard.press("Enter");
  await scrollSettled(page);
  const inMain = await page.evaluate(() => {
    const main = document.getElementById("main-content");
    const active = document.activeElement;
    return !!main && !!active && (active === main || main.contains(active));
  });
  if (!inMain) run.problem(`${run.name}: Enter on the skip link did not move focus into main`);
  else run.step("Enter on the skip link moves focus into main");
  const next = await run.tab(page);
  const nextInMain = await page.evaluate(() => {
    const main = document.getElementById("main-content");
    const active = document.activeElement;
    return !!main && !!active && main.contains(active);
  });
  if (next && !nextInMain) run.problem(`${run.name}: after the skip link, the next Tab left main (stop "${next.name}")`);
}

/** Signs in with the keyboard only: Tab to the fields, type, Tab to the button, Enter. */
async function keyboardSignIn(page: Page, run: Run, email: string, landing: RegExp): Promise<void> {
  await open(page, run, "/signin", "sign-in page");
  await run.tabUntil(page, "the email field", (s) => s.tag === "input" && s.type === "email");
  await page.keyboard.type(email);
  await run.tabUntil(page, "the password field", (s) => s.tag === "input" && (s.type === "password" || s.name.toLowerCase().includes("password")));
  await page.keyboard.type(DEV_PASSWORD);
  await run.tabUntil(page, "the Sign in button", (s) => s.tag === "button" && s.name === "Sign in");
  await Promise.all([page.waitForURL(landing, { timeout: 60_000 }), page.keyboard.press("Enter")]);
  await ready(page);
}

/** After a failed form submit, focus must be on the alert or on the box that holds it. */
async function expectFocusOnAlert(page: Page, run: Run, what: string): Promise<void> {
  // The framework's own route announcer is also an alert, so wait for the one inside the page's main area.
  await page.locator('main [role="alert"]').first().waitFor({ state: "visible", timeout: 30_000 });
  const read = () =>
    page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      if (!active || active === document.body) return { onAlert: false, where: "nothing" };
      const alert = active.closest('[role="alert"]') ?? active.querySelector('[role="alert"]');
      return {
        onAlert: !!alert,
        where: `${active.tagName.toLowerCase()} "${(active.textContent ?? "").trim().slice(0, 40)}"`,
      };
    });
  // Focus lands a moment after the message appears (the form re-renders first); give it two seconds.
  let focus = await read();
  for (let waited = 0; !focus.onAlert && waited < 2_000; waited += 100) {
    await page.waitForTimeout(100);
    focus = await read();
  }
  if (!focus.onAlert) run.problem(`${what}: after the failed submit, focus is on ${focus.where}, not on the alert`);
  else run.step(`${what}: focus moves to the alert after a failed submit`);
  // Focus was moved by the page, not by Tab: note where it is, so the next Tab is compared with the alert.
  await sampleFocus(page);
}

/** Pressing Escape returns focus to the control that opened the menu or dialog (same button, found by its name). */
async function expectFocusBackOn(page: Page, run: Run, trigger: Stop, what: string): Promise<void> {
  await page.waitForTimeout(200);
  const back = await sampleFocus(page);
  if (!back || back.tag !== trigger.tag || back.name !== trigger.name) {
    run.problem(`${what}: focus did not return to "${trigger.name}" (it is on ${back ? `${back.tag} "${back.name}"` : "nothing"})`);
  } else {
    run.step(`${what}: focus returns to "${trigger.name}"`);
  }
}

test.describe("keyboard-only journeys", () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== "chromium", "The keyboard runs use Chromium; the other engines are covered by the journey.");
  });
  // A laptop-size window: header navigation, sidebar and sticky bars are all in their desktop form.
  test.use({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce", colorScheme: "light" });

  // A check that cannot fail proves nothing (threat T-15-20-02): each rule must report a page built to break it.
  test("control: the keyboard checks report a missing outline, a covered control, reversed order and a trap", async ({ page }) => {
    const page_ = (body: string) => `<!doctype html><html lang="en"><body><main>${body}</main></body></html>`;
    const tabs = async (html: string, count: number): Promise<string> => {
      const run = new Run("control");
      run.enterPage("control page");
      // A fresh document each time, so Tab starts from the top of the page, not from the last page's focus.
      await page.goto("about:blank");
      await page.setContent(html);
      for (let i = 0; i < count; i++) await run.tab(page);
      return run.problems.join("\n");
    };

    // No outline: the browser's focus ring switched off.
    expect(await tabs(page_('<button style="outline:none">No ring</button>'), 1)).toContain("has no visible focus outline");
    // A normal button passes.
    expect(await tabs(page_("<button>Plain</button>"), 1)).toBe("");

    // Covered: a fixed layer over the page, as a sticky bar over a control would be.
    const covered = await tabs(
      page_('<button>Under the bar</button><div style="position:fixed;inset:0;background:rgba(0,0,0,.02)">bar</div>'),
      1,
    );
    expect(covered).toContain("is covered by fixed");

    // Reversed order: a positive tabindex sends focus to a later element first, then back up the page.
    const reversed = await tabs(page_('<button>First in the page</button><button tabindex="1">Second in the page</button>'), 2);
    expect(reversed).toContain("came before the previous stop of its landmark in document order");

    // A trap: Tab is swallowed, so focus stays put.
    const trap = await tabs(
      page_("<button onkeydown=\"if (event.key === 'Tab') event.preventDefault()\">Stuck</button>"),
      6,
    );
    expect(trap).toContain("keyboard trap");
  });

  test("public journey: catalogue, course, sign-in failure, certificate check, by keyboard alone", async ({ page }) => {
    test.setTimeout(240_000);
    const run = new Run("public");
    try {
      await open(page, run, "/courses", "catalogue");
      await checkSkipLink(page, run, { activate: false });
      await run.tabThrough(page, "the catalogue header and first cards", 30);

      // Fresh load: the skip link, Enter, then the course card.
      await open(page, run, "/courses", "catalogue (skip link)");
      await checkSkipLink(page, run, { activate: true });
      await run.tabUntil(page, "the journey course card", (s) => s.tag === "a" && (s.href ?? "").endsWith(`/courses/${JOURNEY.courseSlug}`));
      await followLink(page, run, new RegExp(`/courses/${JOURNEY.courseSlug}$`), "course page");
      await run.tabThrough(page, "the course page after a link was followed", 15);

      // A fresh load of the same page: the skip link first, then the header's Sign in link.
      await open(page, run, `/courses/${JOURNEY.courseSlug}`, "course page (fresh load)");
      await checkSkipLink(page, run, { activate: false });
      await run.tabUntil(page, "the Sign in link", (s) => s.tag === "a" && s.name === "Sign in" && s.href === "/signin");
      await followLink(page, run, /\/signin$/, "sign-in page");

      // Wrong credentials, by keyboard: the alert takes focus.
      await run.tabUntil(page, "the email field", (s) => s.tag === "input" && s.type === "email");
      await page.keyboard.type(`keyboard-${STAMP}@a11y.test`);
      await run.tabUntil(page, "the password field", (s) => s.tag === "input" && s.type === "password");
      await page.keyboard.type("Wrong-password-1");
      await run.tabUntil(page, "the Sign in button", (s) => s.tag === "button" && s.name === "Sign in");
      await page.keyboard.press("Enter");
      await expectFocusOnAlert(page, run, "sign-in");
      await run.tabThrough(page, "the sign-in page after the failure", 8);

      await run.tabUntil(page, "the Create an account link", (s) => s.tag === "a" && s.href === "/register");
      await followLink(page, run, /\/register$/, "register page");
      await run.tabThrough(page, "the register form", 25);

      await open(page, run, "/verify-certificate", "certificate check");
      await checkSkipLink(page, run, { activate: false });
      await run.tabUntil(page, "the reference field", (s) => s.tag === "input" && s.type !== "hidden" && s.type !== "submit");
      await page.keyboard.type("KQ-NOT-A-REAL-REFERENCE");
      await run.tabThrough(page, "the certificate check form", 3);
    } catch (error) {
      if (!run.problems.some((p) => error instanceof Error && p.includes(error.message))) {
        run.problem(error instanceof Error ? error.message.split("\n")[0] : String(error));
      }
    } finally {
      saveRun(run);
    }
    expect(run.problems, run.problems.join("\n")).toEqual([]);
  });

  test("learner journey: sign in, dashboard, course, lesson and a failed support request, by keyboard alone", async ({ page }) => {
    test.setTimeout(240_000);
    const run = new Run("learner");
    try {
      await keyboardSignIn(page, run, "learner4@kqnexus.test", /\/dashboard/);
      run.enterPage("dashboard");
      await checkSkipLink(page, run, { activate: false });
      await run.tabThrough(page, "the dashboard header and navigation", 25);

      await open(page, run, "/dashboard", "dashboard (skip link)");
      await checkSkipLink(page, run, { activate: true });
      await run.tabThrough(page, "the dashboard content", 30);

      // Header navigation to My learning, then into a course and a lesson, all by keyboard.
      await open(page, run, "/dashboard", "dashboard (navigation)");
      await run.tabUntil(page, "the My learning link", (s) => s.tag === "a" && s.href === "/learn");
      await followLink(page, run, /\/learn$/, "my learning");
      await run.tabThrough(page, "my learning", 12);
      await open(page, run, "/learn", "my learning (course link)");
      await checkSkipLink(page, run, { activate: true });
      await run.tabUntil(page, "a course link", (s) => s.tag === "a" && /^\/learn\/[^/]+$/.test(s.href ?? ""));
      await followLink(page, run, /\/learn\/[^/]+$/, "course home");
      await run.tabThrough(page, "the course home", 30);
      const courseHome = new URL(page.url()).pathname;
      await open(page, run, courseHome, "course home (skip link)");
      await checkSkipLink(page, run, { activate: true });
      await run.tabThrough(page, "the course home content", 30);

      // The dashboard's Resume lesson link opens the lesson in the lesson frame (its own shell).
      await open(page, run, "/dashboard", "dashboard (resume lesson)");
      await run.tabUntil(page, "the Resume lesson link", (s) => s.tag === "a" && /\/lessons\//.test(s.href ?? ""), 40);
      await followLink(page, run, /\/lessons\//, "lesson");
      await run.tabThrough(page, "the lesson page", 30);
      await open(page, run, new URL(page.url()).pathname, "lesson (skip link)");
      await checkSkipLink(page, run, { activate: true });
      await run.tabThrough(page, "the lesson content", 30);

      // A support request with nothing filled in: the alert takes focus.
      await open(page, run, "/support/new", "new support request");
      await checkSkipLink(page, run, { activate: true });
      await run.tabUntil(page, "the Create ticket button", (s) => s.tag === "button" && s.name === "Create ticket");
      await page.keyboard.press("Enter");
      await expectFocusOnAlert(page, run, "new support request");
      await run.tabThrough(page, "the form after the failure", 8);
    } catch (error) {
      if (!run.problems.some((p) => error instanceof Error && p.includes(error.message))) {
        run.problem(error instanceof Error ? error.message.split("\n")[0] : String(error));
      }
    } finally {
      saveRun(run);
    }
    expect(run.problems, run.problems.join("\n")).toEqual([]);
  });

  test("staff journey: sign in, overview, enrolments row menu and confirmation, new course form, by keyboard alone", async ({ page }) => {
    test.setTimeout(300_000);
    const run = new Run("staff");
    try {
      await keyboardSignIn(page, run, "admin@kqnexus.test", /\/staff/);
      run.enterPage("staff overview");
      await checkSkipLink(page, run, { activate: false });
      await run.tabThrough(page, "the staff sidebar and header", 40);

      await open(page, run, "/staff", "staff overview (skip link)");
      await checkSkipLink(page, run, { activate: true });
      await run.tabThrough(page, "the staff overview content", 30);

      // Sidebar to Enrolments.
      await open(page, run, "/staff", "staff overview (navigation)");
      // The sidebar groups start folded: open Delivery with Enter, then Tab to Enrolments inside it.
      await run.tabUntil(page, "the Delivery group button", (s) => s.tag === "button" && s.name === "Delivery", 20);
      await page.keyboard.press("Enter");
      await run.tabUntil(page, "the Enrolments link", (s) => s.tag === "a" && s.href === "/staff/enrolments", 20);
      await followLink(page, run, /\/staff\/enrolments$/, "enrolments");

      // The row actions menu: open, Escape returns focus; open, choose the last item, confirmation dialog.
      const trigger = await run.tabUntil(page, "a row actions button", (s) => s.tag === "button" && s.haspopup === "menu", 200);
      await page.keyboard.press("Enter");
      await page.getByRole("menu").waitFor({ state: "visible", timeout: 15_000 });
      const first = await sampleFocus(page);
      if (!first || first.role !== "menuitem") run.problem(`row actions: opening the menu did not focus a menu item (on ${first ? first.tag : "nothing"})`);
      else run.step("row actions: opening the menu focuses the first item");
      await page.keyboard.press("Escape");
      await page.getByRole("menu").waitFor({ state: "hidden", timeout: 15_000 });
      await expectFocusBackOn(page, run, trigger, "row actions menu, Escape");

      await page.keyboard.press("Enter");
      await page.getByRole("menu").waitFor({ state: "visible", timeout: 15_000 });
      await page.keyboard.press("End");
      await scrollSettled(page);
      const item = await sampleFocus(page);
      run.step(`row actions: End moves to "${item?.name ?? "nothing"}"`);
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog");
      await dialog.waitFor({ state: "visible", timeout: 15_000 });
      await page.waitForTimeout(300);
      const inDialog = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
      if (!inDialog) run.problem("confirmation dialog: focus did not move into the dialog");
      else run.step("confirmation dialog: focus moves into the dialog");
      // Tab around the dialog: focus must stay inside it.
      for (let i = 0; i < 6; i++) {
        const stop = await run.tab(page);
        const stillInside = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
        if (stop && !stillInside) run.problem(`confirmation dialog: Tab ${i + 1} moved focus out of the dialog (to "${stop.name}")`);
      }
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden", timeout: 15_000 });
      await expectFocusBackOn(page, run, trigger, "confirmation dialog, Escape");

      // A long stepped form, for the sticky action bar: focus must never end up underneath it.
      await open(page, run, "/staff/courses/new", "new course form");
      await checkSkipLink(page, run, { activate: true });
      await run.tabThrough(page, "the new course form", 60);

      // A form submitted with nothing in it: the error summary takes focus.
      await open(page, run, "/staff/roles/new", "new role form");
      await run.tabUntil(page, "the submit button", (s) => s.tag === "button" && s.type === "submit" && s.region === "main", 60);
      await page.keyboard.press("Enter");
      await expectFocusOnAlert(page, run, "new role form");
      await run.tabThrough(page, "the new role form after the failure", 10);
    } catch (error) {
      if (!run.problems.some((p) => error instanceof Error && p.includes(error.message))) {
        run.problem(error instanceof Error ? error.message.split("\n")[0] : String(error));
      }
    } finally {
      saveRun(run);
    }
    expect(run.problems, run.problems.join("\n")).toEqual([]);
  });
});
