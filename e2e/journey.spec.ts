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
 */

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

type CapturedMessage = { to: string; subject: string; html: string; text: string };

const PASSWORD = "Journey-pass-2026!";

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
  const ids = loadJourneyIds();
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
    const finance = await openStaffSession(browser, baseURL, "finance");
    try {
      await confirmManualPayment(finance, orderId);
    } finally {
      await finance.context().close();
    }
    // Enrolment emails and events are asynchronous: drain them, then look at what the learner sees.
    runTask("drain-domain-events");
  });

  let enrolmentId = "";
  await test.step("learn: open the course from the dashboard", async () => {
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
    const instructor = await openStaffSession(browser, baseURL, "instructor");
    try {
      await markAttendance(instructor, ids.cohortId, ids.sessionId, learnerName);
    } finally {
      await instructor.context().close();
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
    const instructor = await openStaffSession(browser, baseURL, "instructor");
    try {
      await gradeAndRelease(instructor, ids.cohortId, ids.assessmentId, learnerName, 80);
    } finally {
      await instructor.context().close();
    }
  });

  let verificationRef = "";
  let certificateHref = "";
  await test.step("complete: drain background work until the certificate is available", async () => {
    const download = page.getByRole("link", { name: "Download certificate" });
    await expect
      .poll(
        async () => {
          runTask("drain-domain-events");
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
