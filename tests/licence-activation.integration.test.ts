/**
 * Real-Postgres proof for licence activation (Phase 14, plan 14-07; LIC-01,
 * LIC-03, LIC-05, LIC-06, D-13): the locked, version-guarded activation
 * transaction, every closed rejection code at the service level, replay and
 * client pinning, parallel activation, tamper detection on read and singleton
 * self-heal.
 *
 * Audit rows are written through the real redacting sink bound to the TEST
 * database client (never the configured DATABASE_URL singleton).
 *
 * PREREQUISITE: Docker must be running (`tests/support/pg.ts` starts the
 * container). If it is not, `beforeAll` fails with a container-start error:
 * every case reports BLOCKED, never a silent pass.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DAY_MS, SKEW_TOLERANCE_MS } from "@/server/licence/constants";
import type { TrustSet } from "@/server/licence/trust-set";
import { recordAuditInTransaction } from "@/server/services/audit-service";
import {
  createLicenceActivationService,
  type ActivateLicenceResult,
} from "@/server/services/licence-activation-service";
import {
  createLicenceService,
  type LicenceDbClient,
} from "@/server/services/licence-service";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import {
  createFixtureKey,
  FIXTURE_CLIENT,
  FIXTURE_DEPLOYMENT_ID,
  FIXTURE_NOW,
  fixtureTrustSet,
  mintLicence,
  type MintedLicence,
} from "./support/licence-fixtures";
import { LICENCE_STATE_ID, resetLicenceTables, setDeploymentId } from "./support/licence-db";

let testDb: TestDatabase;
let actorId: string;

const key = createFixtureKey("integration-key");
const trustSet: TrustSet = fixtureTrustSet([key]);

beforeAll(async () => {
  testDb = await startTestDatabase();
  const actor = await testDb.prisma.user.create({
    data: {
      email: "licence-activator@licence-activation.test",
      name: "Licence Activator",
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

/** The singletons are never deleted by the reset helpers; make sure they exist first (a test may have deleted them). */
async function ensureSingletons(): Promise<void> {
  await testDb.prisma
    .$executeRaw`INSERT INTO "DeploymentIdentity" ("id") VALUES ('deployment') ON CONFLICT DO NOTHING`;
  await testDb.prisma
    .$executeRaw`INSERT INTO "LicenceState" ("id", "highWaterAt", "updatedAt") VALUES ('current', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING`;
}

beforeEach(async () => {
  await ensureSingletons();
  await resetLicenceTables(testDb.prisma);
  await setDeploymentId(testDb.prisma, FIXTURE_DEPLOYMENT_ID);
  await testDb.prisma.auditEvent.deleteMany({ where: { action: { startsWith: "licence." } } });
});

type Clock = () => Date;
const fixedClock: Clock = () => FIXTURE_NOW;

function makeServices(options: { now?: Clock; trust?: TrustSet; db?: LicenceDbClient } = {}) {
  const db = options.db ?? testDb.prisma;
  const trust = options.trust ?? trustSet;
  const now = options.now ?? fixedClock;
  const audit = (event: Parameters<typeof recordAuditInTransaction>[1]) =>
    recordAuditInTransaction(testDb.prisma, event);
  return {
    licence: createLicenceService({ db, trustSet: () => trust, audit, now }),
    activation: createLicenceActivationService({
      db,
      trustSet: () => trust,
      audit,
      auditInTransaction: (tx, event) => recordAuditInTransaction(tx, event),
      now,
    }),
  };
}

function iso(offsetDays: number): string {
  return new Date(FIXTURE_NOW.getTime() + offsetDays * DAY_MS).toISOString();
}

/** A licence signed by the integration key; defaults come from the fixture (issued a day ago, 90 days of term). */
function mint(payload: Record<string, unknown> = {}, extra: { key?: typeof key } = {}): MintedLicence {
  return mintLicence({ key: extra.key ?? key, payload });
}

function payloadOf(minted: MintedLicence) {
  return minted.payload as {
    licenceId: string;
    issuedAt: string;
    expiresAt: string;
    graceEndsAt: string;
  };
}

