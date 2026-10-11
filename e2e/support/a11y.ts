/**
 * Helpers for the real-browser accessibility sweep (Phase 15, plan 15-19; D-13,
 * NFR-09): the axe runner, the WCAG 2.2 target-size spike, persona sign-in, the
 * guarded fixture resolver that fills route parameters, and the small state
 * actions (failed sign-in, each rate-limit message, operations with failures,
 * privacy before and after anonymisation).
 *
 * Everything that touches the database runs the local-database guard first, so
 * a shell that carries the shared database URL stops with no read or write. No
 * secret lives here: the staff and learner passwords are the seed's development
 * password for `@kqnexus.test` accounts.
 */

import { createHash, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import type { PrismaClient } from "@prisma/client";
import { assertSafeDatabaseUrl } from "../../scripts/ops/db-target-guard";
import type { FixtureKey, Persona, Screen, ScreenState, StateActionId } from "../screens.manifest";

// ---------------------------------------------------------------------------
// axe
// ---------------------------------------------------------------------------

/** The five WCAG tags of D-13. `wcag22aa` is what brings in `target-size` (2.5.8). */
export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] as const;

/**
 * Best-practice landmark rules. They carry no WCAG tag, so tag selection alone
 * would skip them; the jsdom helper in tests/support/axe.ts turns `region` off
 * because jsdom has no layout. In a real browser they run.
 */
export const LANDMARK_RULES = [
  "region",
  "landmark-one-main",
  "landmark-unique",
  "landmark-no-duplicate-banner",
  "landmark-no-duplicate-contentinfo",
  "landmark-no-duplicate-main",
  "landmark-banner-is-top-level",
  "landmark-contentinfo-is-top-level",
  "landmark-main-is-top-level",
  "landmark-complementary-is-top-level",
] as const;

export type AxeFinding = {
  rule: string;
  impact: string;
  help: string;
  helpUrl: string;
  target: string;
  html: string;
  /** Only an inline link inside a table that fails target-size (ledger OQ10, D-07 waiver candidate). */
  waiverCandidate: boolean;
};

function builderFor(page: Page): AxeBuilder {
  const rules: Record<string, { enabled: boolean }> = {};
  for (const id of LANDMARK_RULES) rules[id] = { enabled: true };
  // options() replaces the whole option object, so it must come before withTags(), or the tags are lost.
  // @axe-core/playwright is typed against playwright-core; the runtime object is the same Page.
  const axePage = page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"];
  return new AxeBuilder({ page: axePage }).options({ rules }).withTags([...AXE_TAGS]);
}

async function isInlineTableLink(page: Page, selector: string): Promise<boolean> {
  return page
    .evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el || el.tagName !== "A") return false;
      return el.closest("table, [role='table'], [role='grid']") !== null;
    }, selector)
    .catch(() => false);
}

/** Runs axe with the five WCAG tags plus the landmark rules and returns every violation as a flat list. */
export async function runAxe(page: Page): Promise<AxeFinding[]> {
  const results = await builderFor(page).analyze();
  const findings: AxeFinding[] = [];
  for (const violation of results.violations) {
    for (const node of violation.nodes) {
      const first = node.target[0];
      const selector = typeof first === "string" ? first : JSON.stringify(first);
      const waiverCandidate =
        violation.id === "target-size" && typeof first === "string" && (await isInlineTableLink(page, first));
      findings.push({
        rule: violation.id,
        impact: violation.impact ?? "unknown",
        help: violation.help,
        helpUrl: violation.helpUrl,
        target: node.target.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join(" >> ") || selector,
        html: node.html.slice(0, 200),
        waiverCandidate,
      });
    }
  }
  return findings;
}

/** One line per finding: rule id, impact, target and help URL. */
export function formatFindings(findings: AxeFinding[]): string {
  return findings.map((f) => `${f.rule} (${f.impact}) ${f.target} ${f.helpUrl}`).join("\n");
}

export type SpikeResult = {
  rule: "target-size";
  /** True when axe, selected only by the five tags, reported the deliberately small buttons. */
  flagged: boolean;
  /** True when the same run flagged text with too little contrast (proves color-contrast runs in a real browser). */
  contrastFlagged: boolean;
  /** True when the same run flagged content outside any landmark (proves the landmark rules run). */
  landmarkFlagged: boolean;
  tags: readonly string[];
  fixture: string;
  axeVersion: string;
};

