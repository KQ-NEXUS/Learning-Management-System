/**
 * Real-Postgres proof for the licence guard in the withPermission choke point
 * (Phase 14, plan 14-11; D-09, LIC-05, LIC-06).
 *
 * A real `createWithPermission` is bound to a licence guard whose `check` calls
 * the database-backed `checkWriteGate` of a service built over the TEST database
 * client (never the configured DATABASE_URL singleton). Tracer: a wrapped
 * write is refused exactly at graceEndsAt with one enforcement audit row.
 *
 * PREREQUISITE: Docker must be running (`tests/support/pg.ts` starts the
 * container). If it is not, `beforeAll` fails with a container-start error:
 * every case reports BLOCKED, never a silent pass.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrustSet } from "@/server/licence/trust-set";
import {
  AuthorizationError,
  LicenceRestrictedError,
  createWithPermission,
  type AuditEntry,
  type LicenceGuardDep,
  type RawGrant,
} from "@/server/permissions/with-permission";
import { recordAuditInTransaction } from "@/server/services/audit-service";
import { createLicenceActivationService } from "@/server/services/licence-activation-service";
import { createLicenceService } from "@/server/services/licence-service";
import {
  createFixtureKey,
  FIXTURE_DEPLOYMENT_ID,
  FIXTURE_NOW,
  fixtureTrustSet,
  mintLicence,
} from "./support/licence-fixtures";
import { LICENCE_STATE_ID, resetLicenceTables, setDeploymentId } from "./support/licence-db";
import { grant } from "./support/harness";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";

let testDb: TestDatabase;
let granted: string;
let ungranted: string;
let graceEndsAt: Date;

const key = createFixtureKey("guard-key");
const trustSet: TrustSet = fixtureTrustSet([key]);

beforeAll(async () => {
  testDb = await startTestDatabase();
  const make = async (email: string) =>
    (
      await testDb.prisma.user.create({
        data: { email, name: email, status: "ACTIVE", emailVerified: new Date(), isStaff: true },
      })
    ).id;
  granted = await make("guard-granted@licence-guard.test");
  ungranted = await make("guard-ungranted@licence-guard.test");
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

/** Ids of every audit row this file created, deleted by id after each test. */
const createdAuditIds = new Set<string>();

async function trackAuditRows() {
  const rows = await testDb.prisma.auditEvent.findMany({
    where: { action: { startsWith: "licence." } },
    select: { id: true },
  });
  for (const row of rows) createdAuditIds.add(row.id);
}

beforeEach(async () => {
  await testDb.prisma
    .$executeRaw`INSERT INTO "DeploymentIdentity" ("id") VALUES ('deployment') ON CONFLICT DO NOTHING`;
  await testDb.prisma
    .$executeRaw`INSERT INTO "LicenceState" ("id", "highWaterAt", "updatedAt") VALUES ('current', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING`;
  await resetLicenceTables(testDb.prisma);
  await setDeploymentId(testDb.prisma, FIXTURE_DEPLOYMENT_ID);
  await testDb.prisma.licenceState.update({
    where: { id: LICENCE_STATE_ID },
    data: { highWaterAt: FIXTURE_NOW },
  });

  // Activate the default fixture licence (90 days, 14 days of grace) at FIXTURE_NOW.
  const minted = mintLicence({ key });
  const activation = createLicenceActivationService({
    db: testDb.prisma,
    trustSet: () => trustSet,
    audit: (event) => recordAuditInTransaction(testDb.prisma, event),
    auditInTransaction: (tx, event) => recordAuditInTransaction(tx, event),
    now: () => FIXTURE_NOW,
  });
  const result = await activation.activateLicence({ actorId: granted, raw: minted.raw });
  expect(result.ok).toBe(true);
  graceEndsAt = new Date((minted.payload as { graceEndsAt: string }).graceEndsAt);
  await trackAuditRows();
});