async function auditRows(action: string) {
  return testDb.prisma.auditEvent.findMany({ where: { action }, orderBy: { createdAt: "asc" } });
}

async function counts() {
  return {
    records: await testDb.prisma.licenceRecord.count(),
    activated: await testDb.prisma.auditEvent.count({ where: { action: "licence.activated" } }),
    rejected: await testDb.prisma.auditEvent.count({
      where: { action: "licence.activation_rejected" },
    }),
    audit: await testDb.prisma.auditEvent.count(),
  };
}

async function stateRow() {
  return testDb.prisma.licenceState.findUniqueOrThrow({ where: { id: LICENCE_STATE_ID } });
}

function collectKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, into);
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      into.add(k);
      collectKeys(v, into);
    }
  }
  return into;
}

describe("tracer: activate one valid licence", () => {
  it("activates through one locked transaction and writes one licence.activated audit row", async () => {
    const { activation } = makeServices();
    const minted = mint();
    const licenceId = payloadOf(minted).licenceId;

    const result = await activation.activateLicence({
      actorId,
      raw: minted.raw,
      correlationId: "corr-activate-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(["ACTIVE", "EXPIRING_SOON"]).toContain(result.snapshot.state);
    expect(result.snapshot.licenceId).toBe(licenceId);

    expect(await testDb.prisma.licenceRecord.count()).toBe(1);
    const record = await testDb.prisma.licenceRecord.findUniqueOrThrow({ where: { licenceId } });
    expect(record.activatedById).toBe(actorId);
    expect(record.activatedAt).toEqual(FIXTURE_NOW);

    const state = await stateRow();
    expect(state.everActivated).toBe(true);
    expect(state.registeredClientId).toBe(FIXTURE_CLIENT.id);
    expect(state.activeRecordId).toBe(record.id);
    expect(state.version).toBe(1);
    expect(state.lastVerifiedAt).toEqual(FIXTURE_NOW);
    expect(state.lastVerificationOutcome).toBe("OK");

    const audit = await auditRows("licence.activated");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId,
      targetType: "LICENCE",
      targetId: licenceId,
      outcome: "SUCCESS",
      scopeType: "GLOBAL",
      correlationId: "corr-activate-1",
    });
    const keys = collectKeys([audit[0].before, audit[0].after]);
    for (const forbidden of ["raw", "signature", "header"]) expect(keys.has(forbidden)).toBe(false);
    expect(JSON.stringify([audit[0].before, audit[0].after])).not.toContain(minted.raw);
    expect(audit[0].after).toMatchObject({ licenceId, keyId: key.kid });
  });

  it("reports UNLICENSED before activation and an ACTIVE raw-free snapshot after it", async () => {
    const { activation, licence } = makeServices();

    const before = await licence.getStatusSnapshot();
    expect(before.state).toBe("UNLICENSED");
    expect(before.isRestricted).toBe(false);
    expect(before.everActivated).toBe(false);
    expect(before.licenceId).toBeNull();
    expect(before.deploymentId).toBe(FIXTURE_DEPLOYMENT_ID);

    const minted = mint();
    const result = await activation.activateLicence({ actorId, raw: minted.raw });
    expect(result.ok).toBe(true);

    const after = await licence.getStatusSnapshot();
    expect(after.state).toBe("ACTIVE");
    expect(after.licenceId).toBe(payloadOf(minted).licenceId);
    expect("raw" in after).toBe(false);
    expect(JSON.stringify(after)).not.toContain(minted.raw);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
  });
});