// Two 10 by 10 buttons 4 pixels apart: a lone small target passes by the spacing exception, so the
// rule only reports a small target that has a neighbour inside its 24 pixel circle. The page also
// carries pale grey text on white outside any landmark, for the contrast and landmark proof.
const SPIKE_HTML =
  '<!doctype html><html lang="en"><head><title>target-size spike</title></head>' +
  "<body><main><h1>Target size spike</h1>" +
  '<button type="button" style="width:10px;height:10px;padding:0;border:1px solid #000;font-size:6px;margin:0 4px 0 0">a</button>' +
  '<button type="button" style="width:10px;height:10px;padding:0;border:1px solid #000;font-size:6px;margin:0">b</button>' +
  '</main><p style="color:#cccccc;background:#ffffff">Pale text outside any landmark</p></body></html>';

/** Ledger A8: proves the wcag22aa tag selection really runs the target-size rule. */
export async function runTargetSizeSpike(page: Page): Promise<SpikeResult> {
  await page.setContent(SPIKE_HTML);
  const results = await builderFor(page).analyze();
  const ids = new Set(results.violations.map((v) => v.id));
  return {
    rule: "target-size",
    flagged: ids.has("target-size"),
    contrastFlagged: ids.has("color-contrast"),
    landmarkFlagged: ids.has("region"),
    tags: AXE_TAGS,
    fixture: "two buttons of 10 by 10 CSS pixels, 4 pixels apart, plus pale text outside any landmark",
    axeVersion: results.testEngine.version,
  };
}

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------

const DEV_PASSWORD = "Passw0rd!dev";

const PERSONA_EMAIL: Record<Exclude<Persona, "anonymous">, string> = {
  admin: "admin@kqnexus.test",
  finance: "finance@kqnexus.test",
  instructor: "instructor@kqnexus.test",
  pm: "pm@kqnexus.test",
  learner: "learner4@kqnexus.test",
};

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;
const sessions = new Map<Persona, StorageState>();

