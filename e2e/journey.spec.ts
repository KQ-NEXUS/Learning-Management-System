/**
 * The unassisted journey (Phase 15, plans 15-15 and 15-17; D-08, NFR-03, NFR-12,
 * NFR-13).
 *
 * "leg 1" (plan 15-15): a brand-new visitor finds a course, registers, follows
 * the verification link from the captured email, signs in and reaches the
 * learner dashboard.
 *
 * "full journey" (plan 15-17): the same learner then goes on to pay, learn,
 * attend, submit, be graded, complete and download a verified certificate.
 * Staff steps (payment confirmation, attendance, grading) go through the staff
 * screens in separate browser contexts; background work runs through the guarded
 * task runner. After every asynchronous step the spec waits for the
 * learner-visible state (a poll, never a sleep).
 *
 * Payment uses the manual confirmation path (ledger P-01): gateway payments are
 * covered by the webhook integration tests, the k6 replay and the staging run.
 *
 * "staging journey" and "staging quiet resend" (plan 15-30; D-01, D-08, ledger
 * A15) run only with E2E_TARGET=staging, through e2e/playwright.staging.config.ts,
 * against the Netlify deploy preview and the staging Neon branch. The staging
 * journey starts from a seeded load learner (already verified) who signs in
 * through the form, then follows the same steps as "full journey" from "enrol"
 * onward; staff steps use a load staff account, and background tasks run through
 * the guarded task runner with --target staging. The two local tests are skipped
 * on staging and the two staging tests are skipped locally.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { CAPTURE_ORIGIN } from "./support/server-env";
import { JOURNEY, loadJourneyIds } from "./support/journey-fixtures";
import { confirmManualPayment, gradeAndRelease, markAttendance, openStaffSession } from "./support/staff-actions";
import { describeDatabaseActivity } from "./support/diagnostics";
import { allowSessionOverHttp } from "./support/session";
import { runTask } from "./support/tasks";
import { recordStorageUploads } from "./support/upload-diagnostic";

type CapturedMessage = { to: string; subject: string; html: string; text: string };

const PASSWORD = "Journey-pass-2026!";

/** True when the run targets the deploy preview and the staging branch (plan 15-30). */
const STAGING = process.env.E2E_TARGET === "staging";
const REPO_ROOT = path.resolve(__dirname, "..");
const SIGN_IN_FAILED = /Those details do not match an account\./;

type StaffRole = "finance" | "instructor";

/** What differs between the local journey and the staging journey; every step in between is shared. */
type JourneyWorld = {
  target: "local" | "staging";
  baseURL: string;
  learnerName: string;
  /** A signed-in staff page for the role. */
  openStaff: (role: StaffRole) => Promise<Page>;
  /** Called when a staff step is over. */
  closeStaff: (page: Page) => Promise<void>;
};

function verificationLinkFrom(message: CapturedMessage): string | null {
  const sources = [message.html, message.text];
  for (const source of sources) {
    const match = source.match(/https?:\/\/[^\s"'<>]*\/verify\?[^\s"'<>]*token=[^\s"'<>]+/i);
    if (match) return match[0].replace(/&amp;/g, "&");
  }
  return null;
}