describe("every rejection rule leaves nothing behind", () => {
  function altered(raw: string): string {
    const parts = raw.split(".");
    // Flip one character in the middle of the payload part; the signature no longer matches.
    const payload = parts[2];
    const mid = Math.floor(payload.length / 2);
    parts[2] = `${payload.slice(0, mid)}${payload[mid] === "A" ? "B" : "A"}${payload.slice(mid + 1)}`;
    return parts.join(".");
  }

  const unlisted = createFixtureKey("unlisted-key");
  const revokedKey = createFixtureKey("revoked-key");

  const cases: Array<{
    code: string;
    build: () => { raw: string; trust?: TrustSet };
  }> = [
    { code: "BAD_FORMAT", build: () => ({ raw: "this is not a licence" }) },
    { code: "BAD_SIGNATURE", build: () => ({ raw: altered(mint().raw) }) },
    { code: "UNKNOWN_KEY", build: () => ({ raw: mint({}, { key: unlisted }).raw }) },
    {
      code: "KEY_REVOKED",
      build: () => ({
        raw: mint({}, { key: revokedKey }).raw,
        trust: fixtureTrustSet([{ kid: revokedKey.kid, x: revokedKey.x, status: "revoked" }]),
      }),
    },
    {
      code: "UNSUPPORTED_SCHEMA",
      build: () => ({ raw: mint().raw.replace(/^LMS-LIC1/, "LMS-LIC2") }),
    },
    { code: "WRONG_DEPLOYMENT", build: () => ({ raw: mint({ deploymentId: "another-deployment" }).raw }) },
    {
      code: "NOT_YET_VALID",
      build: () => ({
        raw: mint({
          notBefore: new Date(FIXTURE_NOW.getTime() + SKEW_TOLERANCE_MS + 60_000).toISOString(),
        }).raw,
      }),
    },
    {
      code: "EXPIRED",
      build: () => ({
        raw: mint({ expiresAt: FIXTURE_NOW.toISOString(), graceEndsAt: iso(14) }).raw,
      }),
    },
  ];

  it.each(cases)("$code is returned with no record, state or activated-audit change", async ({ code, build }) => {
    const { raw, trust } = build();
    const { activation } = makeServices({ trust });
    const stateBefore = await stateRow();
    const before = await counts();

    const result = await activation.activateLicence({ actorId, raw, correlationId: "corr-reject" });

    expect(result).toEqual({ ok: false, code });
    const after = await counts();
    expect(after.records).toBe(before.records);
    expect(after.activated).toBe(before.activated);
    // Closed-code rejection audit row only.
    expect(after.rejected).toBe(before.rejected + 1);
    expect(after.audit).toBe(before.audit + 1);
    const stateAfter = await stateRow();
    expect(stateAfter.version).toBe(stateBefore.version);
    expect(stateAfter).toEqual(stateBefore);

    const rows = await auditRows("licence.activation_rejected");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId,
      targetType: "LICENCE",
      targetId: null,
      outcome: "REJECTED",
      correlationId: "corr-reject",
    });
    // Only the closed code: no raw text, signature or key material.
    expect(rows[0].after).toEqual({ code });
    expect(JSON.stringify(rows[0])).not.toContain(raw.slice(0, 40));
  });

  it("WRONG_CLIENT: the first activation pins client.id and a later different client is refused", async () => {
    const { activation } = makeServices();
    const first = mint();
    expect((await activation.activateLicence({ actorId, raw: first.raw })).ok).toBe(true);
    const pinned = await stateRow();
    expect(pinned.registeredClientId).toBe(FIXTURE_CLIENT.id);

    const other = mint({
      issuedAt: iso(0),
      client: { id: "some-other-client", name: "Other Academy" },
    });
    const before = await counts();
    const result = await activation.activateLicence({ actorId, raw: other.raw });

    expect(result).toEqual({ ok: false, code: "WRONG_CLIENT" });
    expect((await counts()).records).toBe(before.records);
    const after = await stateRow();
    expect(after.version).toBe(pinned.version);
    expect(after.registeredClientId).toBe(FIXTURE_CLIENT.id);
    expect(after.activeRecordId).toBe(pinned.activeRecordId);
  });

  it("replay: older, same-file, equal-issuedAt and newer licences behave as specified", async () => {
    const { activation, licence } = makeServices();
    const a = mint({ issuedAt: iso(-3) });
    const b = mint({ issuedAt: iso(-2) });
    const c = mint({ issuedAt: iso(-1) });
    const equalToB = mint({ issuedAt: iso(-2) });

    expect((await activation.activateLicence({ actorId, raw: b.raw })).ok).toBe(true);
    const afterB = await stateRow();
    expect(afterB.version).toBe(1);

    expect(await activation.activateLicence({ actorId, raw: a.raw })).toEqual({
      ok: false,
      code: "OLDER_THAN_ACTIVE",
    });

    const beforeReplay = await counts();
    expect(await activation.activateLicence({ actorId, raw: b.raw })).toEqual({
      ok: false,
      code: "ALREADY_ACTIVE",
    });
    const afterReplay = await counts();
    expect(afterReplay.records).toBe(beforeReplay.records);
    expect(afterReplay.activated).toBe(beforeReplay.activated);
    expect((await stateRow()).version).toBe(afterB.version);

    expect(await activation.activateLicence({ actorId, raw: equalToB.raw })).toEqual({
      ok: false,
      code: "OLDER_THAN_ACTIVE",
    });
    expect((await stateRow()).version).toBe(afterB.version);

    // The preview of a newer licence shows what it replaces.
    const preview = await licence.inspect(c.raw);
    expect(preview.ok).toBe(true);
    if (preview.ok) {
      expect(preview.preview.replaces).toEqual({
        licenceId: payloadOf(b).licenceId,
        expiresAt: new Date(payloadOf(b).expiresAt),
      });
    }

    const result = await activation.activateLicence({ actorId, raw: c.raw });
    expect(result.ok).toBe(true);
    expect(await testDb.prisma.licenceRecord.count()).toBe(2);
    const record = await testDb.prisma.licenceRecord.findUniqueOrThrow({
      where: { licenceId: payloadOf(c).licenceId },
    });
    const finalState = await stateRow();
    expect(finalState.activeRecordId).toBe(record.id);
    expect(finalState.version).toBe(2);
  });

  it("inspect never writes, for valid and invalid files", async () => {
    const { licence } = makeServices();
    const stateBefore = await stateRow();
    const before = await counts();
    const valid = mint();

    expect((await licence.inspect(valid.raw)).ok).toBe(true);
    expect(await licence.inspect("garbage")).toEqual({ ok: false, code: "BAD_FORMAT" });
    expect(await licence.inspect(mint({ deploymentId: "elsewhere" }).raw)).toEqual({
      ok: false,
      code: "WRONG_DEPLOYMENT",
    });

    expect(await counts()).toEqual(before);
    expect(await stateRow()).toEqual(stateBefore);
    expect(await testDb.prisma.auditEvent.count()).toBe(before.audit);
  });

  it("a stale write returns CONCURRENT_CHANGE and rolls the whole transaction back (real database)", async () => {
    // Force the version-guarded update to lose: the record insert has already
    // happened inside the transaction and must be rolled back with it.
    const racingDb = {
      licenceState: testDb.prisma.licenceState,
      licenceRecord: testDb.prisma.licenceRecord,
      deploymentIdentity: testDb.prisma.deploymentIdentity,
      $queryRaw: testDb.prisma.$queryRaw.bind(testDb.prisma),
      $executeRaw: testDb.prisma.$executeRaw.bind(testDb.prisma),
      $transaction: (
        fn: (tx: unknown) => Promise<unknown>,
        options?: { timeout?: number },
      ) =>
        testDb.prisma.$transaction(async (tx) => {
          const lossyState = new Proxy(tx.licenceState, {
            get(target, prop, receiver) {
              if (prop === "updateMany") return async () => ({ count: 0 });
              return Reflect.get(target, prop, receiver);
            },
          });
          const lossyTx = new Proxy(tx, {
            get(target, prop, receiver) {
              if (prop === "licenceState") return lossyState;
              return Reflect.get(target, prop, receiver);
            },
          });
          return fn(lossyTx);
        }, options),
    } as unknown as LicenceDbClient;

    const { activation } = makeServices({ db: racingDb });
    const stateBefore = await stateRow();
    const result = await activation.activateLicence({ actorId, raw: mint().raw });

    expect(result).toEqual({ ok: false, code: "CONCURRENT_CHANGE" });
    expect(await testDb.prisma.licenceRecord.count()).toBe(0);
    expect(await stateRow()).toEqual(stateBefore);
    expect(await auditRows("licence.activated")).toHaveLength(0);
    const rejected = await auditRows("licence.activation_rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0].after).toEqual({ code: "CONCURRENT_CHANGE" });
  });
});

