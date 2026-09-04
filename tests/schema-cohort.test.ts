/**
 * Phase-5 schema-delta regression proof (plan 05-01, Task 3).
 *
 * Two halves, mirroring `tests/schema-catalogue.test.ts`:
 *
 *  (a) STATIC — assertions over the `prisma/schema.prisma` text and the
 *      joined `prisma/migrations/*\/migration.sql` history. These prove the
 *      four new CHECK constraints from `prisma/sql/003_cohort_operations.sql`
 *      were actually pasted into an applied migration (RESEARCH Pitfall 2 —
 *      `tests/support/pg.ts` auto-applies an un-pasted companion, so without
 *      this the Testcontainers half would pass while production has no
 *      constraint), and that the additive model changes landed.
 *
 *  (b) TESTCONTAINERS — a throwaway `postgres:16-alpine` with the checked-in
 *      migrations deployed (see `tests/support/pg.ts`), proving each new
 *      constraint rejects a bad row, plus a regression guard that the
 *      pre-existing cohort constraints still bite.
 *
 * PREREQUISITE for half (b): Docker. If it is unavailable `beforeAll` fails
 * with a container-start error and those cases report BLOCKED — never
 * silently passed, never weakened to a mock (same rule as
 * `tests/reorder.integration.test.ts`).
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestDatabase,
  TEST_DB_TIMEOUT_MS,
  type TestDatabase,
} from "./support/pg";
import {
  seedAttendanceFixture,
  seedCohortFixture,
  seedEnrolmentFixture,
  seedLearnerFixture,
  seedSessionFixture,
} from "./support/cohort-fixtures";

// ---------------------------------------------------------------------------
// (a) STATIC assertions
// ---------------------------------------------------------------------------

const schema = readFileSync(
  path.resolve(process.cwd(), "prisma/schema.prisma"),
  "utf8",
);

function sliceModel(name: string): string {
  const start = schema.indexOf(`model ${name} {`);
  if (start === -1) throw new Error(`model ${name} not found in schema`);
  const end = schema.indexOf("\n}", start);
  return schema.slice(start, end);
}

const migrationsDir = path.resolve(process.cwd(), "prisma/migrations");
const allMigrationSql = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) =>
    readFileSync(path.join(migrationsDir, entry.name, "migration.sql"), "utf8"),
  )
  .join("\n");

const NEW_CONSTRAINTS = [
  "cohort_hold_minutes_non_negative",
  "enrolment_transfer_not_self",
  "enrolment_hold_expiry_only_when_pending",
  "attendance_correction_has_reason",
] as const;

describe("Phase-5 schema delta is declared in prisma/schema.prisma", () => {
  it("Cohort.holdMinutes is nullable Int defaulting to 30 (D-02)", () => {
    expect(sliceModel("Cohort")).toMatch(
      /holdMinutes\s+Int\?\s+@default\(30\)/,
    );
  });

  it("Enrolment carries holdExpiresAt and transferredFromId (D-03/D-13)", () => {
    const model = sliceModel("Enrolment");
    expect(model).toMatch(/holdExpiresAt\s+DateTime\?/);
    expect(model).toMatch(/transferredFromId\s+String\?/);
  });

  it("Enrolment declares the named EnrolmentTransfer self-relation, both sides", () => {
    const model = sliceModel("Enrolment");
    expect(model).toMatch(
      /transferredFrom\s+Enrolment\?\s+@relation\("EnrolmentTransfer",\s*fields:\s*\[transferredFromId\],\s*references:\s*\[id\]\)/,
    );
    expect(model).toMatch(
      /transferredTo\s+Enrolment\[\]\s+@relation\("EnrolmentTransfer"\)/,
    );
  });

  it("Enrolment has the cheap-sweep index @@index([status, holdExpiresAt])", () => {
    expect(sliceModel("Enrolment")).toMatch(
      /@@index\(\[status,\s*holdExpiresAt\]\)/,
    );
  });

  it("model DomainEvent exists as an append-only outbox", () => {
    const model = sliceModel("DomainEvent");
    expect(model).toMatch(/payload\s+Json/);
    expect(model).toMatch(/occurredAt\s+DateTime\s+@default\(now\(\)\)/);
    expect(model).toMatch(/processedAt\s+DateTime\?/);
    expect(model).toMatch(/@@index\(\[processedAt,\s*occurredAt\]\)/);
  });
});

describe("The manual paste-in from 003_cohort_operations.sql was actually applied", () => {
  for (const name of NEW_CONSTRAINTS) {
    it(`${name} appears in an applied migration file`, () => {
      expect(allMigrationSql).toContain(name);
    });
  }

  it("does not redeclare any constraint already applied in the init migration", () => {
    const companion = readFileSync(
      path.resolve(process.cwd(), "prisma/sql/003_cohort_operations.sql"),
      "utf8",
    );
    const body = companion
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    for (const preExisting of [
      "enrolment_one_active_per_learner_cohort",
      "cohort_targets_exactly_one_offer",
      "cohort_capacity_not_exceeded",
      "cohort_dates_ordered",
    ]) {
      expect(body).not.toContain(preExisting);
    }
  });

  it("never introduces a DEFERRABLE clause (init-migration regression guard)", () => {
    expect(allMigrationSql).not.toMatch(/DEFERRABLE/);
  });
});

// ---------------------------------------------------------------------------
// (b) TESTCONTAINERS: each new constraint rejects a bad row
// ---------------------------------------------------------------------------

describe("the four new CHECK constraints reject bad rows against real Postgres", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await startTestDatabase();
  }, TEST_DB_TIMEOUT_MS);

  afterAll(async () => {
    await testDb?.stop();
  }, TEST_DB_TIMEOUT_MS);

  it("cohort_hold_minutes_non_negative: a negative holdMinutes is rejected", async () => {
    await expect(
      seedCohortFixture(testDb.prisma, { holdMinutes: -1 }),
    ).rejects.toThrow();
  });

  it("cohort_hold_minutes_non_negative: null and 0 are accepted", async () => {
    await expect(
      seedCohortFixture(testDb.prisma, { holdMinutes: null }),
    ).resolves.toBeDefined();
    await expect(
      seedCohortFixture(testDb.prisma, { holdMinutes: 0 }),
    ).resolves.toBeDefined();
  });

  it("enrolment_transfer_not_self: transferredFromId = id is rejected", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 5 });
    const { enrolmentId } = await seedEnrolmentFixture(testDb.prisma, {
      cohortId,
      status: "ACTIVE",
    });
    await expect(
      testDb.prisma.enrolment.update({
        where: { id: enrolmentId },
        data: { transferredFromId: enrolmentId },
      }),
    ).rejects.toThrow();
  });

  it("enrolment_hold_expiry_only_when_pending: holdExpiresAt on an ACTIVE enrolment is rejected", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 5 });
    const { userId } = await seedLearnerFixture(testDb.prisma);
    await expect(
      seedEnrolmentFixture(testDb.prisma, {
        cohortId,
        userId,
        status: "ACTIVE",
        holdExpiresAt: new Date(),
      }),
    ).rejects.toThrow();
  });

  it("enrolment_hold_expiry_only_when_pending: holdExpiresAt on a PENDING_PAYMENT enrolment is accepted", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 5 });
    await expect(
      seedEnrolmentFixture(testDb.prisma, {
        cohortId,
        status: "PENDING_PAYMENT",
        holdExpiresAt: new Date(Date.now() + 1_800_000),
      }),
    ).resolves.toBeDefined();
  });

  it("attendance_correction_has_reason: correctedAt set with a blank reason is rejected", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 5 });
    const { sessionId } = await seedSessionFixture(testDb.prisma, { cohortId });
    const { enrolmentId } = await seedEnrolmentFixture(testDb.prisma, {
      cohortId,
      status: "ACTIVE",
    });
    await expect(
      seedAttendanceFixture(testDb.prisma, {
        sessionId,
        enrolmentId,
        state: "PRESENT",
        correctedAt: new Date(),
        correctionReason: "   ",
      }),
    ).rejects.toThrow();
  });

  it("attendance_correction_has_reason: a never-corrected record and a properly-corrected record are both accepted", async () => {
    const { cohortId } = await seedCohortFixture(testDb.prisma, { capacity: 5 });
    const { sessionId } = await seedSessionFixture(testDb.prisma, { cohortId });
    const { enrolmentId } = await seedEnrolmentFixture(testDb.prisma, {
      cohortId,
      status: "ACTIVE",
    });
    const { attendanceId } = await seedAttendanceFixture(testDb.prisma, {
      sessionId,
      enrolmentId,
      state: "PRESENT",
    });
    await expect(
      testDb.prisma.attendanceRecord.update({
        where: { id: attendanceId },
        data: {
          state: "ABSENT",
          correctedAt: new Date(),
          correctionReason: "Learner was on an approved exception list.",
        },
      }),
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// (b cont.) regression guard: the pre-existing cohort constraints still bite
// ---------------------------------------------------------------------------

describe("pre-existing cohort constraints are untouched by the Phase-5 delta", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await startTestDatabase();
  }, TEST_DB_TIMEOUT_MS);

  afterAll(async () => {
    await testDb?.stop();
  }, TEST_DB_TIMEOUT_MS);

  const DAY_MS = 86_400_000;
  function baseCohortData() {
    const now = Date.now();
    return {
      code: `REG-${Math.random().toString(36).slice(2)}`,
      title: "Regression Cohort",
      deliveryMode: "INSTRUCTOR_LED" as const,
      timezone: "Africa/Lagos",
      startsAt: new Date(now + 7 * DAY_MS),
      endsAt: new Date(now + 30 * DAY_MS),
      enrolmentOpensAt: new Date(now - 7 * DAY_MS),
      enrolmentClosesAt: new Date(now + 5 * DAY_MS),
      capacity: 10,
      priceMinor: 0,
    };
  }

  it("cohort_targets_exactly_one_offer: a cohort with BOTH courseId and programmeId is rejected", async () => {
    const course = await testDb.prisma.course.create({
      data: { slug: `reg-c-${Math.random().toString(36).slice(2)}`, title: "C" },
      select: { id: true },
    });
    const programme = await testDb.prisma.programme.create({
      data: { slug: `reg-p-${Math.random().toString(36).slice(2)}`, title: "P" },
      select: { id: true },
    });
    await expect(
      testDb.prisma.cohort.create({
        data: { ...baseCohortData(), courseId: course.id, programmeId: programme.id },
      }),
    ).rejects.toThrow();
  });

  it("cohort_targets_exactly_one_offer: a cohort with NEITHER is rejected", async () => {
    await expect(
      testDb.prisma.cohort.create({ data: { ...baseCohortData() } }),
    ).rejects.toThrow();
  });

  it("cohort_dates_ordered: endsAt before startsAt is rejected", async () => {
    const course = await testDb.prisma.course.create({
      data: { slug: `reg-d-${Math.random().toString(36).slice(2)}`, title: "D" },
      select: { id: true },
    });
    const now = Date.now();
    await expect(
      testDb.prisma.cohort.create({
        data: {
          ...baseCohortData(),
          courseId: course.id,
          startsAt: new Date(now + 30 * DAY_MS),
          endsAt: new Date(now + 7 * DAY_MS),
        },
      }),
    ).rejects.toThrow();
  });
});