/** Discover, register, verify through the emailed link, and sign in. Ends on the dashboard. */
async function discoverRegisterVerifySignIn(
  page: Page,
  request: APIRequestContext,
  who: { email: string; name: string; courseTitle?: RegExp },
): Promise<void> {
  // Discover: the public catalogue lists a course, and its detail page opens.
  await page.goto("/courses");
  await expect(page.getByRole("heading", { level: 1, name: "Courses" })).toBeVisible();
  const courseLink = who.courseTitle
    ? page.getByRole("link", { name: who.courseTitle })
    : page.getByRole("link", { name: /View course/ });
  await courseLink.first().click();
  await expect(page).toHaveURL(/\/courses\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // Register as a new visitor, from the public site's own Register link.
  await page.getByRole("link", { name: /^(Register|Create an account)$/ }).first().click();
  await expect(page).toHaveURL(/\/register$/);
  await page.getByLabel("Full name").fill(who.name);
  await page.getByLabel("Email address").fill(who.email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole("checkbox", { name: /terms of service/ }).check();
  await page.getByRole("checkbox", { name: /privacy notice/ }).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  // The raw verification token exists only in the email: read it from the capture server.
  let verifyLink: string | null = null;
  await expect
    .poll(
      async () => {
        const response = await request.get(`${CAPTURE_ORIGIN}/messages`, { params: { to: who.email } });
        const messages = (await response.json()) as CapturedMessage[];
        for (const message of messages) {
          verifyLink = verificationLinkFrom(message);
          if (verifyLink) return true;
        }
        return false;
      },
      { message: "verification email reaches the capture server", timeout: 30_000 },
    )
    .toBe(true);

  // Verify.
  await page.goto(verifyLink as unknown as string);
  await expect(page.getByRole("heading", { name: "Email verified" })).toBeVisible();
  await page.getByRole("link", { name: "Continue to sign in" }).click();
  await expect(page).toHaveURL(/\/signin$/);

  // Sign in through the form (no saved session state) and reach the dashboard.
  await page.getByLabel("Email address").fill(who.email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { level: 1, name: "Your dashboard" })).toBeVisible();
  // WebKit does not send the Secure session cookie over http://localhost; see support/session.ts.
  await allowSessionOverHttp(page);
}

test("leg 1: discover, register, verify, sign in", async ({ page, request }, testInfo) => {
  test.skip(STAGING, "Local only: it reads the verification email from the local capture server.");
  const email = `journey-${Date.now()}-${testInfo.project.name}@journey.test`;
  await discoverRegisterVerifySignIn(page, request, { email, name: "Journey Learner" });
});

/** Marks the lesson complete and moves to the next one, asserting the learner-visible state each time. */
async function readAndComplete(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Mark complete" }).click();
  // "Undo" only exists once the lesson is recorded as completed.
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
}

test("full journey", async ({ page, request, browser }, testInfo) => {
  test.skip(STAGING, 'Local only: on staging run "staging journey".');
  test.setTimeout(360_000);
  try {
    await runFullJourney({ page, request, browser }, testInfo);
  } catch (error) {
    // A stalled or failed step leaves a record of what the database was doing at that moment.
    await testInfo.attach("database-activity", {
      body: await describeDatabaseActivity(),
      contentType: "text/plain",
    });
    throw error;
  }
});

async function runFullJourney(
  { page, request, browser }: { page: Page; request: APIRequestContext; browser: Browser },
  testInfo: TestInfo,
): Promise<void> {
  const baseURL = String(testInfo.project.use.baseURL ?? "http://localhost:3010");
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const learnerName = `Journey Learner ${stamp}`;
  const email = `journey-${stamp}-${testInfo.project.name}@journey.test`;

  testInfo.annotations.push({ type: "browser-version", description: browser.version() });

  await test.step("leg 1: discover, register, verify, sign in", async () => {
    await discoverRegisterVerifySignIn(page, request, {
      email,
      name: learnerName,
      courseTitle: new RegExp(JOURNEY.courseTitle),
    });
  });

  await continueJourney(
    { page, request, browser },
    {
      target: "local",
      baseURL,
      learnerName,
      openStaff: (role) => openStaffSession(browser, baseURL, role),
      closeStaff: (staffPage) => staffPage.context().close(),
    },
  );
}

/**
 * Everything after the learner is signed in: enrol, pay, learn, attend, submit,
 * be graded, complete, download and verify the certificate. Shared by the local
 * "full journey" and the "staging journey", so both prove the same steps.
 */
async function continueJourney(
  { page, request, browser }: { page: Page; request: APIRequestContext; browser: Browser },
  world: JourneyWorld,
): Promise<void> {
  const { baseURL, learnerName, target } = world;
  const ids = loadJourneyIds(target);

  let orderId = "";
  await test.step("enrol: choose the cohort and reach the order page", async () => {
    await page.goto(`/courses/${JOURNEY.courseSlug}`);
    await page.getByRole("button", { name: "Pay in NGN with Paystack" }).click();
    await expect(page).toHaveURL(/\/checkout\/[^/?]+$/);
    await expect(page.getByRole("heading", { level: 1, name: "Review your order" })).toBeVisible();
    orderId = new URL(page.url()).pathname.split("/").pop() ?? "";
    expect(orderId).not.toBe("");
  });

  await test.step("pay: finance confirms the manual payment", async () => {
    const finance = await world.openStaff("finance");
    try {
      await confirmManualPayment(finance, orderId);
    } finally {
      await world.closeStaff(finance);
    }
    // Enrolment emails and events are asynchronous: drain them, then look at what the learner sees.
    runTask("drain-domain-events", target);
  });

  let enrolmentId = "";
  await test.step("learn: open the course from the dashboard", async () => {
    if (target === "staging") {
      // A load learner already has another course, so the dashboard's first link may not be this one.
      // Find the new enrolment in "My learning": it is the one that opens the journey's first lesson.
      await page.goto("/learn");
      await expect(page.getByRole("heading", { level: 1, name: "My learning" })).toBeVisible();
      const hrefs = await page
        .locator('a[href^="/learn/"]')
        .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
      const candidates = [
        ...new Set(hrefs.map((href) => href.split("/")[2] ?? "").filter((id) => id !== "" && id !== "calendar")),
      ];
      for (const candidate of candidates) {
        const response = await page.request.get(`/learn/${candidate}/lessons/${ids.lessonIds[0]}`, { maxRedirects: 0 });
        if (response.status() === 200 && (await response.text()).includes(JOURNEY.textLessonOne)) {
          enrolmentId = candidate;
          break;
        }
      }
      expect(enrolmentId, "the journey course appears in My learning").not.toBe("");
      await page.goto(`/learn/${enrolmentId}/lessons/${ids.lessonIds[0]}`);
      return;
    }
    await page.goto("/dashboard");
    const start = page.getByRole("link", { name: /^(Start|Resume) lesson/ });
    await expect(start).toBeVisible();
    const href = (await start.getAttribute("href")) ?? "";
    enrolmentId = href.split("/")[2] ?? "";
    expect(enrolmentId).not.toBe("");
    await start.click();
    await expect(page).toHaveURL(new RegExp(`/learn/${enrolmentId}/lessons/${ids.lessonIds[0]}$`));
  });

  await test.step("learn: complete both reading lessons", async () => {
    await expect(page.getByRole("heading", { level: 1, name: JOURNEY.textLessonOne })).toBeVisible();
    await readAndComplete(page);
    await page.getByRole("link", { name: /Next lesson/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: JOURNEY.textLessonTwo })).toBeVisible();
    await readAndComplete(page);
  });

  await test.step("attend: the instructor marks the learner present", async () => {
    const instructor = await world.openStaff("instructor");
    try {
      await markAttendance(instructor, ids.cohortId, ids.sessionId, learnerName);
    } finally {
      await world.closeStaff(instructor);
    }
  });

  await test.step("submit: the learner uploads the assignment", async () => {
    await page.goto(`/learn/${enrolmentId}/lessons/${ids.lessonIds[2]}`);
    await expect(page.getByRole("heading", { level: 1, name: JOURNEY.assignmentLesson })).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles({
      name: "journey-assignment.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(`Journey assignment from ${learnerName}.\n`),
    });
    await page.getByRole("button", { name: "Submit assignment" }).click();
    // The receipt only appears after the server has verified the stored file.
    await expect(page.getByText(/Submitted — receipt/)).toBeVisible();
  });

  await test.step("grade: the instructor grades and releases", async () => {
    const instructor = await world.openStaff("instructor");
    try {
      await gradeAndRelease(instructor, ids.cohortId, ids.assessmentId, learnerName, 80);
    } finally {
      await world.closeStaff(instructor);
    }
  });

  let verificationRef = "";
  let certificateHref = "";
  await test.step("complete: drain background work until the certificate is available", async () => {
    const download = page.getByRole("link", { name: "Download certificate" });
    await expect
      .poll(
        async () => {
          runTask("drain-domain-events", target);
          await page.goto("/dashboard");
          // The dashboard streams in behind a loading shell: wait for the real page before counting.
          await expect(page.getByRole("region", { name: "Your current course" })).toBeVisible({ timeout: 30_000 });
          return download.count();
        },
        { message: "the learner sees the certificate once background work has run", timeout: 120_000, intervals: [1_000] },
      )
      .toBeGreaterThan(0);

    certificateHref = (await download.first().getAttribute("href")) ?? "";
    expect(certificateHref).toMatch(/^\/api\/certificates\/[^/]+\/download$/);
    verificationRef = ((await download.first().locator("xpath=following-sibling::p[1]").textContent()) ?? "").trim();
    expect(verificationRef).not.toBe("");
  });

  await test.step("certificate: download the PDF through a short-lived link", async () => {
    // The download route answers with a redirect to a presigned link; the learner's own session is required.
    const redirect = await page.request.get(certificateHref, { maxRedirects: 0 });
    expect(redirect.status()).toBe(302);
    const location = redirect.headers()["location"];
    expect(location).toBeTruthy();
    expect(location).toMatch(/X-Amz-Expires=/);

    // The presigned link carries its own signature: fetch it without the session.
    const file = await request.get(location);
    expect(file.status()).toBe(200);
    expect(file.headers()["content-type"]).toContain("application/pdf");
    const body = await file.body();
    expect(body.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  await test.step("verify: the public check reports the certificate as valid", async () => {
    // A visitor with no session at all.
    const visitor = await browser.newContext({ baseURL });
    try {
      const visitorPage = await visitor.newPage();
      await visitorPage.goto(`/verify/${encodeURIComponent(verificationRef)}`);
      await expect(visitorPage.getByText("This certificate is valid.")).toBeVisible();
      await expect(visitorPage.getByText(JOURNEY.courseTitle).first()).toBeVisible();
    } finally {
      await visitor.close();
    }
  });
}

// ---------------------------------------------------------------------------
// Staging (plan 15-30): the deploy preview and the staging Neon branch.
// ---------------------------------------------------------------------------

type StagingTokens = { password: string; learnerEmails: string[]; staffEmails: string[] };

/** The load accounts' shared password and addresses, from the gitignored tokens file. Never printed. */
function loadStagingTokens(): StagingTokens {
  const file = path.resolve(REPO_ROOT, process.env.STAGING_TOKENS ?? "perf/results/tokens-staging.json");
  const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<StagingTokens>;
  if (!parsed.password || !parsed.learnerEmails?.length || !parsed.staffEmails?.length) {
    throw new Error("The staging tokens file has no password, learners or staff. Run seed-load --target staging first.");
  }
  return parsed as StagingTokens;
}

async function signInThroughForm(page: Page, email: string, password: string, landing: RegExp): Promise<void> {
  await page.goto("/signin");
  await page.getByLabel("Email address").fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(landing);
}

test("staging journey", async ({ page, request, browser }, testInfo) => {
  test.skip(!STAGING, "Staging only: set E2E_TARGET=staging and use e2e/playwright.staging.config.ts.");
  test.setTimeout(900_000);

  const baseURL = String(testInfo.project.use.baseURL ?? "");
  const tokens = loadStagingTokens();
  // One learner can take the journey course once, so a repeat run names another learner (1-based).
  const learnerNumber = Number(process.env.STAGING_JOURNEY_LEARNER ?? tokens.learnerEmails.length);
  const learnerEmail = tokens.learnerEmails[learnerNumber - 1];
  if (!learnerEmail) throw new Error("STAGING_JOURNEY_LEARNER is not a seeded load learner number.");
  // seed-load names its learners "Load Learner 001" to "Load Learner 150".
  const learnerName = `Load Learner ${String(learnerNumber).padStart(3, "0")}`;
  const staffEmail = tokens.staffEmails[tokens.staffEmails.length - 1];

  testInfo.annotations.push({ type: "browser-version", description: browser.version() });
  testInfo.annotations.push({ type: "learner", description: learnerName });

  // Off unless STAGING_UPLOAD_DIAG=1: reads the storage service's answer to the upload (see the support file).
  await recordStorageUploads(page, path.resolve(REPO_ROOT, "perf/results/upload-diag-staging.json"));

  // One staff session for the whole journey (load staff hold the Administrator role), opened on first use.
  const staff: { page: Page | null } = { page: null };
  try {
    await test.step("sign in: a seeded, verified load learner signs in through the form", async () => {
      await signInThroughForm(page, learnerEmail, tokens.password, /\/dashboard$/);
      // A learner who already has a course is greeted by name, so look for the dashboard's own region.
      await expect(page.getByRole("region", { name: "Your current course" })).toBeVisible();
    });

    await continueJourney(
      { page, request, browser },
      {
        target: "staging",
        baseURL,
        learnerName,
        openStaff: async () => {
          if (!staff.page) {
            const context = await browser.newContext({ baseURL });
            const staffPage = await context.newPage();
            await signInThroughForm(staffPage, staffEmail, tokens.password, /\/staff(\/|$)/);
            staff.page = staffPage;
          }
          return staff.page;
        },
        closeStaff: async () => undefined,
      },
    );
  } finally {
    await staff.page?.context().close();
  }
});

/** Runs the guarded staging probe and returns the verification-token count for the address. */
function verificationTokenCount(email: string): number {
  const result = spawnSync(
    "npx",
    ["tsx", "scripts/ops/staging-checks.ts", "tokens", "--email", email, "--target", "staging"],
    { cwd: REPO_ROOT, env: process.env, encoding: "utf8", shell: process.platform === "win32" },
  );
  const match = /staging-checks tokens: (\d+)/.exec(result.stdout ?? "");
  if (result.status !== 0 || !match) {
    const detail = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split("\n").slice(-3).join("\n");
    throw new Error(`staging-checks tokens failed (exit ${result.status ?? "none"}).\n${detail}`);
  }
  return Number(match[1]);
}

/**
 * Ledger A15: signing in with the right password to an unverified account shows
 * the neutral message and, after the response, issues a new verification token
 * (the quiet resend). That work runs inside `next/server` `after()`, so a new
 * token on the preview proves `after()` runs on Netlify.
 */
test("staging quiet resend", async ({ page }) => {
  test.skip(!STAGING, "Staging only: set E2E_TARGET=staging and use e2e/playwright.staging.config.ts.");
  test.setTimeout(300_000);

  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const email = `quiet-resend-${stamp}@journey.test`;
  const outFile = path.resolve(REPO_ROOT, process.env.QUIET_RESEND_OUT ?? "perf/results/quiet-resend-staging.json");

  await page.goto("/register");
  await page.getByLabel("Full name").fill(`Quiet Resend ${stamp}`);
  await page.getByLabel("Email address").fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole("checkbox", { name: /terms of service/ }).check();
  await page.getByRole("checkbox", { name: /privacy notice/ }).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  const registeredAt = Date.now();

  const before = verificationTokenCount(email);
  expect(before, "registration issued the first verification token").toBeGreaterThan(0);

  // A resend inside 60 seconds of the last token is refused by the per-address cooldown
  // (src/server/auth/request-cooldown.ts), so the sign-in waits until that has passed.
  await page.waitForTimeout(Math.max(0, registeredAt + 65_000 - Date.now()));

  await page.goto("/signin");
  await page.getByLabel("Email address").fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  // The neutral S4 message: the same words as for a wrong password, and no session.
  await expect(page.getByText(SIGN_IN_FAILED)).toBeVisible();
  await expect(page).toHaveURL(/\/signin$/);
  const answeredAt = Date.now();

  await page.waitForTimeout(10_000);
  const after = verificationTokenCount(email);
  // If the token is not there after 10 seconds, keep looking for a minute, so a slow run is told apart from a missing one.
  let afterLate = after;
  let secondsToAppear: number | null = after > before ? Math.round((Date.now() - answeredAt) / 1000) : null;
  for (let i = 0; afterLate <= before && i < 5; i += 1) {
    await page.waitForTimeout(10_000);
    afterLate = verificationTokenCount(email);
    if (afterLate > before) secondsToAppear = Math.round((Date.now() - answeredAt) / 1000);
  }

  mkdirSync(path.dirname(outFile), { recursive: true });
  const record = {
    before,
    after,
    afterWithinOneMinute: afterLate,
    seenWithinSeconds: secondsToAppear,
    neutralMessageShown: true,
    secondsBetweenRegistrationAndSignIn: Math.round((answeredAt - registeredAt) / 1000),
    ranAt: new Date().toISOString(),
  };
  writeFileSync(outFile, `${JSON.stringify(record, null, 2)}\n`, "utf8");

  expect(after, "a new verification token exists 10 seconds after the sign-in response").toBeGreaterThan(before);
});