afterEach(async () => {
  await trackAuditRows();
  await testDb.prisma.auditEvent.deleteMany({ where: { id: { in: [...createdAuditIds] } } });
  createdAuditIds.clear();
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

/** A real choke point whose guard calls the database-backed gate at the injected clock. */
function buildChokePoint(clock: ReturnType<typeof makeClock>, grants: RawGrant[], actorId: string) {
  const service = createLicenceService({
    db: testDb.prisma,
    trustSet: () => trustSet,
    audit: (event) => recordAuditInTransaction(testDb.prisma, event),
    now: clock.now,
    monotonicNow: () => 0,
    log: () => undefined,
  });
  const licence: LicenceGuardDep = {
    check: async ({ permission, actorId: id }) =>
      service.checkWriteGate({ operation: permission, actorId: id }),
  };
  const audits: AuditEntry[] = [];
  const withPermission = createWithPermission({
    getActor: async () => ({ userId: actorId }),
    loadGrants: async () => grants,
    audit: async (entry) => {
      audits.push(entry);
    },
    now: clock.now,
    licence,
  });
  return { withPermission, audits };
}

async function enforcementRows() {
  return testDb.prisma.auditEvent.findMany({
    where: { action: "licence.restriction_enforced" },
    orderBy: { createdAt: "asc" },
  });
}

describe("tracer: restricted write refused through the real database path", () => {
  it("runs a wrapped courses.publish handler before graceEndsAt, refuses it at graceEndsAt with one audit row", async () => {
    const clock = makeClock(new Date(graceEndsAt.getTime() - 1));
    const { withPermission } = buildChokePoint(clock, [grant("courses.publish")], granted);
    const handler = vi.fn(async () => "published");
    const action = withPermission("courses.publish", () => ({ courseIds: ["c1"] }))(handler);

    await expect(action({})).resolves.toBe("published");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(await enforcementRows()).toHaveLength(0);

    clock.set(graceEndsAt);
    const error = await action({}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LicenceRestrictedError);
    expect(handler).toHaveBeenCalledTimes(1);

    const rows = await enforcementRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].actorId).toBe(granted);
    const after = rows[0].after as { operation?: string; state?: string } | null;
    expect(after?.operation).toBe("courses.publish");
    expect(after?.state).toBeTruthy();
  });
});

describe("parity: an unauthorized actor learns nothing about the licence state", () => {
  it("gets an AuthorizationError with identical name and message in ACTIVE and RESTRICTED states and no enforcement row", async () => {
    const clock = makeClock(new Date(graceEndsAt.getTime() - 1));
    const { withPermission, audits } = buildChokePoint(clock, [], ungranted);
    const handler = vi.fn(async () => "published");
    const action = withPermission("courses.publish", () => ({ courseIds: ["c1"] }))(handler);

    const activeError = (await action({}).catch((e: unknown) => e)) as Error;
    clock.set(graceEndsAt);
    const restrictedError = (await action({}).catch((e: unknown) => e)) as Error;

    for (const error of [activeError, restrictedError]) {
      expect(error).toBeInstanceOf(AuthorizationError);
      expect(error).not.toBeInstanceOf(LicenceRestrictedError);
    }
    expect(restrictedError.name).toBe(activeError.name);
    expect(restrictedError.message).toBe(activeError.message);
    expect(handler).not.toHaveBeenCalled();
    expect(audits.filter((entry) => entry.action === "authorization.denied")).toHaveLength(2);

    const rows = await enforcementRows();
    expect(rows.filter((row) => row.actorId === ungranted)).toHaveLength(0);
    expect(rows).toHaveLength(0);
  });
});

describe("allowlist: continuity and read permissions keep running while restricted", () => {
  it("runs grades.manage, certificates.issue, refunds.manage, licence.activate and courses.view", async () => {
    const clock = makeClock(graceEndsAt);
    const permissions = [
      "grades.manage",
      "certificates.issue",
      "refunds.manage",
      "licence.activate",
      "courses.view",
    ] as const;
    const { withPermission } = buildChokePoint(clock, permissions.map((p) => grant(p)), granted);

    // Sanity: the same state really does refuse a write-effect permission.
    const blockedGrants = [grant("courses.edit")];
    const writeCheck = buildChokePoint(clock, blockedGrants, granted);
    await expect(
      writeCheck.withPermission("courses.edit", () => ({}))(vi.fn(async () => "x"))({}),
    ).rejects.toBeInstanceOf(LicenceRestrictedError);
    const before = (await enforcementRows()).length;

    for (const permission of permissions) {
      const handler = vi.fn(async () => permission);
      await expect(withPermission(permission, () => ({}))(handler)({})).resolves.toBe(permission);
      expect(handler).toHaveBeenCalledTimes(1);
    }

    // None of the allowlisted calls reached the guard, so none wrote an enforcement row.
    expect((await enforcementRows()).length).toBe(before);
  });
});
