/**
 * Real-Postgres proof for CR-06 (plan 11-27 Task 1): the one-live-enrolment
 * partial unique index must cover COMPLETED as well as ACTIVE.
 *
 * Why this cannot be a mock: the whole defect is a property of a Postgres
 * partial unique index. Phase 11 issuance moves an enrolment ACTIVE ->
 * COMPLETED, which used to free `enrolment_one_active_per_learner_cohort`
 * (`WHERE status = 'ACTIVE'`). A second ACTIVE enrolment could then be
 * created for the same learner and cohort, and the later D-06 reversal
 * (revoke, or a CRD-06 review flag: COMPLETED -> ACTIVE) collided with it (P2002).
 * Migration `20260919120000_enrolment_one_live_per_learner_cohort` widens the
 * index to `status IN ('ACTIVE', 'COMPLETED')`.
 *
 * SAFETY: every database in this file is a disposable Testcontainers instance
 * started through `startTestDatabase()`, which overrides DATABASE_URL with the
 * container URL. Nothing here reads `.env` or touches a shared/remote database.
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails with a
 * container-start error, which is the expected failure mode, not a code bug.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import {
  seedCohortFixture,
  seedEnrolmentFixture,
  seedLearnerFixture,
} from "./support/cohort-fixtures";
import {
  AlreadyEnrolledError,
  takeSeat,
  type SeatTxClient,
} from "@/server/services/seat-accounting";

const NEW_INDEX = "enrolment_one_live_per_learner_cohort";
const OLD_INDEX = "enrolment_one_active_per_learner_cohort";
const MIGRATION_PATH = path.resolve(
  import.meta.dirname,
  "..",
  "prisma",
  "migrations",
  "20260919120000_enrolment_one_live_per_learner_cohort",
  "migration.sql",
);

type IndexRow = { indexname: string; indexdef: string };

async function enrolmentIndexes(db: TestDatabase): Promise<IndexRow[]> {
  return db.prisma.$queryRaw<IndexRow[]>`
    SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'Enrolment'
  `;
}

/** The Prisma error code of a rejected promise, or null when it resolved. */
async function errorCodeOf(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (err) {
    return (err as { code?: string }).code ?? `no-code:${String(err)}`;
  }
}