/** Signs in through the real form once per persona and keeps the session for later visits. */
async function sessionFor(browser: Browser, baseURL: string, persona: Exclude<Persona, "anonymous">): Promise<StorageState> {
  const cached = sessions.get(persona);
  if (cached) return cached;
  const context = await browser.newContext({ baseURL });
  try {
    const page = await context.newPage();
    await page.goto("/signin");
    await page.getByLabel("Email address").fill(PERSONA_EMAIL[persona]);
    await page.locator('input[name="password"]').fill(DEV_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    // The first sign-in after a server start can take a while (password hashing is memory-heavy).
    await expect(page).toHaveURL(persona === "learner" ? /\/dashboard/ : /\/staff(\/|$)/, { timeout: 45_000 });
    const state = await context.storageState();
    sessions.set(persona, state);
    return state;
  } finally {
    await context.close();
  }
}

/** A fresh browser context for one visit: signed in as the persona, light colours, no animation. */
export async function contextFor(
  browser: Browser,
  baseURL: string,
  persona: Persona,
  size: { width: number; height: number },
): Promise<BrowserContext> {
  const storageState = persona === "anonymous" ? undefined : await sessionFor(browser, baseURL, persona);
  return browser.newContext({
    baseURL,
    storageState,
    viewport: { width: size.width, height: size.height },
    reducedMotion: "reduce",
    colorScheme: "light",
  });
}

/** Waits until the page has its main landmark and no loading skeleton is announcing busy. */
export async function settle(page: Page): Promise<void> {
  await page.locator("main, [data-primary-content]").first().waitFor({ state: "visible", timeout: 30_000 });
  await page
    .waitForFunction(() => document.querySelector('[aria-busy="true"]') === null, undefined, { timeout: 10_000 })
    .catch(() => undefined);
  await page.waitForLoadState("load", { timeout: 30_000 }).catch(() => undefined);
  // Let late client rendering (fonts, hydrated lists) finish before axe measures contrast.
  await page.evaluate(() => document.fonts?.ready).catch(() => undefined);
  await page.waitForTimeout(300);
}

// ---------------------------------------------------------------------------
// Guarded database access and fixtures
// ---------------------------------------------------------------------------

let prismaClient: PrismaClient | null = null;

export async function getPrisma(): Promise<PrismaClient> {
  if (prismaClient) return prismaClient;
  // Guard first. Throws (naming the host only) unless the shell URL is local.
  assertSafeDatabaseUrl(process.env.DATABASE_URL);
  const { PrismaClient: Client } = await import("@prisma/client");
  prismaClient = new Client({ log: ["error"] });
  return prismaClient;
}

export async function disconnectPrisma(): Promise<void> {
  if (prismaClient) await prismaClient.$disconnect();
  prismaClient = null;
}

export type Fixtures = Record<FixtureKey, string> & { learnerUserId: string; privacyUserEmail: string; stamp: string };

function need<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Fixture missing: ${what}. Seed the local database (npx prisma db seed) and run the global setup.`);
  }
  return value;
}

/**
 * Creates the learner the S3 sweep anonymises. A new one for every run, because an
 * anonymised account cannot be put back to its "before" state.
 */
async function createPrivacySubject(prisma: PrismaClient, stamp: string): Promise<{ id: string; email: string }> {
  const email = `a11y-privacy-${stamp}@a11y.test`;
  const user = await prisma.user.create({
    data: {
      email,
      name: `Accessibility Subject ${stamp}`,
      status: "ACTIVE",
      emailVerified: new Date(),
      isStaff: false,
    },
  });
  return { id: user.id, email };
}

async function ensureTicket(prisma: PrismaClient, learnerId: string, staffId: string): Promise<string> {
  const existing = await prisma.ticket.findFirst({ where: { userId: learnerId, subject: "Accessibility sweep ticket" } });
  if (existing) return existing.reference;
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const reference = `KQT-${stamp}-${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  const ticket = await prisma.ticket.create({
    data: {
      reference,
      userId: learnerId,
      category: "TECHNICAL_PROBLEM",
      subject: "Accessibility sweep ticket",
      status: "OPEN",
      queue: "TECHNICAL",
      messages: {
        create: [
          { authorId: learnerId, kind: "INITIAL", visibility: "PUBLIC", body: "I cannot open a lesson video on my phone." },
          { authorId: staffId, kind: "REPLY", visibility: "PUBLIC", body: "Thanks, we are looking into it." },
          { authorId: staffId, kind: "INTERNAL_NOTE", visibility: "INTERNAL", body: "Checked the player logs; nothing found yet." },
        ],
      },
      events: { create: [{ actorId: learnerId, type: "CREATED", statusAfter: "OPEN" }] },
    },
  });
  return ticket.reference;
}

async function ensureReconciliationCase(prisma: PrismaClient): Promise<string> {
  const existing = await prisma.reconciliationCase.findFirst({ orderBy: { openedAt: "asc" }, include: { paymentAttempt: true } });
  const attempt =
    existing?.paymentAttempt ??
    need(await prisma.paymentAttempt.findFirst({ orderBy: { initiatedAt: "asc" } }), "a payment attempt for a reconciliation case");
  // Every order a checkout creates has a correlation id. A seeded order has none, and the case page
  // cannot read a case whose order has none (recorded as a deferred item in the plan 15-19 SUMMARY),
  // so the fixture gives the order one, the way a real order would have it.
  await prisma.order.updateMany({
    where: { id: attempt.orderId, correlationId: null },
    data: { correlationId: `a11y-case-${randomUUID()}` },
  });
  if (existing) return existing.id;
  const evidence = { reason: "Provider settlement evidence was unavailable after 3 attempts." };
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ subject: "PAYMENT", risk: "MISSING_PROVIDER_DATA", evidence }))
    .digest("hex");
  const created = await prisma.reconciliationCase.create({
    data: {
      subject: "PAYMENT",
      risk: "MISSING_PROVIDER_DATA",
      status: "OPEN",
      paymentAttemptId: attempt.id,
      evidence,
      evidenceFingerprint: fingerprint,
      lastEvidenceAt: new Date(),
      events: { create: [{ type: "OPENED", actorType: "SYSTEM", evidence, fingerprint }] },
    },
  });
  return created.id;
}

