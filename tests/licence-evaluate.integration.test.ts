/**
 * Real-Postgres proof for `evaluateAndRecord` (Phase 14, plan 14-09; LIC-04,
 * LIC-05, LIC-06, D-04, D-12, D-13, D-17): exactly-once version-guarded
 * transitions, the 24-hour attention window, the 10-minute rollback tolerance,
 * the 5-minute high-water throttle, audit-on-change and notice keys.
 *
 * Audit rows are written through the real redacting sink bound to the TEST
 * database client (never the configured DATABASE_URL singleton).
 *
 * PREREQUISITE: Docker must be running (`tests/support/pg.ts` starts the
 * container). If it is not, `beforeAll` fails with a container-start error:
 * every case reports BLOCKED, never a silent pass.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  DAY_MS,
  HIGH_WATER_WRITE_THROTTLE_MS,
  SKEW_TOLERANCE_MS,
  UNAVAILABLE_WINDOW_MS,
} from "@/server/licence/constants";
import { LicenceUnavailableError } from "@/server/licence/errors";
import type { TrustSet } from "@/server/licence/trust-set";
import { recordAuditInTransaction } from "@/server/services/audit-service";
import { createLicenceActivationService } from "@/server/services/licence-activation-service";
import { createLicenceService, type LicenceDbClient } from "@/server/services/licence-service";
import {
  createFixtureKey,
  FIXTURE_DEPLOYMENT_ID,
  FIXTURE_NOW,
  fixtureTrustSet,
  mintLicence,
  type MintedLicence,
} from "./support/licence-fixtures";
import { LICENCE_STATE_ID, resetLicenceTables, setDeploymentId } from "./support/licence-db";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";

let testDb: TestDatabase;
let actorId: string;

const key = createFixtureKey("evaluate-key");
const trustSet: TrustSet = fixtureTrustSet([key]);

beforeAll(async () => {
  testDb = await startTestDatabase();
  const actor = await testDb.prisma.user.create({
    data: {
      email: "evaluate-actor@licence-evaluate.test",
      name: "Evaluate Actor",
      status: "ACTIVE",
      emailVerified: new Date(),
      isStaff: true,
    },
  });
  actorId = actor.id;
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

beforeEach(async () => {
  await testDb.prisma
    .$executeRaw`INSERT INTO "DeploymentIdentity" ("id") VALUES ('deployment') ON CONFLICT DO NOTHING`;
  await testDb.prisma
    .$executeRaw`INSERT INTO "LicenceState" ("id", "highWaterAt", "updatedAt") VALUES ('current', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING`;
  await resetLicenceTables(testDb.prisma);
  await setDeploymentId(testDb.prisma, FIXTURE_DEPLOYMENT_ID);
  await setHighWater(FIXTURE_NOW);
  await testDb.prisma.auditEvent.deleteMany({ where: { action: { startsWith: "licence." } } });
});

type Clock = { now: () => Date; set: (next: Date) => void };

function makeClock(initial: Date): Clock {
  let ms = initial.getTime();
  return {
    now: () => new Date(ms),
    set(next: Date) {
      ms = next.getTime();
    },
  };
}

function makeService(options: {
  clock: Clock;
  trustLoader?: () => TrustSet;
  monotonicNow?: () => number;
}) {
  return createLicenceService({
    db: testDb.prisma,
    trustSet: options.trustLoader ?? (() => trustSet),
    audit: (event) => recordAuditInTransaction(testDb.prisma, event),
    now: options.clock.now,
    // A constant monotonic source keeps the in-process monitor silent unless a
    // case drives it explicitly.
    monotonicNow: options.monotonicNow ?? (() => 0),
    log: () => undefined,
  });
}

async function activate(): Promise<{
  minted: MintedLicence;
  licenceId: string;
  expiresAt: Date;
  graceEndsAt: Date;
}> {
  const minted = mintLicence({ key });
  const activation = createLicenceActivationService({
    db: testDb.prisma,
    trustSet: () => trustSet,
    audit: (event) => recordAuditInTransaction(testDb.prisma, event),
    auditInTransaction: (tx, event) => recordAuditInTransaction(tx, event),
    now: () => FIXTURE_NOW,
  });
  expect((await activation.activateLicence({ actorId, raw: minted.raw })).ok).toBe(true);
  const payload = minted.payload as { licenceId: string; expiresAt: string; graceEndsAt: string };
  return {
    minted,
    licenceId: payload.licenceId,
    expiresAt: new Date(payload.expiresAt),
    graceEndsAt: new Date(payload.graceEndsAt),
  };
}

async function setHighWater(at: Date): Promise<void> {
  await testDb.prisma.licenceState.update({ where: { id: LICENCE_STATE_ID }, data: { highWaterAt: at } });
}

async function stateRow() {
  return testDb.prisma.licenceState.findUniqueOrThrow({ where: { id: LICENCE_STATE_ID } });
}

async function auditRows(action: string) {
  return testDb.prisma.auditEvent.findMany({ where: { action }, orderBy: { createdAt: "asc" } });
}

function tampered(raw: string): string {
  const parts = raw.split(".");
  const mid = Math.floor(parts[2].length / 2);
  parts[2] = `${parts[2].slice(0, mid)}${parts[2][mid] === "A" ? "B" : "A"}${parts[2].slice(mid + 1)}`;
  return parts.join(".");
}

const unavailableLoader = (): TrustSet => {
  throw new LicenceUnavailableError("trust set could not be loaded");
};

describe("transitions are recorded exactly once", () => {
  it("records ACTIVE to GRACE with one audit row, a version bump and the expired notice key", async () => {
    const { expiresAt, licenceId } = await activate();
    const clock = makeClock(new Date(expiresAt.getTime() + 60 * 60 * 1000));
    const service = makeService({ clock });
    const versionBefore = (await stateRow()).version;

    const first = await service.evaluateAndRecord({ source: "REQUEST", correlationId: "corr-eval-1" });

    expect(first.transitions).toEqual([{ from: "ACTIVE", to: "GRACE", won: true }]);
    expect(first.snapshot.state).toBe("GRACE");
    expect(first.noticeKeys).toContain("expired");
    expect(first.rollbackDetected).toBe(false);
    expect(first.verificationChanged).toBe(false);

    const state = await stateRow();
    expect(state.state).toBe("GRACE");
    expect(state.version).toBe(versionBefore + 1);
    expect(state.restrictedAt).toBeNull();

    const rows = await auditRows("licence.state_changed");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: null,
      actorType: "SYSTEM",
      targetType: "LICENCE",
      targetId: licenceId,
      scopeType: "GLOBAL",
      outcome: "SUCCESS",
      correlationId: "corr-eval-1",
    });
    expect(rows[0].before).toEqual({ state: "ACTIVE", reasonCode: null });
    expect(rows[0].after).toMatchObject({ state: "GRACE", reasonCode: null, source: "REQUEST" });

    // A second evaluation with the same clock records nothing new.
    const second = await service.evaluateAndRecord({ source: "REQUEST" });
    expect(second.transitions).toEqual([]);
    expect(await auditRows("licence.state_changed")).toHaveLength(1);
    expect((await stateRow()).version).toBe(state.version);
    expect(second.noticeKeys).toContain("expired");
  });

  it("records GRACE to RESTRICTED_CONTINUITY with restrictedAt equal to graceEndsAt and the restricted notice key", async () => {
    const { expiresAt, graceEndsAt } = await activate();
    const clock = makeClock(new Date(expiresAt.getTime() + 60 * 60 * 1000));
    const service = makeService({ clock });
    await service.evaluateAndRecord({ source: "REQUEST" });

    clock.set(new Date(graceEndsAt.getTime() + 60 * 60 * 1000));
    const result = await service.evaluateAndRecord({ source: "REQUEST" });

    expect(result.transitions).toEqual([{ from: "GRACE", to: "RESTRICTED_CONTINUITY", won: true }]);
    expect(result.noticeKeys).toEqual(["restricted"]);
    const state = await stateRow();
    expect(state.state).toBe("RESTRICTED_CONTINUITY");
    expect(state.restrictedAt?.getTime()).toBe(graceEndsAt.getTime());
    expect(result.snapshot.restrictedAt?.getTime()).toBe(graceEndsAt.getTime());
  });

  it("five simultaneous evaluations produce one winner, one audit row and one version increment", async () => {
    const { expiresAt } = await activate();
    const at = new Date(expiresAt.getTime() + 60 * 60 * 1000);
    const versionBefore = (await stateRow()).version;

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        makeService({ clock: makeClock(at) }).evaluateAndRecord({ source: "REQUEST" }),
      ),
    );

    const winners = results.filter((r) => r.transitions.some((t) => t.won));
    expect(winners).toHaveLength(1);
    expect(winners[0].transitions).toEqual([{ from: "ACTIVE", to: "GRACE", won: true }]);
    const allTransitions = results.flatMap((r) => r.transitions);
    expect(allTransitions.filter((t) => t.won)).toHaveLength(1);
    for (const result of results) expect(result.snapshot.state).toBe("GRACE");
    expect(await auditRows("licence.state_changed")).toHaveLength(1);
    const state = await stateRow();
    expect(state.state).toBe("GRACE");
    expect(state.version).toBe(versionBefore + 1);
  });
});

describe("a lost version-guarded write never audits", () => {
  it("a stale write reports the winner's state with won false, writes no audit row and does not retry the transition", async () => {
    const { expiresAt } = await activate();
    const at = new Date(expiresAt.getTime() + 60 * 60 * 1000);
    let interfered = false;
    // Another instance commits the same transition between our read and our write.
    const racingDb = {
      licenceState: testDb.prisma.licenceState,
      licenceRecord: testDb.prisma.licenceRecord,
      deploymentIdentity: testDb.prisma.deploymentIdentity,
      $queryRaw: testDb.prisma.$queryRaw.bind(testDb.prisma),
      $executeRaw: testDb.prisma.$executeRaw.bind(testDb.prisma),
      $transaction: (fn: (tx: unknown) => Promise<unknown>, options?: { timeout?: number }) =>
        testDb.prisma.$transaction(async (tx) => {
          const racingState = new Proxy(tx.licenceState, {
            get(target, prop, receiver) {
              if (prop === "updateMany" && !interfered) {
                return async (args: Parameters<typeof target.updateMany>[0]) => {
                  interfered = true;
                  await testDb.prisma.licenceState.update({
                    where: { id: LICENCE_STATE_ID },
                    data: { state: "GRACE", version: { increment: 1 } },
                  });
                  return Reflect.get(target, prop, receiver)(args);
                };
              }
              return Reflect.get(target, prop, receiver);
            },
          });
          const racingTx = new Proxy(tx, {
            get(target, prop, receiver) {
              if (prop === "licenceState") return racingState;
              return Reflect.get(target, prop, receiver);
            },
          });
          return fn(racingTx);
        }, options),
    } as unknown as LicenceDbClient;
    const service = createLicenceService({
      db: racingDb,
      trustSet: () => trustSet,
      audit: (event) => recordAuditInTransaction(testDb.prisma, event),
      now: () => at,
      monotonicNow: () => 0,
      log: () => undefined,
    });
    const versionBefore = (await stateRow()).version;

    const result = await service.evaluateAndRecord({ source: "REQUEST" });

    expect(interfered).toBe(true);
    expect(result.transitions).toEqual([{ from: "ACTIVE", to: "GRACE", won: false }]);
    expect(result.snapshot.state).toBe("GRACE");
    // Only the interfering write landed: one version bump, and no audit row from the loser.
    expect((await stateRow()).version).toBe(versionBefore + 1);
    expect(await auditRows("licence.state_changed")).toHaveLength(0);
  });
});

describe("the 24-hour local-failure window (D-04)", () => {
  it("enters attention, holds for 23 hours, becomes INVALID at exactly 24 hours and recovers", async () => {
    await activate();
    const t0 = new Date(FIXTURE_NOW.getTime() + 60 * 60 * 1000);
    const clock = makeClock(t0);
    const failing = makeService({ clock, trustLoader: unavailableLoader });

    const entered = await failing.evaluateAndRecord({ source: "REQUEST" });
    expect(entered.transitions).toEqual([{ from: "ACTIVE", to: "VALIDATION_ATTENTION", won: true }]);
    expect(entered.snapshot.state).toBe("VALIDATION_ATTENTION");
    expect(entered.noticeKeys).toEqual([`validation-attention-${Math.floor(t0.getTime() / 1000)}`]);
    let state = await stateRow();
    expect(state.state).toBe("VALIDATION_ATTENTION");
    expect(state.attentionSince?.getTime()).toBe(t0.getTime());
    expect(state.restrictedAt).toBeNull();
    expect(await auditRows("licence.state_changed")).toHaveLength(1);
    const verified = await auditRows("licence.verified");
    expect(verified).toHaveLength(1);
    expect(verified[0].before).toEqual({ outcome: "OK" });
    expect(verified[0].after).toMatchObject({ outcome: "UNAVAILABLE" });
    expect(state.lastVerificationOutcome).toBe("UNAVAILABLE");

    // 23 hours later: nothing changes (state, version and audit all stay put).
    clock.set(new Date(t0.getTime() + 23 * 60 * 60 * 1000));
    // Keep the throttled high-water write out of the picture: this case is about state.
    await setHighWater(clock.now());
    const versionAt23 = (await stateRow()).version;
    const held = await failing.evaluateAndRecord({ source: "REQUEST" });
    expect(held.transitions).toEqual([]);
    expect(held.snapshot.state).toBe("VALIDATION_ATTENTION");
    expect((await stateRow()).version).toBe(versionAt23);
    expect(await auditRows("licence.state_changed")).toHaveLength(1);

    // One millisecond before 24 hours: still attention.
    clock.set(new Date(t0.getTime() + UNAVAILABLE_WINDOW_MS - 1));
    expect((await failing.evaluateAndRecord({ source: "REQUEST" })).snapshot.state).toBe(
      "VALIDATION_ATTENTION",
    );

    // Exactly 24 hours after attentionSince: INVALID with the exhausted reason, restricted.
    const exhaustedAt = new Date(t0.getTime() + UNAVAILABLE_WINDOW_MS);
    clock.set(exhaustedAt);
    const exhausted = await failing.evaluateAndRecord({ source: "REQUEST" });
    expect(exhausted.transitions).toEqual([
      { from: "VALIDATION_ATTENTION", to: "INVALID", won: true },
    ]);
    expect(exhausted.snapshot.reasonCode).toBe("VALIDATION_WINDOW_EXHAUSTED");
    expect(exhausted.noticeKeys).toEqual(["invalid-VALIDATION_WINDOW_EXHAUSTED"]);
    state = await stateRow();
    expect(state.state).toBe("INVALID");
    expect(state.reasonCode).toBe("VALIDATION_WINDOW_EXHAUSTED");
    expect(state.restrictedAt?.getTime()).toBe(exhaustedAt.getTime());
    expect(state.attentionSince?.getTime()).toBe(t0.getTime());

    // Still unavailable an hour later: INVALID holds, the stamp is not moved, no flapping.
    clock.set(new Date(exhaustedAt.getTime() + 60 * 60 * 1000));
    const stillInvalid = await failing.evaluateAndRecord({ source: "REQUEST" });
    expect(stillInvalid.transitions).toEqual([]);
    expect(stillInvalid.snapshot.state).toBe("INVALID");
    expect((await stateRow()).restrictedAt?.getTime()).toBe(exhaustedAt.getTime());

    // A working trust set returns to the time-derived state and clears the window.
    const recoveredAt = new Date(exhaustedAt.getTime() + 2 * 60 * 60 * 1000);
    const healthy = makeService({ clock: makeClock(recoveredAt) });
    const recovered = await healthy.evaluateAndRecord({ source: "REQUEST" });
    expect(recovered.transitions).toEqual([{ from: "INVALID", to: "ACTIVE", won: true }]);
    state = await stateRow();
    expect(state.state).toBe("ACTIVE");
    expect(state.reasonCode).toBeNull();
    expect(state.attentionSince).toBeNull();
    expect(state.restrictedAt).toBeNull();
    expect(state.lastVerificationOutcome).toBe("OK");
    expect(await auditRows("licence.state_changed")).toHaveLength(3);
  });

  it("keeps restrictedAt unchanged while in attention after a restriction was already stamped", async () => {
    const { graceEndsAt } = await activate();
    const restrictedClock = makeClock(new Date(graceEndsAt.getTime() + 60_000));
    await makeService({ clock: restrictedClock }).evaluateAndRecord({ source: "REQUEST" });
    const stamped = (await stateRow()).restrictedAt;
    expect(stamped?.getTime()).toBe(graceEndsAt.getTime());

    const failing = makeService({
      clock: makeClock(new Date(graceEndsAt.getTime() + 120_000)),
      trustLoader: unavailableLoader,
    });
    const result = await failing.evaluateAndRecord({ source: "REQUEST" });

    expect(result.snapshot.state).toBe("VALIDATION_ATTENTION");
    expect(result.snapshot.isRestricted).toBe(true);
    expect((await stateRow()).restrictedAt?.getTime()).toBe(graceEndsAt.getTime());
  });
});

describe("clock rollback (D-12): detected, audited, alerted, never a lock-out", () => {
  it("tolerates exactly 10 minutes and reports 10 minutes plus 1 ms once, without changing the licence state", async () => {
    await activate();
    const at = new Date(FIXTURE_NOW.getTime() + 60 * 60 * 1000);
    const service = makeService({ clock: makeClock(at) });
    // Bring the stored state in line with the evaluation instant first.
    await service.evaluateAndRecord({ source: "REQUEST" });

    await setHighWater(new Date(at.getTime() + SKEW_TOLERANCE_MS));
    const within = await service.evaluateAndRecord({ source: "REQUEST" });
    expect(within.rollbackDetected).toBe(false);
    expect(await auditRows("licence.clock_rollback")).toHaveLength(0);

    const stateBefore = await stateRow();
    await setHighWater(new Date(at.getTime() + SKEW_TOLERANCE_MS + 1));
    const detected = await service.evaluateAndRecord({ source: "REQUEST" });

    expect(detected.rollbackDetected).toBe(true);
    expect(detected.noticeKeys).toContain(`clock-rollback-${at.toISOString().slice(0, 13)}`);
    expect(detected.transitions).toEqual([]);
    const rows = await auditRows("licence.clock_rollback");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorType: "SYSTEM", targetType: "LICENCE", outcome: "DETECTED" });
    expect(rows[0].after).toMatchObject({ detectedBy: "STORED_MARK", behindSeconds: 600 });

    const after = await stateRow();
    expect(after.clockAlertAt?.getTime()).toBe(at.getTime());
    expect(after.highWaterAt.getTime()).toBe(at.getTime());
    // The licence state is identical before and after (prohibition: no lock-out).
    expect(after.state).toBe(stateBefore.state);
    expect(after.reasonCode).toBe(stateBefore.reasonCode);
    expect(after.restrictedAt).toEqual(stateBefore.restrictedAt);
    expect(after.activeRecordId).toBe(stateBefore.activeRecordId);
    expect(await auditRows("licence.state_changed")).toHaveLength(0);

    // Re-baselined: the same anomaly is not reported again.
    const again = await service.evaluateAndRecord({ source: "REQUEST" });
    expect(again.rollbackDetected).toBe(false);
    expect(await auditRows("licence.clock_rollback")).toHaveLength(1);
  });

  it("a large rollback never blocks anyone: the gate still allows", async () => {
    await activate();
    const at = new Date(FIXTURE_NOW.getTime() + 60 * 60 * 1000);
    const service = makeService({ clock: makeClock(at) });
    await service.evaluateAndRecord({ source: "REQUEST" });
    await setHighWater(new Date(at.getTime() + 30 * DAY_MS));

    const result = await service.evaluateAndRecord({ source: "SCHEDULED" });
    expect(result.rollbackDetected).toBe(true);
    expect(result.snapshot.isRestricted).toBe(false);
    expect(await service.checkWriteGate({ operation: "x", actorId: actorId })).toEqual({ allowed: true });
  });

  it("the in-process monotonic comparison reports a backward step the stored mark cannot", async () => {
    await activate();
    const clock = makeClock(new Date(FIXTURE_NOW.getTime() + 60 * 60 * 1000));
    const service = makeService({ clock, monotonicNow: () => 0 });

    // First sample is the baseline.
    expect((await service.evaluateAndRecord({ source: "REQUEST" })).rollbackDetected).toBe(false);
    // The stored mark is far behind, so only the monotonic comparison can notice.
    const stepBack = new Date(clock.now().getTime() - SKEW_TOLERANCE_MS - 1000);
    await setHighWater(new Date(stepBack.getTime() - DAY_MS));
    clock.set(stepBack);

    const result = await service.evaluateAndRecord({ source: "REQUEST" });

    expect(result.rollbackDetected).toBe(true);
    const rows = await auditRows("licence.clock_rollback");
    expect(rows).toHaveLength(1);
    expect(rows[0].after).toMatchObject({ detectedBy: "MONOTONIC" });
  });
});

describe("the high-water mark is throttled to one write per 5 minutes", () => {
  it("does not advance within 5 minutes and advances to now one millisecond beyond", async () => {
    await activate();
    const at = new Date(FIXTURE_NOW.getTime() + 60 * 60 * 1000);
    const service = makeService({ clock: makeClock(at) });
    await service.evaluateAndRecord({ source: "REQUEST" });

    const within = new Date(at.getTime() - HIGH_WATER_WRITE_THROTTLE_MS);
    await setHighWater(within);
    const versionBefore = (await stateRow()).version;
    await service.evaluateAndRecord({ source: "REQUEST" });
    let state = await stateRow();
    expect(state.highWaterAt.getTime()).toBe(within.getTime());
    expect(state.version).toBe(versionBefore);

    await setHighWater(new Date(at.getTime() - HIGH_WATER_WRITE_THROTTLE_MS - 1));
    await service.evaluateAndRecord({ source: "REQUEST" });
    state = await stateRow();
    expect(state.highWaterAt.getTime()).toBe(at.getTime());
    expect(state.version).toBe(versionBefore + 1);
  });

  it("never moves the mark backwards while the clock is within the tolerance", async () => {
    await activate();
    const at = new Date(FIXTURE_NOW.getTime() + 60 * 60 * 1000);
    const service = makeService({ clock: makeClock(at) });
    await service.evaluateAndRecord({ source: "REQUEST" });
    const ahead = new Date(at.getTime() + 5 * 60 * 1000);
    await setHighWater(ahead);

    await service.evaluateAndRecord({ source: "SCHEDULED" });

    expect((await stateRow()).highWaterAt.getTime()).toBe(ahead.getTime());
  });
});

describe("verification outcome is audited only on change", () => {
  it("a tampered stored text goes INVALID with one licence.verified row (OK to FAILED) and no repeat", async () => {
    const { minted, licenceId } = await activate();
    const at = new Date(FIXTURE_NOW.getTime() + 60 * 60 * 1000);
    const service = makeService({ clock: makeClock(at) });
    await service.evaluateAndRecord({ source: "REQUEST" });
    const baseline = (await auditRows("licence.verified")).length;
    expect(baseline).toBe(0);

    await testDb.prisma.licenceRecord.update({
      where: { licenceId },
      data: { raw: tampered(minted.raw) },
    });
    const result = await service.evaluateAndRecord({ source: "SCHEDULED" });

    expect(result.verificationChanged).toBe(true);
    expect(result.transitions).toEqual([{ from: "ACTIVE", to: "INVALID", won: true }]);
    expect(result.noticeKeys).toHaveLength(1);
    expect(result.noticeKeys[0]).toMatch(/^invalid-(BAD_SIGNATURE|BAD_FORMAT)$/);
    const verified = await auditRows("licence.verified");
    expect(verified).toHaveLength(1);
    expect(verified[0].before).toEqual({ outcome: "OK" });
    expect(verified[0].after).toMatchObject({ outcome: "FAILED" });
    expect(verified[0].outcome).toBe("FAILED");
    const state = await stateRow();
    expect(state.state).toBe("INVALID");
    expect(state.lastVerificationOutcome).toBe("FAILED");
    expect(state.restrictedAt?.getTime()).toBe(at.getTime());
    // No raw text or signature in any licence audit row.
    const everything = JSON.stringify(await testDb.prisma.auditEvent.findMany({
      where: { action: { startsWith: "licence." } },
    }));
    expect(everything).not.toContain(minted.raw.slice(0, 40));

    const repeat = await service.evaluateAndRecord({ source: "SCHEDULED" });
    expect(repeat.verificationChanged).toBe(false);
    expect(repeat.transitions).toEqual([]);
    expect(await auditRows("licence.verified")).toHaveLength(1);
    expect(await auditRows("licence.state_changed")).toHaveLength(1);
  });
});

describe("source semantics", () => {
  it("REQUEST writes nothing when the derived state equals the stored one and there is no rollback", async () => {
    await activate();
    const service = makeService({ clock: makeClock(FIXTURE_NOW) });
    const stateBefore = await stateRow();
    const auditBefore = await testDb.prisma.auditEvent.count();

    const result = await service.evaluateAndRecord({ source: "REQUEST" });

    expect(result.transitions).toEqual([]);
    expect(result.snapshot.state).toBe("ACTIVE");
    expect(await stateRow()).toEqual(stateBefore);
    expect(await testDb.prisma.auditEvent.count()).toBe(auditBefore);
  });

  it("SCHEDULED and STARTUP refresh lastVerifiedAt, the outcome and lastGoodAt on every call without an audit row", async () => {
    await activate();
    const clock = makeClock(new Date(FIXTURE_NOW.getTime() + 10 * 60 * 1000));
    const service = makeService({ clock });
    const auditBefore = await testDb.prisma.auditEvent.count();

    await service.evaluateAndRecord({ source: "SCHEDULED" });
    let state = await stateRow();
    expect(state.lastVerifiedAt?.getTime()).toBe(clock.now().getTime());
    expect(state.lastVerificationOutcome).toBe("OK");
    expect(state.lastGoodAt?.getTime()).toBe(clock.now().getTime());
    const versionAfterFirst = state.version;

    clock.set(new Date(clock.now().getTime() + 60_000));
    await service.evaluateAndRecord({ source: "STARTUP" });
    state = await stateRow();
    expect(state.lastVerifiedAt?.getTime()).toBe(clock.now().getTime());
    expect(state.version).toBe(versionAfterFirst + 1);
    expect(await testDb.prisma.auditEvent.count()).toBe(auditBefore);
  });

  it("a deployment that never activated has nothing to verify: no verification fields, no audit row", async () => {
    const service = makeService({ clock: makeClock(FIXTURE_NOW) });

    const result = await service.evaluateAndRecord({ source: "SCHEDULED" });

    expect(result.snapshot.state).toBe("UNLICENSED");
    expect(result.transitions).toEqual([]);
    expect(result.noticeKeys).toEqual([]);
    const state = await stateRow();
    expect(state.lastVerifiedAt).toBeNull();
    expect(state.lastVerificationOutcome).toBeNull();
    expect(await testDb.prisma.auditEvent.count({ where: { action: { startsWith: "licence." } } })).toBe(0);
  });
});
