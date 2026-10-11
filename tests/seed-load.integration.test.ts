/**
 * Real-Postgres proof for the pilot-load seeder (plan 15-14, D-02, NFR-02).
 *
 * The seeder creates the load accounts the k6 pilot load signs in as, so the
 * things that matter are: the sessions it writes really resolve to an actor
 * through the production lookup, a re-run changes nothing but the sessions,
 * the one password is hashed once, volume data keeps its proportions, and a
 * non-local database is refused before any connection opens (P1, T-15-14-01).
 *
 * `seedLoad` takes the client as an argument, so it runs here against the
 * Testcontainers database. The one thing that needs the app's own Prisma
 * singleton, `getActorBySessionToken`, is imported dynamically AFTER
 * `process.env.DATABASE_URL` points at the container (same discipline as the
 * other integration suites).
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails with a
 * container-start error and every case reports BLOCKED - the expected failure
 * mode, never a silent pass.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { seedCohortFixture } from "./support/cohort-fixtures";
import {
  learnerEmail,
  seedLoad,
  staffEmail,
  VOLUME_ORDERS,
  VOLUME_TICKETS,
  type SeedLoadOptions,
} from "../scripts/load/seed-load";

const DEFAULT_SEED_PASSWORD = ["Passw0rd", "dev"].join("!");
const COHORT_CODES = ["LOADTEST-A", "LOADTEST-B"] as const;

let testDb: TestDatabase;
let courseId: string;
let lessonId: string;

function options(overrides: Partial<SeedLoadOptions> = {}): SeedLoadOptions {
  return {
    learners: 5,
    staff: 1,
    volume: false,
    volumeScale: 1,
    pendingOrder: false,
    cohortCodes: COHORT_CODES,
    now: new Date(),
    ...overrides,
  };
}

beforeAll(async () => {
  testDb = await startTestDatabase();
  const { prisma } = testDb;

  await prisma.role.create({
    data: { name: "Administrator", description: "Test administrator", permissions: ["users.view"], isDefault: true, active: true, version: 1 },
  });

  // Capacity 1 on purpose: the seeder must raise it to fit its learners.
  const a = await seedCohortFixture(prisma, { code: COHORT_CODES[0], capacity: 1, priceNgnMinor: 5_000_000, priceMinor: 5_000_000 });
  await seedCohortFixture(prisma, { code: COHORT_CODES[1], capacity: 1, priceNgnMinor: 7_000_000, priceMinor: 7_000_000 });
  courseId = a.courseId;
  const mod = await prisma.module.create({ data: { courseId, title: "Module 1", position: 1 } });
  const lesson = await prisma.lesson.create({
    data: { moduleId: mod.id, title: "Lesson 1.1", type: "TEXT", position: 1, body: "Reading." },
  });
  lessonId = lesson.id;
  await prisma.cohortCourse.create({ data: { cohortId: a.cohortId, courseId, position: 1, contentVersion: 1 } });

  process.env.DATABASE_URL = testDb.url;
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

describe("seed-load against a real database", () => {
  it("creates learners, staff, active enrolments and sessions whose raw tokens resolve to the right actor", async () => {
    const { prisma } = testDb;
    const result = await seedLoad(prisma, options());

    expect(result.learners).toBe(5);
    expect(result.staff).toBe(1);
    expect(result.sessions).toBe(6);

    const users = await prisma.user.findMany({
      where: { email: { endsWith: "@load.test" } },
      select: { id: true, email: true, isStaff: true, status: true, passwordHash: true, emailVerified: true },
    });
    expect(users).toHaveLength(6);
    expect(users.every((user) => user.status === "ACTIVE" && user.emailVerified !== null)).toBe(true);
    expect(users.filter((user) => user.isStaff)).toHaveLength(1);

    // One password, hashed once: every account carries the same stored hash.
    expect(new Set(users.map((user) => user.passwordHash)).size).toBe(1);
    expect(users[0].passwordHash).toMatch(/^scrypt\$/);
    // Never the default seed password; the password lives only in the tokens object.
    expect(result.tokens.password).not.toBe(DEFAULT_SEED_PASSWORD);
    expect(result.tokens.password.length).toBeGreaterThanOrEqual(20);

    // Staff hold the Administrator role globally.
    const staff = users.find((user) => user.isStaff)!;
    expect(staff.email).toBe(staffEmail(1));
    const assignment = await prisma.assignment.findFirst({
      where: { userId: staff.id, scopeType: "GLOBAL", active: true, role: { name: "Administrator" } },
    });
    expect(assignment).not.toBeNull();

    // Active enrolments for all 5 learners, spread over the two cohorts.
    const enrolments = await prisma.enrolment.findMany({
      where: { user: { email: { startsWith: "load-learner-" } } },
      select: { status: true, cohortId: true, userId: true },
    });
    expect(enrolments).toHaveLength(5);
    expect(enrolments.every((row) => row.status === "ACTIVE")).toBe(true);
    expect(new Set(enrolments.map((row) => row.cohortId)).size).toBe(2);

    // Capacity was raised to fit and seatsTaken matches the real rows.
    for (const seat of result.cohorts) {
      expect(seat.capacity).toBeGreaterThanOrEqual(seat.seatsTaken);
    }
    expect(result.cohorts.reduce((sum, seat) => sum + seat.seatsTaken, 0)).toBe(5);

    // Raw tokens resolve through the production lookup; the stored value is the hash.
    const { getActorBySessionToken } = await import("@/server/services/session-service");
    const learnerActor = await getActorBySessionToken(result.tokens.learners[0]);
    const learnerUser = users.find((user) => user.email === learnerEmail(1))!;
    expect(learnerActor).toEqual({ userId: learnerUser.id, isStaff: false });
    const staffActor = await getActorBySessionToken(result.tokens.staff[0]);
    expect(staffActor).toEqual({ userId: staff.id, isStaff: true });
    const stored = await prisma.session.findMany({ select: { sessionToken: true } });
    expect(stored.map((row) => row.sessionToken)).not.toContain(result.tokens.learners[0]);

    // The ids the k6 scripts need.
    expect(result.tokens.learnerContext).toHaveLength(5);
    expect(result.tokens.learnerContext.every((context) => context.enrolmentId.length > 0)).toBe(true);
    const withLesson = result.tokens.learnerContext.filter((context) => context.lessonIds.includes(lessonId));
    expect(withLesson.length).toBeGreaterThan(0);
    expect(result.tokens.ids.cohortId).not.toBeNull();
  }, 60_000);

  it("is idempotent: a second run keeps the same accounts and enrolments and issues fresh working tokens", async () => {
    const { prisma } = testDb;
    const first = await seedLoad(prisma, options());
    const second = await seedLoad(prisma, options());

    expect(await prisma.user.count({ where: { email: { endsWith: "@load.test" } } })).toBe(6);
    expect(await prisma.enrolment.count({ where: { user: { email: { startsWith: "load-learner-" } } } })).toBe(5);
    expect(await prisma.session.count({ where: { user: { email: { endsWith: "@load.test" } } } })).toBe(6);

    const { getActorBySessionToken } = await import("@/server/services/session-service");
    expect(await getActorBySessionToken(first.tokens.learners[0])).toBeNull();
    expect(await getActorBySessionToken(second.tokens.learners[0])).not.toBeNull();
    expect(second.tokens.password).not.toBe(first.tokens.password);
  }, 60_000);

  it("adds orders and tickets in the 5,000 : 2,000 proportion, with payments for the orders, and is repeatable", async () => {
    const { prisma } = testDb;
    const scale = 0.01;
    const first = await seedLoad(prisma, options({ volume: true, volumeScale: scale }));
    expect(first.volume).toEqual({ orders: VOLUME_ORDERS * scale, tickets: VOLUME_TICKETS * scale });

    const orders = await prisma.order.count({ where: { reference: { startsWith: "LOAD-ORD-" } } });
    const tickets = await prisma.ticket.count({ where: { reference: { startsWith: "LOAD-TKT-" } } });
    expect(orders).toBe(50);
    expect(tickets).toBe(20);
    expect(orders / tickets).toBeCloseTo(VOLUME_ORDERS / VOLUME_TICKETS, 5);

    // Every order has an attempt, and a PAID order's attempt SUCCEEDED (the integrity check relies on this).
    expect(await prisma.paymentAttempt.count({ where: { order: { reference: { startsWith: "LOAD-ORD-" } } } })).toBe(50);
    const paidWithoutSuccess = await prisma.order.count({
      where: {
        reference: { startsWith: "LOAD-ORD-" },
        status: "PAID",
        paymentAttempts: { none: { status: "SUCCEEDED" } },
      },
    });
    expect(paidWithoutSuccess).toBe(0);
    const statuses = await prisma.order.groupBy({ by: ["status"], where: { reference: { startsWith: "LOAD-ORD-" } } });
    expect(statuses.length).toBeGreaterThan(1);
    expect(await prisma.ticketMessage.count({ where: { ticket: { reference: { startsWith: "LOAD-TKT-" } } } })).toBe(20);

    await seedLoad(prisma, options({ volume: true, volumeScale: scale }));
    expect(await prisma.order.count({ where: { reference: { startsWith: "LOAD-ORD-" } } })).toBe(50);
    expect(await prisma.ticket.count({ where: { reference: { startsWith: "LOAD-TKT-" } } })).toBe(20);
  }, 60_000);

  it("--pending-order creates a pending order, its payment attempt and a held seat for the webhook replay", async () => {
    const { prisma } = testDb;
    const result = await seedLoad(prisma, options({ learners: 0, staff: 0, pendingOrder: true }));
    const pending = result.pendingOrder!;
    expect(pending.reference).toMatch(/^LOAD-PENDING-/);

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: pending.orderId },
      include: { paymentAttempts: true, enrolments: true },
    });
    expect(order.status).toBe("PENDING");
    expect(order.amountMinor).toBe(pending.amountMinor);
    expect(order.paymentAttempts).toHaveLength(1);
    expect(order.paymentAttempts[0]).toMatchObject({ status: "PROCESSING", provider: "PAYSTACK", providerIntentId: pending.reference });
    expect(order.enrolments).toHaveLength(1);
    expect(order.enrolments[0].status).toBe("PENDING_PAYMENT");
    expect(order.enrolments[0].holdExpiresAt).not.toBeNull();

    const cohort = await prisma.cohort.findUniqueOrThrow({ where: { id: order.cohortId } });
    expect(cohort.seatsTaken).toBeLessThanOrEqual(cohort.capacity);
  }, 60_000);
});

describe("seed-load safety", () => {
  const PASSWORD = "s3cretPassw0rd";
  const NEON_URL = `postgresql://neondb_owner:${PASSWORD}@ep-quiet-bird-a1b2c3.eu-central-1.aws.neon.tech/neondb?sslmode=require`;
  const TSX_CLI = path.resolve(__dirname, "..", "node_modules", "tsx", "dist", "cli.mjs");
  const SCRIPT = path.resolve(__dirname, "..", "scripts", "load", "seed-load.ts");

  function run(databaseUrl: string | undefined, extra: string[] = []) {
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (databaseUrl === undefined) delete env.DATABASE_URL;
    else env.DATABASE_URL = databaseUrl;
    return spawnSync(process.execPath, [TSX_CLI, SCRIPT, "--learners", "1", "--staff", "0", ...extra], {
      env,
      encoding: "utf8",
      timeout: 60_000,
    });
  }

  it("exits non-zero before touching any database when DATABASE_URL names a remote host, and never prints the password", () => {
    const result = run(NEON_URL);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Refusing to run");
    expect(`${result.stdout}${result.stderr}`).not.toContain(PASSWORD);
    expect(result.stdout).not.toContain("seed-load on");
  }, 90_000);

  it("refuses an unset DATABASE_URL instead of falling back to .env", () => {
    const result = run(undefined);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DATABASE_URL is unset");
  }, 90_000);

  it("refuses the staging target without the explicit host list and flag", () => {
    const result = run(NEON_URL, ["--target", "staging"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("STAGING_DATABASE_HOSTS");
  }, 90_000);
});