/** Looks up (and where a screen needs one, creates) the records the manifest's route parameters name. */
export async function resolveFixtures(): Promise<Fixtures> {
  const prisma = await getPrisma();
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

  const learner = need(await prisma.user.findUnique({ where: { email: PERSONA_EMAIL.learner } }), "the seeded learner");
  const admin = need(await prisma.user.findUnique({ where: { email: PERSONA_EMAIL.admin } }), "the seeded administrator");

  const course = need(
    await prisma.course.findFirst({ where: { status: "PUBLISHED", publiclyListed: true }, orderBy: { createdAt: "asc" } }),
    "a published, publicly listed course",
  );
  const programme = need(
    await prisma.programme.findFirst({ where: { status: "PUBLISHED" }, orderBy: { createdAt: "asc" } }),
    "a published programme",
  );
  const draftProgramme = (await prisma.programme.findFirst({ where: { status: "DRAFT" }, orderBy: { createdAt: "asc" } })) ?? programme;

  // The learner's own active enrolment, its cohort and a lesson of the cohort's course.
  const enrolment = need(
    await prisma.enrolment.findFirst({ where: { userId: learner.id, status: "ACTIVE" }, orderBy: { createdAt: "asc" } }),
    "an active enrolment for the seeded learner",
  );
  const cohortCourse = need(
    await prisma.cohortCourse.findFirst({ where: { cohortId: enrolment.cohortId }, orderBy: { position: "asc" } }),
    "the cohort's course",
  );
  const courseModule = need(
    await prisma.module.findFirst({
      where: { courseId: cohortCourse.courseId, withdrawnAt: null },
      orderBy: { position: "asc" },
    }),
    "a module in the cohort's course",
  );
  const lesson = need(
    await prisma.lesson.findFirst({
      where: { module: { courseId: cohortCourse.courseId }, position: { gte: 0 } },
      orderBy: [{ module: { position: "asc" } }, { position: "asc" }],
    }),
    "a lesson in the cohort's course",
  );
  const session = need(
    await prisma.scheduledSession.findFirst({ where: { cohortId: enrolment.cohortId }, orderBy: { startsAt: "asc" } }),
    "a scheduled session",
  );

  // Grading: a submission, with its assignment and the cohort it was made in.
  const submission = need(await prisma.submission.findFirst({ include: { enrolment: true }, orderBy: { submittedAt: "asc" } }), "a submission");
  const assessment = need(await prisma.assessment.findUnique({ where: { id: submission.assessmentId } }), "the submission's assessment");

  const draftCohort = (await prisma.cohort.findFirst({ where: { status: "DRAFT" }, orderBy: { createdAt: "asc" } })) ?? null;
  const openCohort =
    (await prisma.cohort.findFirst({ where: { code: "JOURNEY-VERIFY-2026" } })) ??
    need(await prisma.cohort.findFirst({ where: { status: "PUBLISHED" } }), "a published cohort");

  const order = need(await prisma.order.findFirst({ where: { userId: learner.id, status: "PAID" } }), "a paid order of the seeded learner");
  const certificate = need(await prisma.certificate.findFirst({ where: { status: "ACTIVE" }, orderBy: { issuedAt: "asc" } }), "an active certificate");
  const template = need(await prisma.certificateTemplate.findFirst({ where: { archivedAt: null }, orderBy: { createdAt: "asc" } }), "a certificate template");
  const role = need(await prisma.role.findFirst({ where: { name: "Instructor" } }), "the Instructor role");

  const caseId = await ensureReconciliationCase(prisma);
  const ticketReference = await ensureTicket(prisma, learner.id, admin.id);
  const privacy = await createPrivacySubject(prisma, stamp);

  return {
    stamp,
    learnerUserId: learner.id,
    privacyUserEmail: privacy.email,
    courseSlug: course.slug,
    programmeSlug: programme.slug,
    verificationRef: certificate.verificationRef,
    cohortId: enrolment.cohortId,
    draftCohortId: draftCohort?.id ?? enrolment.cohortId,
    openCohortId: openCohort.id,
    sessionId: session.id,
    gradingCohortId: submission.enrolment.cohortId,
    gradingAssessmentId: assessment.id,
    submissionId: submission.id,
    gradingEnrolmentId: submission.enrolmentId,
    courseId: cohortCourse.courseId,
    lessonId: lesson.id,
    moduleId: courseModule.id,
    assessmentId: assessment.id,
    programmeId: draftProgramme.id,
    orderId: order.id,
    caseId,
    roleId: role.id,
    userId: learner.id,
    templateId: template.id,
    certificateId: certificate.id,
    ownEnrolmentId: enrolment.id,
    ownLessonId: lesson.id,
    ownOrderReference: order.reference,
    pendingOrderId: "", // filled by ensurePendingOrder once a browser exists
    ownTicketReference: ticketReference,
    staffTicketReference: ticketReference,
    privacyUserId: privacy.id,
  };
}

/** Starts a real checkout as the learner so the order and confirming screens have a pending order. */
export async function ensurePendingOrder(browser: Browser, baseURL: string, fixtures: Fixtures, courseSlug: string): Promise<void> {
  const context = await contextFor(browser, baseURL, "learner", { width: 1440, height: 900 });
  try {
    const page = await context.newPage();
    await page.goto(`/courses/${courseSlug}`);
    const pay = page.getByRole("button", { name: /^Pay in NGN/ }).first();
    await pay.click();
    await expect(page).toHaveURL(/\/checkout\/[^/?]+$/, { timeout: 45_000 });
    fixtures.pendingOrderId = new URL(page.url()).pathname.split("/").pop() ?? "";
    if (!fixtures.pendingOrderId) throw new Error("Could not read the pending order id from the checkout URL.");
  } finally {
    await context.close();
  }
}