describe("CR-06: widened one-live-enrolment index (real Postgres)", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, TEST_DB_TIMEOUT_MS);

  afterAll(async () => {
    await db?.stop();
  }, TEST_DB_TIMEOUT_MS);

  it("catalogue: the new index covers ACTIVE and COMPLETED and the old index is gone", async () => {
    const rows = await enrolmentIndexes(db);
    const names = rows.map((r) => r.indexname);
    expect(names).toContain(NEW_INDEX);
    expect(names).not.toContain(OLD_INDEX);

    const def = rows.find((r) => r.indexname === NEW_INDEX)!.indexdef;
    expect(def).toMatch(/UNIQUE/i);
    expect(def).toContain("ACTIVE");
    expect(def).toContain("COMPLETED");
    expect(def).not.toContain("WITHDRAWN");
  });

  it("a COMPLETED enrolment blocks a second ACTIVE enrolment for the same learner and cohort (P2002)", async () => {
    const { cohortId } = await seedCohortFixture(db.prisma);
    const { userId } = await seedLearnerFixture(db.prisma);
    await seedEnrolmentFixture(db.prisma, { cohortId, userId, status: "COMPLETED" });

    const code = await errorCodeOf(() =>
      seedEnrolmentFixture(db.prisma, { cohortId, userId, status: "ACTIVE" }),
    );
    expect(code).toBe("P2002");
  });

  it("a COMPLETED enrolment blocks a second COMPLETED enrolment too", async () => {
    const { cohortId } = await seedCohortFixture(db.prisma);
    const { userId } = await seedLearnerFixture(db.prisma);
    await seedEnrolmentFixture(db.prisma, { cohortId, userId, status: "COMPLETED" });

    const code = await errorCodeOf(() =>
      seedEnrolmentFixture(db.prisma, { cohortId, userId, status: "COMPLETED" }),
    );
    expect(code).toBe("P2002");
  });

  it("takeSeat over a COMPLETED enrolment raises AlreadyEnrolledError", async () => {
    const { cohortId } = await seedCohortFixture(db.prisma, { capacity: 5 });
    const { userId } = await seedLearnerFixture(db.prisma);
    await seedEnrolmentFixture(db.prisma, { cohortId, userId, status: "COMPLETED" });

    await expect(
      db.prisma.$transaction((tx) =>
        takeSeat(tx as unknown as SeatTxClient, {
          cohortId,
          enrolment: { cohortId, userId, status: "ACTIVE" },
        }),
      ),
    ).rejects.toBeInstanceOf(AlreadyEnrolledError);

    // Nothing was taken: the transaction rolled back.
    const cohort = await db.prisma.cohort.findUniqueOrThrow({
      where: { id: cohortId },
      select: { seatsTaken: true },
    });
    expect(cohort.seatsTaken).toBe(0);
  });

  it("guard: ACTIVE plus a second ACTIVE is still rejected", async () => {
    const { cohortId } = await seedCohortFixture(db.prisma);
    const { userId } = await seedLearnerFixture(db.prisma);
    await seedEnrolmentFixture(db.prisma, { cohortId, userId, status: "ACTIVE" });

    const code = await errorCodeOf(() =>
      seedEnrolmentFixture(db.prisma, { cohortId, userId, status: "ACTIVE" }),
    );
    expect(code).toBe("P2002");
  });

  it("guard: WITHDRAWN, CANCELLED and TRANSFERRED enrolments do not block re-enrolment (REG-03)", async () => {
    for (const terminal of ["WITHDRAWN", "CANCELLED", "TRANSFERRED"]) {
      const { cohortId } = await seedCohortFixture(db.prisma);
      const { userId } = await seedLearnerFixture(db.prisma);
      await seedEnrolmentFixture(db.prisma, { cohortId, userId, status: terminal });

      const code = await errorCodeOf(() =>
        seedEnrolmentFixture(db.prisma, { cohortId, userId, status: "ACTIVE" }),
      );
      expect(code, `re-enrol after ${terminal}`).toBeNull();
    }
  });

  it("guard: a COMPLETED enrolment does not block a WITHDRAWN row", async () => {
    const { cohortId } = await seedCohortFixture(db.prisma);
    const { userId } = await seedLearnerFixture(db.prisma);
    await seedEnrolmentFixture(db.prisma, { cohortId, userId, status: "COMPLETED" });

    const code = await errorCodeOf(() =>
      seedEnrolmentFixture(db.prisma, { cohortId, userId, status: "WITHDRAWN" }),
    );
    expect(code).toBeNull();
  });

  it("D-06 reversal: COMPLETED -> ACTIVE succeeds alone, and fails P2002 only when another live row exists", async () => {
    const { cohortId } = await seedCohortFixture(db.prisma);
    const { userId } = await seedLearnerFixture(db.prisma);
    const first = await seedEnrolmentFixture(db.prisma, {
      cohortId,
      userId,
      status: "COMPLETED",
    });
    const second = await seedEnrolmentFixture(db.prisma, {
      cohortId,
      userId,
      status: "WITHDRAWN",
    });

    // The revoke / CRD-06 flag reversal on the certificate-holding enrolment works.
    const reversal = await errorCodeOf(() =>
      db.prisma.enrolment.update({
        where: { id: first.enrolmentId },
        data: { status: "ACTIVE" },
      }),
    );
    expect(reversal).toBeNull();

    // A second live row for the same pair is what would have broken it. The
    // widened index means a duplicate could never have been created while the
    // first was COMPLETED, so this state is only reachable here by hand.
    const collision = await errorCodeOf(() =>
      db.prisma.enrolment.update({
        where: { id: second.enrolmentId },
        data: { status: "ACTIVE" },
      }),
    );
    expect(collision).toBe("P2002");
  });

  it("the migration creates the new index before it drops the old one", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8")
      .split(/\r?\n/)
      .filter((line) => !/^\s*--/.test(line))
      .join("\n");
    const create = sql.indexOf(`CREATE UNIQUE INDEX ${NEW_INDEX}`);
    const drop = sql.indexOf(`DROP INDEX ${OLD_INDEX}`);
    expect(create).toBeGreaterThan(-1);
    expect(drop).toBeGreaterThan(-1);
    expect(create).toBeLessThan(drop);
  });
});

