/**
 * Real-Postgres concurrency proof for completion records (plan 15-12,
 * NFR-03 / NFR-14).
 *
 * `applyVerdict` in `completion-service.ts` reads the open CompletionRecord
 * for (enrolment, scope, course) and creates one when none exists. Two
 * completion evaluations for the same enrolment running in two transactions at
 * once (two lesson completions, or a lesson completion racing an attendance
 * correction) both read "no open record" and both insert. The partial unique
 * index `CompletionRecord_open_key` (migration
 * 20261006120000_grade_completion_uniqueness) refuses the second insert, and
 * `applyVerdict` treats that refusal as "already completed" inside a savepoint,
 * so the losing caller's surrounding transaction stays usable and commits.
 *
 * The race is made deterministic: each transaction's `completionRecord.findFirst`
 * is held until both transactions have read, so both take the create path.
 *
 * SAFETY: the only database here is a disposable Testcontainers instance from
 * `startTestDatabase()`. Nothing reads `.env` or reaches a shared database.
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails with
 * a container-start error and every case reports BLOCKED, never a silent pass.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { seedCohortFixture, seedEnrolmentFixture } from "./support/cohort-fixtures";
import type {
  CompletionRecalculationResult,
  CompletionServiceTxClient,
} from "@/server/services/completion-service";

type CompletionModule = typeof import("@/server/services/completion-service");

let testDb: TestDatabase;
let recalculateCompletion: CompletionModule["recalculateCompletion"];
let counter = 0;
const uid = (prefix: string) => `${prefix}-${(counter += 1)}`;

beforeAll(async () => {
  testDb = await startTestDatabase();
  // The service module graph reaches `@/server/db`; point it at the container
  // before the dynamic import so nothing can bind to another database.
  process.env.DATABASE_URL = testDb.url;
  recalculateCompletion = (await import("@/server/services/completion-service")).recalculateCompletion;
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

function barrier(parties: number): () => Promise<void> {
  let arrived = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    arrived += 1;
    if (arrived === parties) release();
    if (arrived <= parties) await gate;
  };
}

/**
 * Wraps a real transaction client so its `completionRecord.findFirst` waits at
 * `wait` after reading. Every other member is the real, bound client.
 */