/** Fills the route template's `[param]` segments from the fixtures. */
export function urlFor(screen: Screen, state: ScreenState, fixtures: Fixtures): string {
  const path = screen.route.replace(/\[(\w+)\]/g, (_match, name: string) => {
    const source = screen.params?.[name];
    if (!source) throw new Error(`Screen ${screen.id}: route parameter [${name}] has no fixture in the manifest.`);
    if (source.startsWith("=")) return encodeURIComponent(source.slice(1));
    const value = fixtures[source as FixtureKey];
    if (!value) throw new Error(`Screen ${screen.id}: fixture ${source} is empty.`);
    return encodeURIComponent(value);
  });
  let query = state.query ?? "";
  for (const [name, key] of Object.entries(state.queryFrom ?? {})) {
    const value = fixtures[key];
    if (!value) throw new Error(`Screen ${screen.id}: fixture ${key} is empty.`);
    query += `${query === "" ? "?" : "&"}${name}=${encodeURIComponent(value)}`;
  }
  return `${path}${query}`;
}

// ---------------------------------------------------------------------------
// State actions
// ---------------------------------------------------------------------------

type ActionContext = { page: Page; fixtures: Fixtures; throttleKeys: string[]; cleanups: Array<() => Promise<void>> };

type StateAction = {
  /** Runs before the page is opened (seeding, request headers). */
  prepare?: (ctx: ActionContext) => Promise<void>;
  /** Runs on the opened page and returns once the state is on screen. */
  run?: (ctx: ActionContext) => Promise<void>;
};

async function seedThrottle(ctx: ActionContext, key: string, email: string | null, failures: number): Promise<void> {
  const prisma = await getPrisma();
  const now = new Date();
  await prisma.loginThrottle.upsert({
    where: { key },
    update: { failures, windowStartedAt: now, email },
    create: { key, email, failures, windowStartedAt: now },
  });
  ctx.throttleKeys.push(key);
}

/** Removes the counters a state seeded, so the next screen and the next run start clean. */
export async function clearThrottles(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const prisma = await getPrisma();
  await prisma.loginThrottle.deleteMany({ where: { key: { in: keys } } });
}

function limitedAddress(ctx: ActionContext, scope: string): string {
  return `a11y-${scope}-${ctx.fixtures.stamp}@a11y.test`;
}

async function expectAlert(page: Page, text: RegExp | string): Promise<void> {
  await expect(page.getByRole("alert").filter({ hasText: text }).first()).toBeVisible({ timeout: 15_000 });
}

