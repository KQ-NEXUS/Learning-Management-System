/**
 * End-to-end helpers for the Phase 14 enforcement, recovery and audit proof
 * (plan 14-21; LIC-05, LIC-06, LIC-08).
 *
 * Everything here is bound to the TEST database client (`testDb.prisma`, a
 * Testcontainers Postgres), never the configured DATABASE_URL singleton. Audit
 * rows go through the real redacting row builder (`buildAuditRow` via
 * `recordAuditInTransaction`) onto that client, because the application's own
 * `recordAudit` is bound to the application's prisma instance.
 *
 * The helpers assemble the real production pieces: `createLicenceActivationService`,
 * `createLicenceService` and `createWithPermission` with the licence guard bound
 * to the database-backed `checkWriteGate`, exactly as `src/server/permissions/index.ts`
 * wires it. Time is an injected clock so the grace boundary is exercised to the
 * millisecond.
 */

import { vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { DAY_MS } from "@/server/licence/constants";
import type { TrustSet } from "@/server/licence/trust-set";
import {
  createWithPermission,
  type AuditEntry,
  type LicenceGuardDep,
  type RawGrant,
} from "@/server/permissions/with-permission";
import { recordAuditInTransaction, type BusinessAuditEvent } from "@/server/services/audit-service";
import {
  createLicenceActivationService,
  type ActivateLicenceResult,
} from "@/server/services/licence-activation-service";
import { createLicenceService } from "@/server/services/licence-service";
import {
  createFixtureKey,
  FIXTURE_DEPLOYMENT_ID,
  FIXTURE_NOW,
  fixtureTrustSet,
  mintLicence,
  type FixtureKey,
  type MintedLicence,
} from "./licence-fixtures";
import { LICENCE_STATE_ID, resetLicenceTables, setDeploymentId } from "./licence-db";
import type { TestDatabase } from "./pg";

/** The signing key and trust set every flow test shares (one throwaway Ed25519 pair per test file). */
export const FLOW_KEY: FixtureKey = createFixtureKey("flow-key");
export const FLOW_TRUST_SET: TrustSet = fixtureTrustSet([FLOW_KEY]);

export type Clock = { now: () => Date; set: (next: Date) => void };

/** A movable clock; `now` always returns a fresh Date at the current instant. */
export function makeClock(initial: Date): Clock {
  let ms = initial.getTime();
  return {
    now: () => new Date(ms),
    set(next: Date) {
      ms = next.getTime();
    },
  };
}

/** The audit sink bound to the test database through the real redacting row builder. */
export function auditSink(testDb: TestDatabase): (event: BusinessAuditEvent) => Promise<void> {
  return (event) => recordAuditInTransaction(testDb.prisma, event);
}

/**
 * Returns the singletons to the freshly migrated UNLICENSED shape, binds the
 * fixture deployment id and puts the high-water mark on the fixture timeline.
 * The migration seeds both singleton rows; the INSERT ... ON CONFLICT guards
 * make the helper safe if a prior test removed one.
 */
export async function resetLicenceFlow(testDb: TestDatabase): Promise<void> {
  const prisma = testDb.prisma;
  await prisma.$executeRaw`INSERT INTO "DeploymentIdentity" ("id") VALUES ('deployment') ON CONFLICT DO NOTHING`;
  await prisma.$executeRaw`INSERT INTO "LicenceState" ("id", "highWaterAt", "updatedAt") VALUES ('current', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING`;
  await resetLicenceTables(prisma);
  await setDeploymentId(prisma, FIXTURE_DEPLOYMENT_ID);
  await prisma.licenceState.update({ where: { id: LICENCE_STATE_ID }, data: { highWaterAt: FIXTURE_NOW } });
}

export type MintAtOptions = {
  /** Instant the licence is issued and valid from (default: one day before `now`). */
  issuedAt?: Date;
  /** Expiry (default: `now` plus 90 days). */
  expiresAt?: Date;
  /** End of grace (default: `expiresAt` plus 14 days of 24 hours). */
  graceEndsAt?: Date;
  /** Extra payload members to override (`undefined` removes a member). */
  payload?: Record<string, unknown>;
  key?: FixtureKey;
};

/**
 * Mints a signed licence whose dates are expressed relative to `now`: issued and
 * valid from a day earlier, expiring in 90 days with 14 days of grace, unless
 * overridden. G (graceEndsAt) equals E (expiresAt) plus 14 days.
 */
export function mintAt(now: Date, options: MintAtOptions = {}): MintedLicence {
  const issuedAt = options.issuedAt ?? new Date(now.getTime() - DAY_MS);
  const expiresAt = options.expiresAt ?? new Date(now.getTime() + 90 * DAY_MS);
  const graceEndsAt = options.graceEndsAt ?? new Date(expiresAt.getTime() + 14 * DAY_MS);
  return mintLicence({
    key: options.key ?? FLOW_KEY,
    payload: {
      issuedAt: issuedAt.toISOString(),
      notBefore: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      graceEndsAt: graceEndsAt.toISOString(),
      ...options.payload,
    },
  });
}

/** A real activation service over the test database with an injected clock and trust set. */
export function activationAt(testDb: TestDatabase, clock: Clock, trustSet: TrustSet = FLOW_TRUST_SET) {
  return createLicenceActivationService({
    db: testDb.prisma,
    trustSet: () => trustSet,
    audit: auditSink(testDb),
    auditInTransaction: (tx, event) => recordAuditInTransaction(tx, event),
    now: clock.now,
  });
}

export type ActivatedLicence = {
  minted: MintedLicence;
  result: ActivateLicenceResult;
  licenceId: string;
  expiresAt: Date;
  graceEndsAt: Date;
};

/**
 * Mints a licence with the fixture key and activates it through the real
 * activation service at `now`. Returns the minted licence, the activation
 * result and the signed dates.
 */
export async function activateAt(
  testDb: TestDatabase,
  options: { now: Date; actorId: string } & MintAtOptions,
): Promise<ActivatedLicence> {
  const { now, actorId, ...mintOptions } = options;
  const minted = mintAt(now, mintOptions);
  const result = await activationAt(testDb, makeClock(now), minted.trustSet).activateLicence({
    actorId,
    raw: minted.raw,
  });
  const payload = minted.payload as { licenceId: string; expiresAt: string; graceEndsAt: string };
  return {
    minted,
    result,
    licenceId: payload.licenceId,
    expiresAt: new Date(payload.expiresAt),
    graceEndsAt: new Date(payload.graceEndsAt),
  };
}

/**
 * A `createLicenceService` bound to the test database, the fixture trust set
 * and the injected clock. The monotonic source is constant so the in-process
 * clock monitor stays silent while the wall clock is moved in large steps.
 */
export function serviceAt(
  testDb: TestDatabase,
  clock: Clock,
  options: { trustSet?: TrustSet; audit?: (event: BusinessAuditEvent) => Promise<void> } = {},
) {
  return createLicenceService({
    db: testDb.prisma,
    trustSet: () => options.trustSet ?? FLOW_TRUST_SET,
    audit: options.audit ?? auditSink(testDb),
    auditInTransaction: (tx, event) => recordAuditInTransaction(tx, event),
    now: clock.now,
    monotonicNow: () => 0,
    log: () => undefined,
  });
}

/**
 * The real choke point: `createWithPermission` whose licence guard calls the
 * database-backed `checkWriteGate` of ONE service instance at the injected
 * clock (a single instance, so the per-actor enforcement coalescing of A14
 * behaves exactly as it does in a running process). `userId: null` models an
 * unauthenticated caller.
 */
export function guardedWithPermission(
  testDb: TestDatabase,
  clock: Clock,
  options: { grants: RawGrant[]; userId: string | null; service?: ReturnType<typeof serviceAt> },
) {
  const service = options.service ?? serviceAt(testDb, clock);
  const licence: LicenceGuardDep = {
    check: ({ permission, actorId }) => service.checkWriteGate({ operation: permission, actorId }),
  };
  const audits: AuditEntry[] = [];
  const withPermission = createWithPermission({
    getActor: async () => (options.userId === null ? null : { userId: options.userId }),
    loadGrants: async () => options.grants,
    audit: async (entry) => {
      audits.push(entry);
    },
    now: clock.now,
    licence,
  });
  return { withPermission, audits, service };
}

/** A spy handler so a test can prove a refused permission never ran its handler. */
export function spyHandler<T>(value: T) {
  return vi.fn(async (): Promise<T> => value);
}

/**
 * Row counts of every public base table, keyed by table name, skipping the
 * Prisma migrations table and the excluded names. Table names come from
 * information_schema (never from input) and are quoted.
 */
export async function snapshotTableCounts(
  prisma: PrismaClient,
  excluded: readonly string[] = [],
): Promise<Record<string, number>> {
  const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name`;
  const skip = new Set(["_prisma_migrations", ...excluded]);
  const counts: Record<string, number> = {};
  for (const { table_name: name } of tables) {
    if (skip.has(name)) continue;
    const rows = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT COUNT(*)::int AS count FROM "${name.replaceAll('"', '""')}"`,
    );
    counts[name] = rows[0]?.count ?? 0;
  }
  return counts;
}