function withHeldRead(tx: Prisma.TransactionClient, wait: () => Promise<void>): CompletionServiceTxClient {
  const realRecord = tx.completionRecord;
  const heldRecord = {
    findFirst: async (args: Parameters<typeof realRecord.findFirst>[0]) => {
      const row = await realRecord.findFirst(args);
      await wait();
      return row;
    },
    create: (args: Parameters<typeof realRecord.create>[0]) => realRecord.create(args),
    update: (args: Parameters<typeof realRecord.update>[0]) => realRecord.update(args),
  };
  return new Proxy(tx, {
    get(target, prop, receiver) {
      if (prop === "completionRecord") return heldRecord;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as CompletionServiceTxClient;
}

/**
 * A course with one required lesson, pinned by a self-paced cohort, and an
 * ACTIVE enrolment that has already completed that lesson, so every
 * evaluation's verdict is "satisfied".
 */
async function seedSatisfiedEnrolment() {
  const prisma = testDb.prisma;
  const course = await prisma.course.create({
    data: { slug: uid("completion-race-course"), title: "Completion Race Course" },
    select: { id: true },
  });
  const mod = await prisma.module.create({
    data: { courseId: course.id, title: "Only module", position: 0 },
    select: { id: true },
  });
  const lesson = await prisma.lesson.create({
    data: { moduleId: mod.id, title: "Only lesson", type: "TEXT", position: 0, required: true, allowManualComplete: true },
    select: { id: true },
  });
  const publisher = await prisma.user.create({
    data: { email: `${uid("publisher")}@fixture.test`, name: "Fixture Publisher", isStaff: true },
    select: { id: true },
  });
  const publication = await prisma.coursePublication.create({
    data: {
      courseId: course.id,
      version: 1,
      payloadSchema: 1,
      publishedById: publisher.id,
      payload: {
        schema: 1,
        completionRule: { version: 1, requireAllRequiredLessons: true },
        completionRuleVersion: 1,
        modules: [
          {
            id: mod.id,
            position: 0,
            lessons: [{ id: lesson.id, position: 0, required: true, type: "TEXT", assessmentId: null }],
          },
        ],
      },
    },
    select: { id: true },
  });
  const { cohortId } = await seedCohortFixture(prisma, {
    courseId: course.id,
    deliveryMode: "SELF_PACED",
    accessDurationDays: 30,
    coursePublicationId: publication.id,
    capacity: 10,
  });
  const { enrolmentId } = await seedEnrolmentFixture(prisma, { cohortId, status: "ACTIVE", activatedAt: new Date() });
  await prisma.lessonProgress.create({ data: { enrolmentId, lessonId: lesson.id } });
  return { courseId: course.id, enrolmentId };
}

async function openRecords(enrolmentId: string) {
  return testDb.prisma.completionRecord.findMany({ where: { enrolmentId, supersededAt: null } });
}

async function completedEvents(enrolmentId: string) {
  const events = await testDb.prisma.domainEvent.findMany({ where: { type: "course.completed" } });
  return events.filter((e) => (e.payload as Record<string, unknown>).enrolmentId === enrolmentId);
}

/** Runs one evaluation in its own transaction, then writes one more row in the SAME transaction to prove it is still usable. */
async function evaluateInOwnTransaction(
  enrolmentId: string,
  wait: () => Promise<void>,
  marker: string,
): Promise<CompletionRecalculationResult> {
  return testDb.prisma.$transaction(
    async (tx) => {
      const result = await recalculateCompletion(withHeldRead(tx, wait), { enrolmentId, now: new Date() });
      await tx.auditEvent.create({
        data: { action: "test.completion_race", targetType: "Enrolment", targetId: enrolmentId, outcome: marker },
      });
      return result;
    },
    { timeout: 60_000, maxWait: 30_000 },
  );
}

function actions(result: CompletionRecalculationResult): string[] {
  return result.kind === "evaluated" ? result.results.map((r) => r.action) : [result.kind];
}

// Each case seeds a small course graph and runs two real transactions; the
// default 5s case timeout is too tight on a busy Docker host.
describe("recalculateCompletion under concurrent evaluations (NFR-03 / NFR-14)", { timeout: 60_000 }, () => {
  it("two concurrent evaluations leave one open record, one course.completed event, and both transactions commit", async () => {
    const f = await seedSatisfiedEnrolment();
    const bothRead = barrier(2);

    const outcomes = await Promise.allSettled([
      evaluateInOwnTransaction(f.enrolmentId, bothRead, "A"),
      evaluateInOwnTransaction(f.enrolmentId, bothRead, "B"),
    ]);

    for (const outcome of outcomes) {
      expect(outcome.status, outcome.status === "rejected" ? String(outcome.reason) : "").toBe("fulfilled");
    }
    const allActions = outcomes.flatMap((o) => (o.status === "fulfilled" ? actions(o.value) : []));
    expect(allActions.sort()).toEqual(["created", "unchanged"]);

    expect(await openRecords(f.enrolmentId)).toHaveLength(1);
    expect(await completedEvents(f.enrolmentId)).toHaveLength(1);

    // The loser's later write in the same transaction committed: the unique
    // violation was contained by the savepoint, not left aborting the transaction.
    const markers = await testDb.prisma.auditEvent.findMany({
      where: { action: "test.completion_race", targetId: f.enrolmentId },
    });
    expect(markers.map((m) => m.outcome).sort()).toEqual(["A", "B"]);
  });

  it("a superseded record beside the open one is allowed, and concurrent re-completion still opens only one", async () => {
    const f = await seedSatisfiedEnrolment();
    await testDb.prisma.completionRecord.create({
      data: {
        enrolmentId: f.enrolmentId,
        scope: "COURSE",
        courseId: f.courseId,
        ruleVersion: 1,
        supersededAt: new Date(Date.now() - 60_000),
      },
    });
    const bothRead = barrier(2);

    const outcomes = await Promise.allSettled([
      evaluateInOwnTransaction(f.enrolmentId, bothRead, "C"),
      evaluateInOwnTransaction(f.enrolmentId, bothRead, "D"),
    ]);
    for (const outcome of outcomes) {
      expect(outcome.status, outcome.status === "rejected" ? String(outcome.reason) : "").toBe("fulfilled");
    }

    const all = await testDb.prisma.completionRecord.findMany({ where: { enrolmentId: f.enrolmentId } });
    expect(all).toHaveLength(2);
    expect(all.filter((r) => r.supersededAt === null)).toHaveLength(1);
  });

  it("the index also refuses a second open PROGRAMME record, whose courseId is null", async () => {
    const f = await seedSatisfiedEnrolment();
    await testDb.prisma.completionRecord.create({
      data: { enrolmentId: f.enrolmentId, scope: "PROGRAMME", courseId: null, ruleVersion: 1 },
    });
    const second = await testDb.prisma.completionRecord
      .create({ data: { enrolmentId: f.enrolmentId, scope: "PROGRAMME", courseId: null, ruleVersion: 1 } })
      .catch((e: unknown) => e);
    expect(second).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((second as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");
  });
});