const ACTIONS: Record<StateActionId, StateAction> = {
  "signin-failed": {
    async run({ page }) {
      await page.getByLabel("Email address").fill("nobody@a11y.test");
      await page.locator('input[name="password"]').fill("Wrong-password-1");
      await page.getByRole("button", { name: "Sign in" }).click();
      await expectAlert(page, "Those details do not match an account");
    },
  },
  "signin-empty": {
    async run({ page }) {
      await page.evaluate(() => document.querySelectorAll("form").forEach((form) => (form.noValidate = true)));
      await page.getByRole("button", { name: "Sign in" }).click();
      await expectAlert(page, "Enter your email address and password");
    },
  },
  "signin-throttled": {
    async prepare(ctx) {
      const email = limitedAddress(ctx, "signin");
      await seedThrottle(ctx, `email:${email}`, email, 5);
    },
    async run(ctx) {
      await ctx.page.getByLabel("Email address").fill(limitedAddress(ctx, "signin"));
      await ctx.page.locator('input[name="password"]').fill("Wrong-password-1");
      await ctx.page.getByRole("button", { name: "Sign in" }).click();
      await expectAlert(ctx.page, "Too many sign-in attempts");
    },
  },
  "register-limited": {
    async prepare(ctx) {
      const email = limitedAddress(ctx, "register");
      await seedThrottle(ctx, `register:email:${email}`, email, 30);
    },
    async run(ctx) {
      const { page } = ctx;
      await page.getByLabel("Full name").fill("Limited Visitor");
      await page.getByLabel("Email address").fill(limitedAddress(ctx, "register"));
      await page.locator('input[name="password"]').fill("A-long-enough-password-1");
      await page.getByRole("checkbox", { name: /terms of service/ }).check();
      await page.getByRole("checkbox", { name: /privacy notice/ }).check();
      await page.getByRole("button", { name: "Create account" }).click();
      await expectAlert(page, "Too many sign-up attempts");
    },
  },
  "forgot-limited": {
    async prepare(ctx) {
      const email = limitedAddress(ctx, "forgot");
      await seedThrottle(ctx, `forgot:email:${email}`, email, 20);
    },
    async run(ctx) {
      await ctx.page.getByLabel("Email address").fill(limitedAddress(ctx, "forgot"));
      await ctx.page.getByRole("button", { name: "Send reset link" }).click();
      await expectAlert(ctx.page, "Too many reset requests");
    },
  },
  "verify-resend-limited": {
    async prepare(ctx) {
      const email = limitedAddress(ctx, "resend");
      await seedThrottle(ctx, `resend:email:${email}`, email, 20);
    },
    async run(ctx) {
      await ctx.page.getByLabel("Email address").fill(limitedAddress(ctx, "resend"));
      await ctx.page.getByRole("button", { name: "Resend verification email" }).click();
      await expectAlert(ctx.page, "Too many requests for a new link");
    },
  },
  "cert-check-limited": {
    async prepare(ctx) {
      // The limiter keys on the platform's client-address header; a local run sends it by hand.
      const ip = "203.0.113.77";
      await seedThrottle(ctx, `cert-check:ip:${ip}`, null, 60);
      await ctx.page.context().setExtraHTTPHeaders({ "x-nf-client-connection-ip": ip });
    },
    async run({ page }) {
      await expect(page.getByText("Too many checks from this device").first()).toBeVisible({ timeout: 15_000 });
    },
  },
  "ticket-limited": {
    async prepare(ctx) {
      await seedThrottle(ctx, `ticket:user:${ctx.fixtures.learnerUserId}`, null, 5);
    },
    async run({ page }) {
      await page.getByLabel("Category").selectOption({ index: 1 });
      await page.getByLabel("Subject").fill("Cannot open my certificate");
      await page.getByLabel("Message").fill("The certificate page shows an error when I open it.");
      await page.getByRole("button", { name: "Create ticket" }).click();
      await expectAlert(page, "several requests in a short time");
    },
  },
  "submit-invalid": {
    async run({ page }) {
      await page.evaluate(() => document.querySelectorAll("form").forEach((form) => (form.noValidate = true)));
      await page.locator("main form button[type='submit']").first().click();
      await expect(page.locator("[role='alert']:visible, [aria-invalid='true']").first()).toBeVisible({ timeout: 10_000 });
    },
  },
  "ops-all-clear": {
    async prepare(ctx) {
      ctx.cleanups.push(await setOperationsClear(await getPrisma()));
    },
    async run({ page }) {
      await expect(page.getByText("All clear").first()).toBeVisible({ timeout: 15_000 });
    },
  },
  "ops-with-failures": {
    async prepare(ctx) {
      ctx.cleanups.push(await setOperationsWithFailures(await getPrisma(), ctx.fixtures));
    },
    async run({ page }) {
      await expect(page.getByText("Needs attention").first()).toBeVisible({ timeout: 15_000 });
    },
  },
  "privacy-anonymise-modal": {
    async run({ page, fixtures }) {
      await page.getByLabel("Type the learner's email address to confirm").fill(fixtures.privacyUserEmail);
      await page.getByRole("button", { name: "Anonymise account" }).click();
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
    },
  },
  "privacy-anonymised": {
    async run({ page, fixtures }) {
      const confirm = page.getByLabel("Type the learner's email address to confirm");
      // The first width anonymises through the screen; the second only looks at the finished record.
      if (await confirm.isVisible().catch(() => false)) {
        await confirm.fill(fixtures.privacyUserEmail);
        await page.getByRole("button", { name: "Anonymise account" }).click();
        const dialog = page.getByRole("dialog");
        await dialog.getByRole("textbox").fill("Accessibility sweep: learner data request A11Y-0001.");
        await dialog.getByRole("button", { name: "Anonymise account" }).click();
        await expect(page.getByText("Account anonymised").first()).toBeVisible({ timeout: 20_000 });
        await page.reload();
      }
      await expect(page.getByText(/This account was anonymised on/).first()).toBeVisible({ timeout: 15_000 });
    },
  },
};

export function actionFor(id: StateActionId): StateAction {
  return ACTIONS[id];
}

export type ActionRun = { cleanup: () => Promise<void>; run: () => Promise<void> };

/** Prepares a state's action for one visit; `run` is called once the page is open. */
export async function prepareAction(
  id: StateActionId,
  page: Page,
  fixtures: Fixtures,
): Promise<ActionRun> {
  const ctx: ActionContext = { page, fixtures, throttleKeys: [], cleanups: [] };
  const action = actionFor(id);
  await action.prepare?.(ctx);
  return {
    run: async () => {
      await action.run?.(ctx);
    },
    cleanup: async () => {
      await clearThrottles(ctx.throttleKeys);
      for (const undo of ctx.cleanups.reverse()) await undo();
    },
  };
}


// ---------------------------------------------------------------------------
// Operations status data (S1)
// ---------------------------------------------------------------------------

type Undo = () => Promise<void>;