describe("CONCURRENT_CHANGE with a fake database", () => {
  it("returns CONCURRENT_CHANGE, writes no licence.activated row and one rejection row when updateMany reports a count of 0", async () => {
    const emptyState = {
      id: "current",
      activeRecordId: null,
      registeredClientId: null,
      everActivated: false,
      state: "UNLICENSED",
      restrictedAt: null,
      reasonCode: null,
      lastVerifiedAt: null,
      lastVerificationOutcome: null,
      lastGoodAt: null,
      attentionSince: null,
      highWaterAt: FIXTURE_NOW,
      clockAlertAt: null,
      version: 0,
      updatedAt: FIXTURE_NOW,
      activeRecord: null,
    };
    const tx = {
      $queryRaw: async () => [{ id: "current" }],
      $executeRaw: async () => 0,
      deploymentIdentity: {
        findUnique: async () => ({
          id: "deployment",
          deploymentId: FIXTURE_DEPLOYMENT_ID,
          createdAt: FIXTURE_NOW,
        }),
      },
      licenceState: {
        findUnique: async () => emptyState,
        updateMany: async () => ({ count: 0 }),
      },
      licenceRecord: {
        findMany: async () => [],
        create: async () => ({ id: "record-1" }),
      },
      auditEvent: { create: vi.fn() },
    };
    const db = {
      $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    } as unknown as LicenceDbClient;
    const audit = vi.fn(async () => undefined);
    const auditInTransaction = vi.fn(async () => undefined);
    const service = createLicenceActivationService({
      db,
      trustSet: () => trustSet,
      audit,
      auditInTransaction,
      now: fixedClock,
    });

    const result = await service.activateLicence({ actorId: "actor-1", raw: mint().raw });

    expect(result).toEqual({ ok: false, code: "CONCURRENT_CHANGE" });
    expect(auditInTransaction).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "licence.activation_rejected",
        after: { code: "CONCURRENT_CHANGE" },
        outcome: "REJECTED",
        targetId: null,
      }),
    );
  });
});

