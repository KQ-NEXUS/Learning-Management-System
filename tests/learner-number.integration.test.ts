/**
 * Real-Postgres proof of learner number issuing (owner decisions, 2026-10-04).
 *
 * The unit tests cover the format. What only a real database can show is that
 * the counter is atomic (two registrations at once never get the same number),
 * that a rolled-back registration gives its number back, and that the migration
 * leaves existing learners without one.
 *
 * PREREQUISITE: Docker must be running (tests/support/pg.ts starts the
 * container). If it is not, `beforeAll` fails and every case reports BLOCKED.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import {
  createLearnerNumberService,
  issueLearnerNumber,
  type LearnerNumberBackfillTx,
  type LearnerNumberServiceDeps,
  type LearnerNumberTx,
} from "@/server/services/learner-number-service";
import { createTestWithPermission, grant } from "./support/harness";
import { createRegistrationService, type RegistrationStore } from "@/server/services/registration-service";

const AT = new Date("2026-10-04T12:00:00.000Z");
let testDb: TestDatabase;
let counter = 0;

beforeAll(async () => {
  testDb = await startTestDatabase();
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

beforeEach(async () => {
  await testDb.prisma.user.updateMany({ data: { learnerNumber: null } });
  await testDb.prisma.learnerNumberConfig.update({ where: { id: "default" }, data: { pattern: null, nextSequence: 1 } });
});

const setPattern = (pattern: string | null, nextSequence?: number) =>
  testDb.prisma.learnerNumberConfig.update({
    where: { id: "default" },
    data: { pattern, ...(nextSequence ? { nextSequence } : {}) },
  });
const issue = () => testDb.prisma.$transaction((tx) => issueLearnerNumber(tx as unknown as LearnerNumberTx, AT));
const nextSequence = async () => (await testDb.prisma.learnerNumberConfig.findUniqueOrThrow({ where: { id: "default" } })).nextSequence;
const learner = (learnerNumber: string | null = null) =>
  testDb.prisma.user.create({
    data: { email: `learner-${++counter}@number.test`, name: `Learner ${counter}`, status: "ACTIVE", learnerNumber },
  });

describe("the migration", () => {
  it("creates the single settings row switched off, with the counter at 1", async () => {
    const rows = await testDb.prisma.learnerNumberConfig.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "default", pattern: null, nextSequence: 1 });
  });
});

describe("issueLearnerNumber", () => {
  it("issues nothing, and does not move the counter, while no pattern is set", async () => {
    expect(await issue()).toBeNull();
    expect(await nextSequence()).toBe(1);
  });

  it("issues numbers in order from the pattern", async () => {
    await setPattern("KQL-######");
    expect([await issue(), await issue(), await issue()]).toEqual(["KQL-000001", "KQL-000002", "KQL-000003"]);
    expect(await nextSequence()).toBe(4);
  });

  it("carries the counter on when the pattern changes, so no value is used twice", async () => {
    await setPattern("KQL-####");
    expect(await issue()).toBe("KQL-0001");
    await setPattern("KQ/{YY}/#####");
    expect(await issue()).toBe("KQ/26/00002");
  });

  it("gives the number back when the transaction that took it rolls back", async () => {
    await setPattern("KQL-####");
    await expect(
      testDb.prisma.$transaction(async (tx) => {
        await issueLearnerNumber(tx as unknown as LearnerNumberTx, AT);
        throw new Error("account could not be created");
      }),
    ).rejects.toThrow("account could not be created");

    expect(await nextSequence()).toBe(1);
    expect(await issue()).toBe("KQL-0001");
  });

  it("twenty registrations at the same instant get twenty different, consecutive numbers", async () => {
    await setPattern("KQL-####");

    const numbers = await Promise.all(Array.from({ length: 20 }, () => issue()));

    expect(new Set(numbers).size).toBe(20);
    expect([...numbers].sort()).toEqual(Array.from({ length: 20 }, (_, i) => `KQL-${String(i + 1).padStart(4, "0")}`));
    expect(await nextSequence()).toBe(21);
  }, 60_000);

  it("skips a number an earlier pattern already issued, rather than failing", async () => {
    await learner("KQL-0005");
    await setPattern("KQL-####", 5);

    expect(await issue()).toBe("KQL-0006");
    expect(await nextSequence()).toBe(7);
  });

  it("the database refuses the same learner number on two accounts", async () => {
    await learner("KQL-0042");
    await expect(learner("KQL-0042")).rejects.toThrow();
  });
});

describe("registration", () => {
  function registration() {
    return createRegistrationService({
      store: testDb.prisma as unknown as RegistrationStore,
      issueToken: async () => ({ ok: true as const, token: "token" }),
      resendVerification: async () => ({ ok: true as const }),
      dispatch: async () => undefined,
      audit: async () => undefined,
      hash: async (plaintext) => `hash(${plaintext})`,
      now: () => AT,
      issueLearnerNumber: (tx, at) => issueLearnerNumber(tx as LearnerNumberTx, at),
    });
  }
  const register = (email: string) =>
    registration().registerLearner({
      email,
      password: "a-long-enough-password",
      name: "New Learner",
      phone: null,
      acceptedTerms: true,
      acceptedPrivacy: true,
    });
  const numberOf = async (email: string) => (await testDb.prisma.user.findUniqueOrThrow({ where: { email } })).learnerNumber;

  it("gives each new learner the next number once a pattern is set", async () => {
    await setPattern("KQL-######");
    await register("first@number.test");
    await register("second@number.test");

    expect(await numberOf("first@number.test")).toBe("KQL-000001");
    expect(await numberOf("second@number.test")).toBe("KQL-000002");
  });

  it("registers a learner without a number while numbers are switched off", async () => {
    await register("unnumbered@number.test");
    expect(await numberOf("unnumbered@number.test")).toBeNull();
  });

  it("setting a pattern later leaves that learner without a number: existing learners are not given one", async () => {
    await register("early@number.test");
    await setPattern("KQL-######");
    await register("late@number.test");

    expect(await numberOf("early@number.test")).toBeNull();
    expect(await numberOf("late@number.test")).toBe("KQL-000001");
  });

  it("registering an address that already has an account takes no number", async () => {
    await setPattern("KQL-######");
    await register("repeat@number.test");
    await register("repeat@number.test");

    expect(await nextSequence()).toBe(2);
  });
});

describe("backfill", () => {
  const audit = async () => undefined;
  function service() {
    return createLearnerNumberService({
      config: testDb.prisma.learnerNumberConfig as unknown as LearnerNumberServiceDeps["config"],
      user: testDb.prisma.user as unknown as LearnerNumberServiceDeps["user"],
      transaction: (fn, options) => testDb.prisma.$transaction((tx) => fn(tx as unknown as LearnerNumberBackfillTx), options),
      withPermission: createTestWithPermission([grant("users.manage")]).withPermission as unknown as LearnerNumberServiceDeps["withPermission"],
      audit: audit as unknown as LearnerNumberServiceDeps["audit"],
      now: () => AT,
    });
  }
  const registeredOn = (iso: string, extra: Record<string, unknown> = {}) =>
    testDb.prisma.user.create({
      data: { email: `backfill-${++counter}@number.test`, name: `Backfill ${counter}`, status: "ACTIVE", createdAt: new Date(iso), ...extra },
    });
  const numberOfId = async (id: string) => (await testDb.prisma.user.findUniqueOrThrow({ where: { id } })).learnerNumber;

  beforeEach(async () => {
    await testDb.prisma.user.deleteMany({ where: { email: { endsWith: "@number.test" } } });
  });

  it("numbers learners oldest registration first, whatever order they were created in", async () => {
    const third = await registeredOn("2026-03-01T00:00:00Z");
    const first = await registeredOn("2025-01-15T00:00:00Z");
    const second = await registeredOn("2025-09-30T00:00:00Z");
    await setPattern("KQL-####");

    const result = await service().backfillLearnerNumbers();

    expect(result).toMatchObject({ numbered: 3, first: "KQL-0001", last: "KQL-0003" });
    expect([await numberOfId(first.id), await numberOfId(second.id), await numberOfId(third.id)]).toEqual([
      "KQL-0001",
      "KQL-0002",
      "KQL-0003",
    ]);
    expect(result.settings).toMatchObject({ withoutNumber: 0, nextSequence: 4 });
  });

  it("uses the year each learner registered, not the year of the backfill", async () => {
    const old = await registeredOn("2024-06-01T00:00:00Z");
    const recent = await registeredOn("2026-02-01T00:00:00Z");
    await setPattern("KQ/{YY}/####");
    await service().backfillLearnerNumbers();

    expect(await numberOfId(old.id)).toBe("KQ/24/0001");
    expect(await numberOfId(recent.id)).toBe("KQ/26/0002");
  });

  it("carries on from the counter and leaves existing numbers alone", async () => {
    await setPattern("KQL-####");
    const numbered = await learner(await issue());
    const waiting = await registeredOn("2025-01-01T00:00:00Z");
    await service().backfillLearnerNumbers();

    expect(await numberOfId(numbered.id)).toBe("KQL-0001");
    expect(await numberOfId(waiting.id)).toBe("KQL-0002");
  });

  it("never numbers staff", async () => {
    const staff = await registeredOn("2024-01-01T00:00:00Z", { isStaff: true });
    const one = await registeredOn("2025-01-01T00:00:00Z");
    await setPattern("KQL-####");
    const result = await service().backfillLearnerNumbers();

    expect(result.numbered).toBe(1);
    expect(await numberOfId(staff.id)).toBeNull();
    expect(await numberOfId(one.id)).toBe("KQL-0001");
  });

  it("works through more learners than fit in one batch, with no gaps", async () => {
    await testDb.prisma.user.createMany({
      data: Array.from({ length: 230 }, (_, i) => ({
        email: `bulk-${i}@number.test`,
        name: `Bulk ${i}`,
        status: "ACTIVE" as const,
        createdAt: new Date(Date.UTC(2025, 0, 1, 0, i)),
      })),
    });
    await setPattern("KQL-####");
    const result = await service().backfillLearnerNumbers();

    expect(result).toMatchObject({ numbered: 230, first: "KQL-0001", last: "KQL-0230" });
    const numbers = (await testDb.prisma.user.findMany({ where: { email: { startsWith: "bulk-" } }, orderBy: { createdAt: "asc" } })).map(
      (u) => u.learnerNumber,
    );
    expect(numbers).toEqual(Array.from({ length: 230 }, (_, i) => `KQL-${String(i + 1).padStart(4, "0")}`));
    expect(await nextSequence()).toBe(231);
  }, 120_000);

  it("two backfills started at once number everyone exactly once, with no number wasted", async () => {
    for (let i = 0; i < 30; i++) await registeredOn(new Date(Date.UTC(2025, 0, 1 + i)).toISOString());
    await setPattern("KQL-####");

    const [a, b] = await Promise.all([service().backfillLearnerNumbers(), service().backfillLearnerNumbers()]);

    expect(a.numbered + b.numbered).toBe(30);
    const numbers = (await testDb.prisma.user.findMany({ where: { email: { startsWith: "backfill-" } } })).map((u) => u.learnerNumber);
    expect(new Set(numbers).size).toBe(30);
    expect(numbers.every(Boolean)).toBe(true);
    expect(await nextSequence()).toBe(31);
  }, 120_000);

  it("running it again numbers nobody and spends no number", async () => {
    await registeredOn("2025-01-01T00:00:00Z");
    await setPattern("KQL-####");
    await service().backfillLearnerNumbers();
    const again = await service().backfillLearnerNumbers();

    expect(again.numbered).toBe(0);
    expect(await nextSequence()).toBe(2);
  });
});