/** Applies a change to rows and records how to put every row back as it was. */
async function changeRows<T extends { id: string }>(
  rows: T[],
  apply: (ids: string[]) => Promise<unknown>,
  restore: (row: T) => Promise<unknown>,
  undos: Undo[],
): Promise<void> {
  if (rows.length === 0) return;
  await apply(rows.map((row) => row.id));
  undos.push(async () => {
    // Chunks of parallel updates: a rehearsal database seeded with the volume data holds
    // thousands of rows here, and one-by-one restores outlasted the screen's test timeout.
    const chunkSize = 20;
    for (let i = 0; i < rows.length; i += chunkSize) {
      await Promise.all(rows.slice(i, i + chunkSize).map((row) => restore(row)));
    }
  });
}

/**
 * Makes the operations page read "All clear" by setting aside every source of attention the page
 * counts (exception orders, failed webhooks and refunds, open reconciliation cases, unprocessed or
 * stopped events, failed or stale exports, expired holds, abandoned uploads, resolved tickets
 * waiting to close, failed emails, a stale licence check). Each row is remembered and put back by
 * the returned function, so the other screens see the data they had.
 */
export async function setOperationsClear(prisma: PrismaClient): Promise<Undo> {
  const undos: Undo[] = [];
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 86_400_000);

  await changeRows(
    await prisma.order.findMany({ where: { status: "EXCEPTION" }, select: { id: true } }),
    (ids) => prisma.order.updateMany({ where: { id: { in: ids } }, data: { status: "FAILED" } }),
    (row) => prisma.order.update({ where: { id: row.id }, data: { status: "EXCEPTION" } }),
    undos,
  );
  await changeRows(
    await prisma.webhookEvent.findMany({ where: { status: { in: ["SIGNATURE_INVALID", "EXCEPTION"] } }, select: { id: true, status: true } }),
    (ids) => prisma.webhookEvent.updateMany({ where: { id: { in: ids } }, data: { status: "PROCESSED" } }),
    (row) => prisma.webhookEvent.update({ where: { id: row.id }, data: { status: row.status } }),
    undos,
  );
  await changeRows(
    await prisma.refund.findMany({ where: { status: "FAILED" }, select: { id: true } }),
    (ids) => prisma.refund.updateMany({ where: { id: { in: ids } }, data: { status: "COMPLETED" } }),
    (row) => prisma.refund.update({ where: { id: row.id }, data: { status: "FAILED" } }),
    undos,
  );
  await changeRows(
    await prisma.paymentAttempt.findMany({ where: { status: "PROCESSING" }, select: { id: true } }),
    (ids) => prisma.paymentAttempt.updateMany({ where: { id: { in: ids } }, data: { status: "FAILED" } }),
    (row) => prisma.paymentAttempt.update({ where: { id: row.id }, data: { status: "PROCESSING" } }),
    undos,
  );
  await changeRows(
    await prisma.paymentAttempt.findMany({
      where: { status: "SUCCEEDED", reconciledAt: null, provider: { in: ["PAYSTACK", "STRIPE"] } },
      select: { id: true },
    }),
    (ids) => prisma.paymentAttempt.updateMany({ where: { id: { in: ids } }, data: { reconciledAt: now } }),
    (row) => prisma.paymentAttempt.update({ where: { id: row.id }, data: { reconciledAt: null } }),
    undos,
  );
  await changeRows(
    await prisma.reconciliationCase.findMany({ where: { status: { in: ["OPEN", "REOPENED"] } }, select: { id: true, status: true } }),
    (ids) => prisma.reconciliationCase.updateMany({ where: { id: { in: ids } }, data: { status: "RESOLVED" } }),
    (row) => prisma.reconciliationCase.update({ where: { id: row.id }, data: { status: row.status } }),
    undos,
  );
  await changeRows(
    await prisma.domainEvent.findMany({ where: { processedAt: { not: null }, lastError: { not: null } }, select: { id: true, lastError: true } }),
    (ids) => prisma.domainEvent.updateMany({ where: { id: { in: ids } }, data: { lastError: null } }),
    (row) => prisma.domainEvent.update({ where: { id: row.id }, data: { lastError: row.lastError } }),
    undos,
  );
  await changeRows(
    await prisma.domainEvent.findMany({ where: { processedAt: null }, select: { id: true } }),
    (ids) => prisma.domainEvent.updateMany({ where: { id: { in: ids } }, data: { processedAt: now } }),
    (row) => prisma.domainEvent.update({ where: { id: row.id }, data: { processedAt: null } }),
    undos,
  );
  await changeRows(
    await prisma.exportJob.findMany({
      where: {
        OR: [
          { status: "FAILED", retries: { none: {} } },
          { status: { in: ["QUEUED", "PROCESSING"] } },
          { status: "SUCCEEDED", storageKey: { not: null }, expiresAt: { lte: now } },
        ],
      },
      select: { id: true, status: true },
    }),
    (ids) => prisma.exportJob.updateMany({ where: { id: { in: ids } }, data: { status: "EXPIRED" } }),
    (row) => prisma.exportJob.update({ where: { id: row.id }, data: { status: row.status } }),
    undos,
  );
  await changeRows(
    await prisma.enrolment.findMany({
      where: { status: "PENDING_PAYMENT", holdExpiresAt: { not: null, lt: now } },
      select: { id: true, holdExpiresAt: true },
    }),
    (ids) => prisma.enrolment.updateMany({ where: { id: { in: ids } }, data: { holdExpiresAt: tomorrow } }),
    (row) => prisma.enrolment.update({ where: { id: row.id }, data: { holdExpiresAt: row.holdExpiresAt } }),
    undos,
  );
  await changeRows(
    await prisma.lessonResource.findMany({ where: { uploadStatus: "UPLOADING" }, select: { id: true } }),
    (ids) => prisma.lessonResource.updateMany({ where: { id: { in: ids } }, data: { uploadStatus: "READY" } }),
    (row) => prisma.lessonResource.update({ where: { id: row.id }, data: { uploadStatus: "UPLOADING" } }),
    undos,
  );
  await changeRows(
    await prisma.ticketAttachment.findMany({ where: { uploadStatus: "UPLOADING" }, select: { id: true } }),
    (ids) => prisma.ticketAttachment.updateMany({ where: { id: { in: ids } }, data: { uploadStatus: "READY" } }),
    (row) => prisma.ticketAttachment.update({ where: { id: row.id }, data: { uploadStatus: "UPLOADING" } }),
    undos,
  );
  await changeRows(
    await prisma.ticket.findMany({ where: { status: "RESOLVED" }, select: { id: true, resolvedAt: true } }),
    (ids) => prisma.ticket.updateMany({ where: { id: { in: ids } }, data: { resolvedAt: now } }),
    (row) => prisma.ticket.update({ where: { id: row.id }, data: { resolvedAt: row.resolvedAt } }),
    undos,
  );
  await changeRows(
    await prisma.emailDispatch.findMany({ where: { status: { in: ["FAILED", "SENDING"] } }, select: { id: true, status: true } }),
    (ids) => prisma.emailDispatch.updateMany({ where: { id: { in: ids } }, data: { status: "SENT" } }),
    (row) => prisma.emailDispatch.update({ where: { id: row.id }, data: { status: row.status } }),
    undos,
  );
  const licence = await prisma.licenceState.findUnique({ where: { id: "current" }, select: { id: true, lastVerifiedAt: true } });
  if (licence?.lastVerifiedAt) {
    await changeRows(
      [licence],
      () => prisma.licenceState.update({ where: { id: "current" }, data: { lastVerifiedAt: now } }),
      (row) => prisma.licenceState.update({ where: { id: "current" }, data: { lastVerifiedAt: row.lastVerifiedAt } }),
      undos,
    );
  }

  return async () => {
    for (const undo of undos.reverse()) await undo();
  };
}

