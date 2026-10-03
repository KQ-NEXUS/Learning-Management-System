/**
 * Real-Postgres proof for the licence write gate and the restriction cutoff
 * (Phase 14, plan 14-09; LIC-04, LIC-05, LIC-06, D-04, D-08, D-13).
 *
 * Tracer: a stored licence is allowed one millisecond before graceEndsAt and
 * blocked at graceEndsAt through the real database path, by separate service
 * instances sharing nothing but the database.
 *
 * Audit rows are written through the real redacting sink bound to the TEST
 * database client (never the configured DATABASE_URL singleton).
 *
 * PREREQUISITE: Docker must be running (`tests/support/pg.ts` starts the
 * container). If it is not, `beforeAll` fails with a container-start error:
 * every case reports BLOCKED, never a silent pass.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DAY_MS, UNAVAILABLE_WINDOW_MS } from "@/server/licence/constants";
import { LicenceWriteBlockedError } from "@/server/licence/errors";
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
let actorA: string;
let actorB: string;

const key = createFixtureKey("gate-key");
const trustSet: TrustSet = fixtureTrustSet([key]);

beforeAll(async () => {
  testDb = await startTestDatabase();
  const make = async (email: string) =>
    (
      await testDb.prisma.user.create({
        data: { email, name: email, status: "ACTIVE", emailVerified: new Date(), isStaff: true },
      })
    ).id;
  actorA = await make("gate-actor-a@licence-gate.test");
  actorB = await make("gate-actor-b@licence-gate.test");
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
  // The reset stamps the real wall clock; the gate tests run on the fixture timeline.
  await testDb.prisma.licenceState.update({
    where: { id: LICENCE_STATE_ID },
    data: { highWaterAt: FIXTURE_NOW },
  });
  await testDb.prisma.auditEvent.deleteMany({ where: { action: { startsWith: "licence." } } });
});

function makeClock(initial: Date) {
  let ms = initial.getTime();
  return {
    now: () => new Date(ms),
    set(next: Date) {
      ms = next.getTime();
    },
  };
}

type Clock = ReturnType<typeof makeClock>;

const silent = () => undefined;

function makeService(options: { clock: Clock; db?: LicenceDbClient; trust?: TrustSet }) {
  return createLicenceService({
    db: options.db ?? testDb.prisma,
    trustSet: () => options.trust ?? trustSet,
    audit: (event) => recordAuditInTransaction(testDb.prisma, event),
    now: options.clock.now,
    // The injected wall clock moves in steps no real monotonic source follows;
    // a constant monotonic source keeps the in-process monitor out of these cases.
    monotonicNow: () => 0,
    log: silent,
  });
}

/** Activates the default fixture licence (90 days, 14 days of grace) at FIXTURE_NOW. */
async function activate(): Promise<{ minted: MintedLicence; expiresAt: Date; graceEndsAt: Date }> {
  const minted = mintLicence({ key });
  const clock = makeClock(FIXTURE_NOW);
  const activation = createLicenceActivationService({
    db: testDb.prisma,
    trustSet: () => trustSet,
    audit: (event) => recordAuditInTransaction(testDb.prisma, event),
    auditInTransaction: (tx, event) => recordAuditInTransaction(tx, event),
    now: clock.now,
  });
  const result = await activation.activateLicence({ actorId: actorA, raw: minted.raw });
  expect(result.ok).toBe(true);
  const payload = minted.payload as { expiresAt: string; graceEndsAt: string };
  return {
    minted,
    expiresAt: new Date(payload.expiresAt),
    graceEndsAt: new Date(payload.graceEndsAt),
  };
}

async function enforcementRows() {
  return testDb.prisma.auditEvent.findMany({
    where: { action: "licence.restriction_enforced" },
    orderBy: { createdAt: "asc" },
  });
}

async function stateRow() {
  return testDb.prisma.licenceState.findUniqueOrThrow({ where: { id: LICENCE_STATE_ID } });
}