/**
 * Extracts the migration's executable statements: full-line `--` comments are
 * removed, the `DO $$ ... $$;` preflight (which contains semicolons) is lifted
 * out by its delimiters, and the remainder is split on the terminating
 * semicolon of each plain statement.
 */
function migrationStatements(): { preflight: string; rest: string[] } {
  const sql = readFileSync(MIGRATION_PATH, "utf8")
    .split(/\r?\n/)
    .filter((line) => !/^\s*--/.test(line))
    .join("\n");
  const doBlock = /DO \$\$[\s\S]*?\$\$;/.exec(sql);
  if (!doBlock) throw new Error("migration has no DO $$ ... $$; preflight block");
  const rest = sql
    .replace(doBlock[0], "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return { preflight: doBlock[0].replace(/;\s*$/, ""), rest };
}

describe("CR-06: migration preflight aborts on violating data and changes nothing", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, TEST_DB_TIMEOUT_MS);

  afterAll(async () => {
    await db?.stop();
  }, TEST_DB_TIMEOUT_MS);

  it("aborts naming the index and the violating count, leaves the old index and both rows intact, then applies once the duplicates are resolved", async () => {
    const { prisma } = db;

    // Simulate the PRE-migration database: the old, narrower index only.
    await prisma.$executeRawUnsafe(`DROP INDEX ${NEW_INDEX}`);
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX ${OLD_INDEX} ON "Enrolment" ("userId", "cohortId") WHERE status = 'ACTIVE'`,
    );

    // Two violating (userId, cohortId) pairs: a COMPLETED plus an ACTIVE row each.
    const completedIds: string[] = [];
    const activeIds: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const { cohortId } = await seedCohortFixture(prisma);
      const { userId } = await seedLearnerFixture(prisma);
      const completed = await seedEnrolmentFixture(prisma, {
        cohortId,
        userId,
        status: "COMPLETED",
      });
      const active = await seedEnrolmentFixture(prisma, {
        cohortId,
        userId,
        status: "ACTIVE",
      });
      completedIds.push(completed.enrolmentId);
      activeIds.push(active.enrolmentId);
    }

    const { preflight, rest } = migrationStatements();
    expect(rest).toHaveLength(2);

    // 1. The preflight aborts, with a message a human can act on.
    let message = "";
    try {
      await prisma.$executeRawUnsafe(preflight);
    } catch (err) {
      message = String((err as Error).message);
    }
    expect(message).toContain(NEW_INDEX);
    expect(message).toMatch(/\b2 \(userId, cohortId\) pair/);

    // 2. Nothing changed: old index present, new index absent, rows untouched.
    const names = (await enrolmentIndexes(db)).map((r) => r.indexname);
    expect(names).toContain(OLD_INDEX);
    expect(names).not.toContain(NEW_INDEX);
    const rows = await prisma.enrolment.findMany({
      where: { id: { in: [...completedIds, ...activeIds] } },
      select: { id: true, status: true },
    });
    expect(rows).toHaveLength(4);
    for (const id of completedIds) {
      expect(rows.find((r) => r.id === id)?.status).toBe("COMPLETED");
    }
    for (const id of activeIds) {
      expect(rows.find((r) => r.id === id)?.status).toBe("ACTIVE");
    }

    // 3. A human resolves the duplicates; the same statements now apply cleanly.
    await prisma.enrolment.deleteMany({ where: { id: { in: activeIds } } });
    await prisma.$executeRawUnsafe(preflight);
    for (const statement of rest) {
      await prisma.$executeRawUnsafe(statement);
    }
    const after = (await enrolmentIndexes(db)).map((r) => r.indexname);
    expect(after).toContain(NEW_INDEX);
    expect(after).not.toContain(OLD_INDEX);
  });
});