/**
 * Adds a failed export, a stopped background event and a failed email on top of whatever the
 * database already holds (the seed has an exception order, and the sweep opens a reconciliation
 * case), so every section of the page has something in it. The returned function removes the rows.
 */
export async function setOperationsWithFailures(prisma: PrismaClient, fixtures: Fixtures): Promise<Undo> {
  const admin = need(await prisma.user.findUnique({ where: { email: PERSONA_EMAIL.admin } }), "the seeded administrator");
  const now = new Date();
  const exportJob = await prisma.exportJob.create({
    data: { requestedById: admin.id, dataset: "payments", status: "FAILED", completedAt: now, errorCode: "EXPORT_FAILED" },
  });
  const event = await prisma.domainEvent.create({
    data: { type: "order.paid", payload: {}, occurredAt: now, processedAt: now, attempts: 5, lastError: "handler failed" },
  });
  const email = await prisma.emailDispatch.create({
    data: {
      template: "enrolment-confirmation",
      toEmail: `a11y-failed-${fixtures.stamp}@a11y.test`,
      correlationId: `a11y-${fixtures.stamp}`,
      status: "FAILED",
      attempts: 5,
      lastAttemptAt: now,
      failedAt: now,
      error: "provider refused",
    },
  });
  return async () => {
    await prisma.exportJob.deleteMany({ where: { id: exportJob.id } });
    await prisma.domainEvent.deleteMany({ where: { id: event.id } });
    await prisma.emailDispatch.deleteMany({ where: { id: email.id } });
  };
}