/** A client whose LicenceState read throws while `failing.value` is true. */
function failingDb(failing: { value: boolean }): LicenceDbClient {
  const licenceState = new Proxy(testDb.prisma.licenceState, {
    get(target, prop) {
      if (prop === "findUnique" && failing.value) {
        return async () => {
          throw new Error("simulated licence state read failure");
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return new Proxy(testDb.prisma, {
    get(target, prop) {
      if (prop === "licenceState") return licenceState;
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as LicenceDbClient;
}

describe("tracer: the exact grace boundary on a real database", () => {
  it("allows one millisecond before graceEndsAt and reports no restriction", async () => {
    const { graceEndsAt } = await activate();
    const service = makeService({ clock: makeClock(new Date(graceEndsAt.getTime() - 1)) });

    expect(await service.checkWriteGate({ operation: "course.edit", actorId: actorA })).toEqual({
      allowed: true,
    });
    expect(await enforcementRows()).toHaveLength(0);
    expect(await service.getRestrictionCutoff()).toEqual({ restricted: false, restrictedAt: null });
  });

  it("blocks exactly at graceEndsAt, audits one denial and reports the exact restriction instant", async () => {
    const { graceEndsAt } = await activate();
    const service = makeService({ clock: makeClock(graceEndsAt) });

    const decision = await service.checkWriteGate({ operation: "course.edit", actorId: actorA });

    expect(decision).toEqual({ allowed: false, state: "RESTRICTED_CONTINUITY", reasonCode: null });
    const rows = await enforcementRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: actorA,
      actorType: "USER",
      targetType: "LICENCE",
      scopeType: "GLOBAL",
      outcome: "DENIED",
    });
    expect(rows[0].after).toMatchObject({ operation: "course.edit", state: "RESTRICTED_CONTINUITY" });

    const cutoff = await service.getRestrictionCutoff();
    expect(cutoff.restricted).toBe(true);
    expect(cutoff.restrictedAt?.getTime()).toBe(graceEndsAt.getTime());
  });

  it("separate instances over one database agree at the boundary, and the opportunistic transition is recorded once", async () => {
    const { graceEndsAt } = await activate();
    const before = makeService({ clock: makeClock(new Date(graceEndsAt.getTime() - 1)) });
    const at = makeService({ clock: makeClock(graceEndsAt) });
    const alsoAt = makeService({ clock: makeClock(graceEndsAt) });

    expect((await before.checkWriteGate({ operation: "x", actorId: actorA })).allowed).toBe(true);
    expect((await at.checkWriteGate({ operation: "x", actorId: actorA })).allowed).toBe(false);
    expect((await alsoAt.checkWriteGate({ operation: "x", actorId: actorB })).allowed).toBe(false);

    const state = await stateRow();
    expect(state.state).toBe("RESTRICTED_CONTINUITY");
    expect(state.restrictedAt?.getTime()).toBe(graceEndsAt.getTime());
    // ACTIVE to GRACE (recorded by the first call) and GRACE to RESTRICTED_CONTINUITY.
    const transitions = await testDb.prisma.auditEvent.findMany({
      where: { action: "licence.state_changed" },
      orderBy: { createdAt: "asc" },
    });
    expect(transitions.map((row) => (row.after as { state: string }).state)).toEqual([
      "GRACE",
      "RESTRICTED_CONTINUITY",
    ]);
  });

  it("writes nothing on the allow path when the stored state already matches", async () => {
    await activate();
    const service = makeService({ clock: makeClock(FIXTURE_NOW) });
    const stateBefore = await stateRow();
    const auditBefore = await testDb.prisma.auditEvent.count();

    expect(await service.checkWriteGate({ operation: "course.edit", actorId: actorA })).toEqual({
      allowed: true,
    });

    expect(await stateRow()).toEqual(stateBefore);
    expect(await testDb.prisma.auditEvent.count()).toBe(auditBefore);
  });
});

describe("enforcement audit coalescing (A14)", () => {
  it("writes at most one row per actor per minute", async () => {
    const { graceEndsAt } = await activate();
    const clock = makeClock(graceEndsAt);
    const service = makeService({ clock });

    await service.checkWriteGate({ operation: "a", actorId: actorA });
    expect(await enforcementRows()).toHaveLength(1);

    clock.set(new Date(graceEndsAt.getTime() + 59_999));
    await service.checkWriteGate({ operation: "a", actorId: actorA });
    expect(await enforcementRows()).toHaveLength(1);

    await service.checkWriteGate({ operation: "a", actorId: actorB });
    expect(await enforcementRows()).toHaveLength(2);

    clock.set(new Date(graceEndsAt.getTime() + 60_000));
    await service.checkWriteGate({ operation: "a", actorId: actorA });
    expect(await enforcementRows()).toHaveLength(3);
  });

  it("an actorless caller is audited as the system actor and coalesced under one key", async () => {
    const { graceEndsAt } = await activate();
    const service = makeService({ clock: makeClock(graceEndsAt) });

    await service.checkWriteGate({ operation: "task", actorId: null });
    await service.checkWriteGate({ operation: "task", actorId: null });

    const rows = await enforcementRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: null, actorType: "SYSTEM" });
  });

  it("an audit failure is swallowed and never changes the decision", async () => {
    const { graceEndsAt } = await activate();
    const service = createLicenceService({
      db: testDb.prisma,
      trustSet: () => trustSet,
      audit: async () => {
        throw new Error("audit sink unavailable");
      },
      now: makeClock(graceEndsAt).now,
      monotonicNow: () => 0,
      log: silent,
    });

    expect(await service.checkWriteGate({ operation: "x", actorId: actorA })).toEqual({
      allowed: false,
      state: "RESTRICTED_CONTINUITY",
      reasonCode: null,
    });
  });
});

describe("never-activated deployment (OQ1 option-a)", () => {
  it("is fully operational: the gate allows and the cutoff reports no restriction", async () => {
    const service = makeService({ clock: makeClock(FIXTURE_NOW) });

    expect(await service.checkWriteGate({ operation: "course.edit", actorId: actorA })).toEqual({
      allowed: true,
    });
    expect(await service.getRestrictionCutoff()).toEqual({ restricted: false, restrictedAt: null });
    expect(await enforcementRows()).toHaveLength(0);
  });
});

describe("assertWriteAllowed", () => {
  it("resolves when allowed and rejects with LicenceWriteBlockedError when blocked", async () => {
    const { graceEndsAt } = await activate();
    const allowed = makeService({ clock: makeClock(new Date(graceEndsAt.getTime() - 1)) });
    const blocked = makeService({ clock: makeClock(graceEndsAt) });

    await expect(allowed.assertWriteAllowed({ operation: "x" })).resolves.toBeUndefined();
    await expect(blocked.assertWriteAllowed({ operation: "x", actorId: actorA })).rejects.toBeInstanceOf(
      LicenceWriteBlockedError,
    );
    await expect(blocked.assertWriteAllowed({ operation: "x" })).rejects.toThrow(
      "This action is temporarily unavailable.",
    );
  });
});

describe("a read failure is bounded to 24 hours (D-04)", () => {
  it("with no successful read yet allows, even past 24 hours, because nothing is known to enforce (OQ1 option-a)", async () => {
    await activate();
    const failing = { value: true };
    const clock = makeClock(FIXTURE_NOW);
    const service = makeService({ clock, db: failingDb(failing) });

    expect(await service.checkWriteGate({ operation: "x", actorId: actorA })).toEqual({ allowed: true });

    clock.set(new Date(FIXTURE_NOW.getTime() + UNAVAILABLE_WINDOW_MS - 1));
    expect(await service.checkWriteGate({ operation: "x", actorId: actorA })).toEqual({ allowed: true });

    clock.set(new Date(FIXTURE_NOW.getTime() + UNAVAILABLE_WINDOW_MS));
    expect(await service.checkWriteGate({ operation: "x", actorId: actorA })).toEqual({ allowed: true });
  });

  it("a deployment last read as never activated is never blocked by a read failure (OQ1 option-a)", async () => {
    const failing = { value: false };
    const clock = makeClock(FIXTURE_NOW);
    const service = makeService({ clock, db: failingDb(failing) });

    // A successful read of an un-activated deployment establishes the last-known-good state.
    expect(await service.checkWriteGate({ operation: "x", actorId: actorA })).toEqual({ allowed: true });

    failing.value = true;
    clock.set(new Date(FIXTURE_NOW.getTime() + 3 * UNAVAILABLE_WINDOW_MS));
    expect(await service.checkWriteGate({ operation: "x", actorId: actorA })).toEqual({ allowed: true });
  });

  it("keeps a blocked last-known-good decision until exactly 24 hours, and recovery restarts the window", async () => {
    const { graceEndsAt } = await activate();
    const failing = { value: false };
    const clock = makeClock(new Date(graceEndsAt.getTime() + 60 * 60 * 1000));
    const service = makeService({ clock, db: failingDb(failing) });

    // One successful blocked call establishes the last-known-good decision.
    expect(await service.checkWriteGate({ operation: "x", actorId: actorA })).toMatchObject({
      allowed: false,
      state: "RESTRICTED_CONTINUITY",
    });

    failing.value = true;
    const firstFailureAt = new Date(graceEndsAt.getTime() + 2 * 60 * 60 * 1000);
    clock.set(firstFailureAt);
    expect(await service.checkWriteGate({ operation: "x", actorId: actorA })).toEqual({
      allowed: false,
      state: "RESTRICTED_CONTINUITY",
      reasonCode: null,
    });

    clock.set(new Date(firstFailureAt.getTime() + UNAVAILABLE_WINDOW_MS - 1));
    expect(await service.checkWriteGate({ operation: "x", actorId: actorA })).toEqual({
      allowed: false,
      state: "RESTRICTED_CONTINUITY",
      reasonCode: null,
    });

    clock.set(new Date(firstFailureAt.getTime() + UNAVAILABLE_WINDOW_MS));
    expect(await service.checkWriteGate({ operation: "x", actorId: actorA })).toEqual({
      allowed: false,
      state: "INVALID",
      reasonCode: "VALIDATION_WINDOW_EXHAUSTED",
    });

    // A successful read ends the streak; the next failure starts a fresh window.
    failing.value = false;
    const recoveredAt = new Date(firstFailureAt.getTime() + UNAVAILABLE_WINDOW_MS + 1000);
    clock.set(recoveredAt);
    expect(await service.checkWriteGate({ operation: "x", actorId: actorA })).toMatchObject({
      allowed: false,
      state: "RESTRICTED_CONTINUITY",
    });
    failing.value = true;
    clock.set(new Date(recoveredAt.getTime() + 1));
    expect(await service.checkWriteGate({ operation: "x", actorId: actorA })).toEqual({
      allowed: false,
      state: "RESTRICTED_CONTINUITY",
      reasonCode: null,
    });
  });

  it("a last-known-good allow decision is also held for 24 hours and then blocked", async () => {
    await activate();
    const failing = { value: false };
    const clock = makeClock(FIXTURE_NOW);
    const service = makeService({ clock, db: failingDb(failing) });

    expect((await service.checkWriteGate({ operation: "x", actorId: actorA })).allowed).toBe(true);
    failing.value = true;
    clock.set(new Date(FIXTURE_NOW.getTime() + 1000));
    expect((await service.checkWriteGate({ operation: "x", actorId: actorA })).allowed).toBe(true);
    clock.set(new Date(FIXTURE_NOW.getTime() + 1000 + UNAVAILABLE_WINDOW_MS));
    expect(await service.checkWriteGate({ operation: "x", actorId: actorA })).toMatchObject({
      allowed: false,
      reasonCode: "VALIDATION_WINDOW_EXHAUSTED",
    });
  });

  it("getRestrictionCutoff fails open on a read failure", async () => {
    await activate();
    const failing = { value: true };
    const service = makeService({ clock: makeClock(FIXTURE_NOW), db: failingDb(failing) });

    expect(await service.getRestrictionCutoff()).toEqual({ restricted: false, restrictedAt: null });
  });
});

describe("a deterministic verification failure blocks at once and no decision is cached (T-14-09-01)", () => {
  function tampered(raw: string): string {
    const parts = raw.split(".");
    const mid = Math.floor(parts[2].length / 2);
    parts[2] = `${parts[2].slice(0, mid)}${parts[2][mid] === "A" ? "B" : "A"}${parts[2].slice(mid + 1)}`;
    return parts.join(".");
  }

  it("blocks with the verification reason code as soon as the stored raw text is edited", async () => {
    const { minted } = await activate();
    const licenceId = (minted.payload as { licenceId: string }).licenceId;
    const service = makeService({ clock: makeClock(FIXTURE_NOW) });
    const other = makeService({ clock: makeClock(FIXTURE_NOW) });

    // The same instance allowed a moment ago: nothing is remembered for the allow path.
    expect((await service.checkWriteGate({ operation: "x", actorId: actorA })).allowed).toBe(true);
    expect((await other.checkWriteGate({ operation: "x", actorId: actorA })).allowed).toBe(true);

    await testDb.prisma.licenceRecord.update({
      where: { licenceId },
      data: { raw: tampered(minted.raw) },
    });

    for (const instance of [service, other]) {
      const decision = await instance.checkWriteGate({ operation: "x", actorId: actorA });
      expect(decision.allowed).toBe(false);
      if (decision.allowed) continue;
      expect(decision.state).toBe("INVALID");
      expect(["BAD_SIGNATURE", "BAD_FORMAT"]).toContain(decision.reasonCode);
    }
    const cutoff = await service.getRestrictionCutoff();
    expect(cutoff.restricted).toBe(true);
    expect(cutoff.restrictedAt).not.toBeNull();

    // Restoring the text re-allows on the very next call.
    await testDb.prisma.licenceRecord.update({ where: { licenceId }, data: { raw: minted.raw } });
    expect((await service.checkWriteGate({ operation: "x", actorId: actorA })).allowed).toBe(true);
  });

  it("a clock moved a day before expiry does not restrict, and 14 days of grace is exact", async () => {
    const { expiresAt, graceEndsAt } = await activate();
    expect(graceEndsAt.getTime() - expiresAt.getTime()).toBe(14 * DAY_MS);
    const service = makeService({ clock: makeClock(new Date(expiresAt.getTime() - DAY_MS)) });

    expect((await service.checkWriteGate({ operation: "x", actorId: actorA })).allowed).toBe(true);
  });
});