describe("concurrency, tamper detection and self-heal", () => {
  it("two simultaneous activations of the same licence: one ok, one ALREADY_ACTIVE", async () => {
    const minted = mint();
    const first = makeServices().activation;
    const second = makeServices().activation;

    const results = await Promise.all([
      first.activateLicence({ actorId, raw: minted.raw }),
      second.activateLicence({ actorId, raw: minted.raw }),
    ]);

    const ok = results.filter((r) => r.ok);
    const rejected = results.filter((r): r is Extract<ActivateLicenceResult, { ok: false }> => !r.ok);
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].code).toBe("ALREADY_ACTIVE");
    expect(await testDb.prisma.licenceRecord.count()).toBe(1);
    expect(await auditRows("licence.activated")).toHaveLength(1);
    expect((await stateRow()).version).toBe(1);
  });

  it("two simultaneous activations of different licences end on the newer one with no lost update", async () => {
    const a = mint({ issuedAt: iso(-3) });
    const b = mint({ issuedAt: iso(-2) });

    const results = await Promise.all([
      makeServices().activation.activateLicence({ actorId, raw: a.raw }),
      makeServices().activation.activateLicence({ actorId, raw: b.raw }),
    ]);

    const okCount = results.filter((r) => r.ok).length;
    const state = await stateRow();
    const active = await testDb.prisma.licenceRecord.findUniqueOrThrow({
      where: { id: state.activeRecordId ?? "" },
    });
    expect(active.licenceId).toBe(payloadOf(b).licenceId);
    expect(state.version).toBe(okCount);
    for (const r of results) {
      if (!r.ok) {
        expect(r.code).not.toBe("CONCURRENT_CHANGE");
        expect(r.code).toBe("OLDER_THAN_ACTIVE");
      }
    }
    expect(await testDb.prisma.licenceRecord.count()).toBe(okCount);
    expect(await auditRows("licence.activated")).toHaveLength(okCount);
  });

  it("detects an edited raw text on every read, while a date-only edit changes nothing", async () => {
    const { activation, licence } = makeServices();
    const minted = mint();
    const p = payloadOf(minted);
    expect((await activation.activateLicence({ actorId, raw: minted.raw })).ok).toBe(true);

    // Date-only edit: the signed dates win.
    await testDb.prisma.licenceRecord.update({
      where: { licenceId: p.licenceId },
      data: { expiresAt: new Date(FIXTURE_NOW.getTime() + 400 * DAY_MS), graceEndsAt: new Date(FIXTURE_NOW.getTime() + 500 * DAY_MS) },
    });
    const dateEdited = await licence.getStatusSnapshot();
    expect(dateEdited.state).toBe("ACTIVE");
    expect(dateEdited.isRestricted).toBe(false);
    expect(dateEdited.expiresAt).toEqual(new Date(p.expiresAt));
    expect(dateEdited.daysRemaining).toBe(90);

    // Raw-text edit: valid-looking text whose signature no longer matches.
    const parts = minted.raw.split(".");
    const mid = Math.floor(parts[2].length / 2);
    parts[2] = `${parts[2].slice(0, mid)}${parts[2][mid] === "A" ? "B" : "A"}${parts[2].slice(mid + 1)}`;
    await testDb.prisma.licenceRecord.update({
      where: { licenceId: p.licenceId },
      data: { raw: parts.join(".") },
    });
    const rawEdited = await licence.getStatusSnapshot();
    expect(rawEdited.state).toBe("INVALID");
    expect(["BAD_SIGNATURE", "BAD_FORMAT"]).toContain(rawEdited.reasonCode);
    expect(rawEdited.isRestricted).toBe(true);
    expect("raw" in rawEdited).toBe(false);
  });

  it("recreates a missing DeploymentIdentity and LicenceState from a status read", async () => {
    const { licence } = makeServices();
    await testDb.prisma.licenceState.delete({ where: { id: LICENCE_STATE_ID } });
    await testDb.prisma.deploymentIdentity.delete({ where: { id: "deployment" } });

    const snapshot = await licence.getStatusSnapshot();

    expect(snapshot.state).toBe("UNLICENSED");
    expect(snapshot.everActivated).toBe(false);
    expect(snapshot.deploymentId).not.toBeNull();
    expect(snapshot.deploymentId).not.toBe(FIXTURE_DEPLOYMENT_ID);
    expect(await testDb.prisma.deploymentIdentity.count()).toBe(1);
    expect(await testDb.prisma.licenceState.count()).toBe(1);
    const identity = await testDb.prisma.deploymentIdentity.findUniqueOrThrow({
      where: { id: "deployment" },
    });
    expect(identity.deploymentId).toBe(snapshot.deploymentId);
  });

  it("ensureDeploymentIdentity recreates a missing identity row and is idempotent", async () => {
    const { licence } = makeServices();
    await testDb.prisma.deploymentIdentity.delete({ where: { id: "deployment" } });

    const created = await licence.ensureDeploymentIdentity();
    const again = await licence.ensureDeploymentIdentity();

    expect(created).toBe(again);
    expect(await testDb.prisma.deploymentIdentity.count()).toBe(1);
  });

  it("uses the injected clock: activated at a fixed instant, restricted once read past graceEndsAt", async () => {
    const minted = mint();
    const p = payloadOf(minted);
    const { activation } = makeServices({ now: fixedClock });
    const result = await activation.activateLicence({ actorId, raw: minted.raw });
    expect(result.ok).toBe(true);
    const record = await testDb.prisma.licenceRecord.findUniqueOrThrow({
      where: { licenceId: p.licenceId },
    });
    expect(record.activatedAt).toEqual(FIXTURE_NOW);

    const graceEndsAt = new Date(p.graceEndsAt);
    const later = makeServices({ now: () => new Date(graceEndsAt.getTime() + 1) });
    const snapshot = await later.licence.getStatusSnapshot();
    expect(snapshot.state).toBe("RESTRICTED_CONTINUITY");
    expect(snapshot.isRestricted).toBe(true);
    expect(snapshot.restrictedAt).toEqual(graceEndsAt);
  });
});
