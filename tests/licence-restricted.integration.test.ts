/**
 * Real-Postgres end-to-end proof of restricted continuity mode (Phase 14, plan
 * 14-21; LIC-05, LIC-08, D-05, D-07, D-09, OQ1, OQ3).
 *
 * The assembled system is exercised, not its parts: a licence is activated
 * through the real activation service, then the licence clock is moved across
 * graceEndsAt and EVERY permission in the closed catalogue is called through the
 * real `createWithPermission` with the real database-backed guard, calling the
 * wrapped handler directly (the same entry every server action uses, no UI).
 * Everything is bound to the Testcontainers client (never the configured
 * DATABASE_URL) and time is an injected clock.
 *
 * PREREQUISITE: Docker must be running (`tests/support/pg.ts` starts the
 * container). If it is not, `beforeAll` fails with a container-start error:
 * every case reports BLOCKED, never a silent pass.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LicenceWriteBlockedError } from "@/server/licence/errors";
import { LICENCE_PERMISSION_EFFECT, effectForPermission } from "@/server/licence/effects";
import { PERMISSIONS, type Permission } from "@/server/permissions/catalogue";
import {
  AuthenticationError,
  AuthorizationError,
  LicenceRestrictedError,
} from "@/server/permissions/with-permission";
import { recordAuditInTransaction } from "@/server/services/audit-service";
import { createLicenceStaffService } from "@/server/services/licence-staff-service";
import {
  seedAttendanceFixture,
  seedEnrolmentFixture,
  seedLearnerFixture,
  seedPublishedCohortFixture,
  seedSessionFixture,
} from "./support/cohort-fixtures";
import { seedStaffUser } from "./support/drain-harness";
import { grant } from "./support/harness";
import {
  activateAt,
  activationAt,
  auditSink,
  guardedWithPermission,
  makeClock,
  mintAt,
  resetLicenceFlow,
  serviceAt,
  snapshotTableCounts,
  spyHandler,
} from "./support/licence-flow";
import { FIXTURE_NOW } from "./support/licence-fixtures";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";

let testDb: TestDatabase;
let actorId: string;
let ungrantedId: string;

const WRITE_PERMISSIONS = PERMISSIONS.filter((p) => LICENCE_PERMISSION_EFFECT[p] === "write");
const EXPECTED_WRITE = 13;
const EXPECTED_ALLOWED = 24; // 14 read + 10 continuity

beforeAll(async () => {
  testDb = await startTestDatabase();
  const make = async (email: string) =>
    (
      await testDb.prisma.user.create({
        data: { email, name: email, status: "ACTIVE", emailVerified: new Date(), isStaff: true },
      })
    ).id;
  actorId = await make("restricted-actor@licence-restricted.test");
  ungrantedId = await make("restricted-ungranted@licence-restricted.test");
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

beforeEach(async () => {
  await resetLicenceFlow(testDb);
  await testDb.prisma.auditEvent.deleteMany({ where: { action: { startsWith: "licence." } } });
});

/** Activates the default fixture licence (E = now + 90d, G = E + 14d) at FIXTURE_NOW. */
async function activateDefault() {
  const activated = await activateAt(testDb, { now: FIXTURE_NOW, actorId });
  expect(activated.result.ok).toBe(true);
  expect(activated.graceEndsAt.getTime() - activated.expiresAt.getTime()).toBe(14 * 86_400_000);
  return activated;
}

const justBefore = (g: Date) => new Date(g.getTime() - 1);

/** Calls the wrapped handler of one permission as the actor holding exactly that grant. */
async function callAs(
  permission: Permission,
  clock: ReturnType<typeof makeClock>,
  options: { userId: string | null; granted: boolean },
) {
  const { withPermission } = guardedWithPermission(testDb, clock, {
    grants: options.granted ? [grant(permission)] : [],
    userId: options.userId,
  });
  const handler = spyHandler(permission);
  const outcome = await withPermission(permission, () => ({}))(handler)({}).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  return { outcome, handler };
}

describe("tracer: the permission matrix across the grace boundary (LIC-05, T-14-21-01)", () => {
  it("the catalogue holds 37 permissions: 13 write, 14 read, 10 continuity", () => {
    expect(PERMISSIONS).toHaveLength(37);
    expect(WRITE_PERMISSIONS).toHaveLength(EXPECTED_WRITE);
    expect(PERMISSIONS.filter((p) => LICENCE_PERMISSION_EFFECT[p] === "read")).toHaveLength(14);
    expect(PERMISSIONS.filter((p) => LICENCE_PERMISSION_EFFECT[p] === "continuity")).toHaveLength(10);
  });

  describe("ACTIVE (clock at graceEndsAt minus 1 ms): every permission runs", () => {
    it.each([...PERMISSIONS])("%s runs its handler and returns its value", async (permission) => {
      // A permission without a classification would silently default to write; fail loudly instead.
      expect(Object.hasOwn(LICENCE_PERMISSION_EFFECT, permission)).toBe(true);
      const { graceEndsAt } = await activateDefault();
      const clock = makeClock(justBefore(graceEndsAt));

      const { outcome, handler } = await callAs(permission, clock, { userId: actorId, granted: true });

      expect(outcome).toEqual({ ok: true, value: permission });
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe("restricted (clock exactly at graceEndsAt): exactly the write-class permissions are refused", () => {
    it.each([...PERMISSIONS])("%s is refused or allowed according to its effect", async (permission) => {
      expect(Object.hasOwn(LICENCE_PERMISSION_EFFECT, permission)).toBe(true);
      const { graceEndsAt } = await activateDefault();
      const clock = makeClock(graceEndsAt);

      const { outcome, handler } = await callAs(permission, clock, { userId: actorId, granted: true });

      if (LICENCE_PERMISSION_EFFECT[permission] === "write") {
        expect(outcome.ok).toBe(false);
        if (outcome.ok) return;
        expect(outcome.error).toBeInstanceOf(LicenceRestrictedError);
        expect(outcome.error).toBeInstanceOf(AuthorizationError);
        expect(handler).not.toHaveBeenCalled();
      } else {
        expect(outcome).toEqual({ ok: true, value: permission });
        expect(handler).toHaveBeenCalledTimes(1);
      }
    });
  });

  it("on the same stored licence: G minus 1 ms allows all 37, G refuses exactly the 13 write-class permissions", async () => {
    const { graceEndsAt } = await activateDefault();
    const clock = makeClock(justBefore(graceEndsAt));
    const { withPermission } = guardedWithPermission(testDb, clock, {
      grants: PERMISSIONS.map((p) => grant(p)),
      userId: actorId,
    });
    const handlers = new Map(PERMISSIONS.map((p) => [p, spyHandler(p)] as const));
    const run = async () => {
      const refused: Permission[] = [];
      const allowed: Permission[] = [];
      for (const permission of PERMISSIONS) {
        try {
          await withPermission(permission, () => ({}))(handlers.get(permission)!)({});
          allowed.push(permission);
        } catch (error) {
          expect(error).toBeInstanceOf(LicenceRestrictedError);
          refused.push(permission);
        }
      }
      return { refused, allowed };
    };

    const before = await run();
    expect(before.refused).toHaveLength(0);
    expect(before.allowed).toHaveLength(37);

    clock.set(graceEndsAt);
    const at = await run();
    expect(at.refused).toHaveLength(EXPECTED_WRITE);
    expect(at.allowed).toHaveLength(EXPECTED_ALLOWED);
    expect([...at.refused].sort()).toEqual([...WRITE_PERMISSIONS].sort());

    // A refused write never reached its handler in the restricted pass; an allowed one ran in both.
    for (const permission of PERMISSIONS) {
      const expectedCalls = LICENCE_PERMISSION_EFFECT[permission] === "write" ? 1 : 2;
      expect(handlers.get(permission)).toHaveBeenCalledTimes(expectedCalls);
    }
  });

  describe("parity: an unauthorized caller learns nothing about the licence state", () => {
    it("an actor with no grant gets the identical AuthorizationError at G minus 1 ms and at G for every permission", async () => {
      const { graceEndsAt } = await activateDefault();
      const clock = makeClock(justBefore(graceEndsAt));

      for (const permission of PERMISSIONS) {
        clock.set(justBefore(graceEndsAt));
        const active = await callAs(permission, clock, { userId: ungrantedId, granted: false });
        clock.set(graceEndsAt);
        const restricted = await callAs(permission, clock, { userId: ungrantedId, granted: false });

        for (const result of [active, restricted]) {
          expect(result.outcome.ok).toBe(false);
          if (result.outcome.ok) continue;
          expect(result.outcome.error).toBeInstanceOf(AuthorizationError);
          expect(result.outcome.error).not.toBeInstanceOf(LicenceRestrictedError);
          expect(result.handler).not.toHaveBeenCalled();
        }
        if (active.outcome.ok || restricted.outcome.ok) continue;
        const a = active.outcome.error as Error;
        const r = restricted.outcome.error as Error;
        expect(r.name).toBe(a.name);
        expect(r.message).toBe(a.message);
      }

      // The guard was never called for them, so no enforcement row names the unauthorized actor.
      const rows = await testDb.prisma.auditEvent.findMany({
        where: { action: "licence.restriction_enforced", actorId: ungrantedId },
      });
      expect(rows).toHaveLength(0);
    });

    it("an unauthenticated caller gets AuthenticationError in both states", async () => {
      const { graceEndsAt } = await activateDefault();
      const clock = makeClock(justBefore(graceEndsAt));

      for (const permission of ["courses.edit", "courses.view", "licence.activate"] as const) {
        for (const at of [justBefore(graceEndsAt), graceEndsAt]) {
          clock.set(at);
          const { outcome, handler } = await callAs(permission, clock, { userId: null, granted: false });
          expect(outcome.ok).toBe(false);
          if (outcome.ok) continue;
          expect(outcome.error).toBeInstanceOf(AuthenticationError);
          expect(outcome.error).not.toBeInstanceOf(AuthorizationError);
          expect(handler).not.toHaveBeenCalled();
        }
      }
    });
  });

  describe("the explicit guard used by checkout and registration (assertWriteAllowed)", () => {
    it.each(["checkout.start", "registration"])(
      "operation %s resolves at G minus 1 ms and rejects with LicenceWriteBlockedError at G",
      async (operation) => {
        const { graceEndsAt } = await activateDefault();
        const clock = makeClock(justBefore(graceEndsAt));
        const service = serviceAt(testDb, clock);

        await expect(service.assertWriteAllowed({ operation })).resolves.toBeUndefined();

        clock.set(graceEndsAt);
        await expect(service.assertWriteAllowed({ operation })).rejects.toBeInstanceOf(
          LicenceWriteBlockedError,
        );
        await expect(service.assertWriteAllowed({ operation, actorId })).rejects.toThrow(
          "This action is temporarily unavailable.",
        );
      },
    );
  });

  describe("dynamic default: a permission outside the catalogue is write", () => {
    it("is allowed at G minus 1 ms and refused at G, so new resources inherit enforcement", async () => {
      const { graceEndsAt } = await activateDefault();
      const clock = makeClock(justBefore(graceEndsAt));
      const unknown = "invoices.manage" as Permission;
      expect(Object.hasOwn(LICENCE_PERMISSION_EFFECT, unknown)).toBe(false);
      expect(effectForPermission(unknown)).toBe("write");

      const before = await callAs(unknown, clock, { userId: actorId, granted: true });
      expect(before.outcome).toEqual({ ok: true, value: unknown });

      clock.set(graceEndsAt);
      const at = await callAs(unknown, clock, { userId: actorId, granted: true });
      expect(at.outcome.ok).toBe(false);
      if (!at.outcome.ok) expect(at.outcome.error).toBeInstanceOf(LicenceRestrictedError);
      expect(at.handler).not.toHaveBeenCalled();
    });
  });

  describe("never activated (OQ1 option-a: operational until first activation)", () => {
    it("every permission runs, however late the clock stands", async () => {
      // The tables were reset to UNLICENSED by beforeEach; nothing is activated here.
      const late = makeClock(new Date(FIXTURE_NOW.getTime() + 5 * 365 * 86_400_000));
      const { withPermission } = guardedWithPermission(testDb, late, {
        grants: PERMISSIONS.map((p) => grant(p)),
        userId: actorId,
      });

      for (const permission of PERMISSIONS) {
        const handler = spyHandler(permission);
        await expect(withPermission(permission, () => ({}))(handler)({})).resolves.toBe(permission);
        expect(handler).toHaveBeenCalledTimes(1);
      }
      const rows = await testDb.prisma.auditEvent.findMany({
        where: { action: "licence.restriction_enforced" },
      });
      expect(rows).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Task 2: recovery by activation (D-07, PRD 18.1, OQ3)
// ---------------------------------------------------------------------------

const FULL_SPREAD = () => PERMISSIONS.map((p) => grant(p));

/** The permission-wrapped staff service over the real guard and the real activation service. */
function buildStaff(clock: ReturnType<typeof makeClock>, grants: ReturnType<typeof grant>[], userId: string) {
  const guarded = guardedWithPermission(testDb, clock, { grants, userId });
  const staff = createLicenceStaffService({
    withPermission: guarded.withPermission,
    licence: guarded.service,
    activation: activationAt(testDb, clock),
    audit: auditSink(testDb),
  });
  return { staff, guarded };
}

/** Runs every write-class permission through the guard; returns which were refused and which ran. */
async function probeWritePermissions(guarded: ReturnType<typeof guardedWithPermission>) {
  const refused: Permission[] = [];
  const ran: Permission[] = [];
  for (const permission of WRITE_PERMISSIONS) {
    try {
      await guarded.withPermission(permission, () => ({}))(spyHandler(permission))({});
      ran.push(permission);
    } catch (error) {
      expect(error).toBeInstanceOf(LicenceRestrictedError);
      refused.push(permission);
    }
  }
  return { refused, ran };
}

describe("recovery by activation (D-07, PRD 18.1, OQ3 adopted default)", () => {
  it("an actor holding the full permission spread (the seeded Administrator shape) activates a renewal while restricted and write-class permissions run again", async () => {
    const { graceEndsAt } = await activateDefault();
    const clock = makeClock(graceEndsAt);
    const { staff, guarded } = buildStaff(clock, FULL_SPREAD(), actorId);

    // Restricted: the deployment refuses the whole write class...
    const restricted = await probeWritePermissions(guarded);
    expect(restricted.refused).toHaveLength(EXPECTED_WRITE);
    expect(restricted.ran).toHaveLength(0);
    expect((await staff.getStatusForStaff()).isRestricted).toBe(true);

    // ...yet licence.activate (continuity) still reaches the activation service.
    const renewal = mintAt(graceEndsAt, { issuedAt: new Date(graceEndsAt.getTime() - 60 * 60 * 1000) });
    const result = await staff.activateLicenceForStaff({ raw: renewal.raw, correlationId: "recovery-1" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(["ACTIVE", "EXPIRING_SOON"]).toContain(result.snapshot.state);
    expect(result.snapshot.isRestricted).toBe(false);
    expect(["ACTIVE", "EXPIRING_SOON"]).toContain((await staff.getStatusForStaff()).state);

    // The same guard now lets the write class through: refused before, running after.
    const recovered = await probeWritePermissions(guarded);
    expect(recovered.refused).toHaveLength(0);
    expect(recovered.ran).toHaveLength(EXPECTED_WRITE);
    expect(await testDb.prisma.licenceRecord.count()).toBe(2);
  });

  it("an actor holding every permission except licence.activate is refused with AuthorizationError and nothing changes", async () => {
    const { graceEndsAt } = await activateDefault();
    const clock = makeClock(graceEndsAt);
    const withoutActivate = PERMISSIONS.filter((p) => p !== "licence.activate").map((p) => grant(p));
    const { staff } = buildStaff(clock, withoutActivate, ungrantedId);
    const stateBefore = await testDb.prisma.licenceState.findUniqueOrThrow({ where: { id: "current" } });
    const renewal = mintAt(graceEndsAt, { issuedAt: new Date(graceEndsAt.getTime() - 60 * 60 * 1000) });

    const error = await staff.activateLicenceForStaff({ raw: renewal.raw }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthorizationError);
    expect(error).not.toBeInstanceOf(LicenceRestrictedError);
    await expect(staff.inspectLicenceForStaff({ raw: renewal.raw })).rejects.toBeInstanceOf(AuthorizationError);

    expect(await testDb.prisma.licenceRecord.count()).toBe(1);
    const stateAfter = await testDb.prisma.licenceState.findUniqueOrThrow({ where: { id: "current" } });
    expect(stateAfter.activeRecordId).toBe(stateBefore.activeRecordId);
    expect(stateAfter.version).toBe(stateBefore.version);
  });

  it("a licence.view-only actor can read the status but cannot activate", async () => {
    const { graceEndsAt } = await activateDefault();
    const clock = makeClock(graceEndsAt);
    const { staff } = buildStaff(clock, [grant("licence.view")], ungrantedId);

    const status = await staff.getStatusForStaff();
    expect(status.isRestricted).toBe(true);

    const renewal = mintAt(graceEndsAt, { issuedAt: new Date(graceEndsAt.getTime() - 60 * 60 * 1000) });
    await expect(staff.activateLicenceForStaff({ raw: renewal.raw })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    expect(await testDb.prisma.licenceRecord.count()).toBe(1);
  });

  it("an invalid (tampered) stored licence restricts immediately and activating a valid licence recovers it", async () => {
    const { minted, licenceId } = await activateDefault();
    const clock = makeClock(FIXTURE_NOW);
    const { staff, guarded } = buildStaff(clock, FULL_SPREAD(), actorId);

    // Healthy: the write class runs.
    expect((await probeWritePermissions(guarded)).ran).toHaveLength(EXPECTED_WRITE);

    // Tamper with the stored text (a middle character of the signature segment).
    const parts = minted.raw.split(".");
    const mid = Math.floor(parts[3].length / 2);
    parts[3] = `${parts[3].slice(0, mid)}${parts[3][mid] === "A" ? "B" : "A"}${parts[3].slice(mid + 1)}`;
    await testDb.prisma.licenceRecord.update({ where: { licenceId }, data: { raw: parts.join(".") } });

    const status = await staff.getStatusForStaff();
    expect(status.state).toBe("INVALID");
    expect(status.isRestricted).toBe(true);
    const restricted = await probeWritePermissions(guarded);
    expect(restricted.refused).toHaveLength(EXPECTED_WRITE);

    const renewal = mintAt(FIXTURE_NOW, { issuedAt: new Date(FIXTURE_NOW.getTime() - 60 * 60 * 1000) });
    const result = await staff.activateLicenceForStaff({ raw: renewal.raw });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.snapshot.state).toBe("ACTIVE");
    expect((await staff.getStatusForStaff()).isRestricted).toBe(false);
    expect((await probeWritePermissions(guarded)).ran).toHaveLength(EXPECTED_WRITE);
  });
});

// ---------------------------------------------------------------------------
// Task 2: data preservation (LIC-08, D-05, T-14-21-03)
// ---------------------------------------------------------------------------

const NON_APPLICATION_TABLES = ["LicenceState", "LicenceRecord", "DeploymentIdentity", "AuditEvent", "DomainEvent"];

let seedSeq = 0;

/** Populates at least user, cohort, enrolment, order, payment attempt and notification tables, plus more. */
async function seedApplicationData() {
  const prisma = testDb.prisma;
  seedSeq += 1;
  const tag = `${Date.now()}-${seedSeq}`;
  const { cohortId, courseId } = await seedPublishedCohortFixture(prisma, {
    capacity: 5,
    seatsTaken: 1,
    priceMinor: 1_000_000,
    currency: "NGN",
  });
  const { userId } = await seedLearnerFixture(prisma, { emailVerified: new Date() });
  const order = await prisma.order.create({
    data: {
      reference: `KQO-RST-${tag}`,
      userId,
      cohortId,
      amountMinor: 1_000_000,
      currency: "NGN",
      status: "PENDING",
      selectedProvider: "PAYSTACK",
      baseAmountMinor: 1_000_000,
      platformFeeMinor: 0,
      gatewayFeeEstimateMinor: 0,
      schoolSettlementExpectedMinor: 1_000_000,
      idempotencyKey: `idem-rst-${tag}`,
    },
    select: { id: true },
  });
  const { enrolmentId } = await seedEnrolmentFixture(prisma, {
    cohortId,
    userId,
    status: "ACTIVE",
    orderId: order.id,
  });
  await prisma.paymentAttempt.create({
    data: {
      orderId: order.id,
      provider: "PAYSTACK",
      providerIntentId: `PSK-RST-${tag}`,
      amountMinor: 1_000_000,
      currency: "NGN",
      status: "PROCESSING",
      idempotencyKey: `pa-idem-rst-${tag}`,
    },
  });
  await prisma.notification.create({
    data: {
      recipientId: userId,
      type: "ENROLMENT_CONFIRMED",
      targetType: "ENROLMENT",
      targetId: enrolmentId,
      params: {},
      sourceEventId: `evt-rst-${tag}`,
    },
  });
  const moduleRow = await prisma.module.create({
    data: { courseId, title: "Preserved module", position: 0 },
    select: { id: true },
  });
  const lesson = await prisma.lesson.create({
    data: { moduleId: moduleRow.id, title: "Preserved lesson", type: "TEXT", position: 0 },
    select: { id: true },
  });
  await prisma.lessonProgress.create({ data: { enrolmentId, lessonId: lesson.id } });
  const { sessionId } = await seedSessionFixture(prisma, { cohortId });
  await seedAttendanceFixture(prisma, { sessionId, enrolmentId });
  await prisma.certificate.create({
    data: {
      verificationRef: `CERT-RST-${tag}`,
      enrolmentId,
      userId,
      scope: "COURSE",
      courseId,
      awardTitle: "Preserved Award",
      learnerName: "Fixture Learner",
    },
  });
  await seedStaffUser(prisma, ["courses.view"]);
}

describe("restricted continuity mode deletes nothing and is not a database-wide write lock (LIC-08, D-05)", () => {
  it("row counts of every application table are identical after a restricted period with refused write attempts", async () => {
    const { graceEndsAt } = await activateDefault();
    await seedApplicationData();
    const before = await snapshotTableCounts(testDb.prisma, NON_APPLICATION_TABLES);

    const populated = Object.entries(before).filter(([, count]) => count > 0);
    expect(populated.length).toBeGreaterThanOrEqual(6);
    for (const table of ["User", "Cohort", "Enrolment", "Order", "PaymentAttempt", "Notification"]) {
      expect(before[table], `${table} must be populated before the period`).toBeGreaterThan(0);
    }
    // Names are read from the database itself: the excluded tables are really absent from the snapshot.
    for (const table of NON_APPLICATION_TABLES) expect(before).not.toHaveProperty(table);

    // Restricted period. A write-class handler is destructive: if a refusal ever failed
    // open, a row would be created and the enrolments removed, and the counts would differ.
    const clock = makeClock(new Date(graceEndsAt.getTime() + 3_600_000));
    const { withPermission, service } = guardedWithPermission(testDb, clock, {
      grants: FULL_SPREAD(),
      userId: actorId,
    });
    const destructive = async () => {
      await testDb.prisma.user.create({
        data: { email: `should-not-exist-${Date.now()}@licence-restricted.test`, name: "x" },
      });
      await testDb.prisma.enrolment.deleteMany();
      return "RAN";
    };
    const harmless = async () => testDb.prisma.user.count();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      for (const permission of WRITE_PERMISSIONS) {
        const error = await withPermission(permission, () => ({}))(destructive)({}).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(LicenceRestrictedError);
      }
    }
    for (const permission of PERMISSIONS) {
      if (LICENCE_PERMISSION_EFFECT[permission] === "write") continue;
      await expect(withPermission(permission, () => ({}))(harmless)({})).resolves.toBeGreaterThan(0);
    }
    // The evaluation, status and diagnostic paths write only licence state and audit rows.
    await service.evaluateAndRecord({ source: "SCHEDULED" });
    await service.getStatusSnapshot();
    await service.buildDiagnosticReport();

    const after = await snapshotTableCounts(testDb.prisma, NON_APPLICATION_TABLES);
    expect(after).toEqual(before);
  });

  it("the database stays writable at the restricted clock and the audit trail keeps appending", async () => {
    const { graceEndsAt } = await activateDefault();
    const clock = makeClock(graceEndsAt);
    const { withPermission } = guardedWithPermission(testDb, clock, {
      grants: FULL_SPREAD(),
      userId: actorId,
    });
    // Confirm the deployment really is restricted.
    await expect(
      withPermission("courses.edit", () => ({}))(spyHandler("x"))({}),
    ).rejects.toBeInstanceOf(LicenceRestrictedError);

    const usersBefore = await testDb.prisma.user.count();
    const created = await testDb.prisma.user.create({
      data: { email: `still-writable-${Date.now()}@licence-restricted.test`, name: "Still writable" },
    });
    expect(await testDb.prisma.user.count()).toBe(usersBefore + 1);
    await testDb.prisma.user.update({ where: { id: created.id }, data: { name: "Updated" } });

    // The application's recordAudit is bound to the application's own client; the test-bound
    // equivalent shares its sink code (recordAuditInTransaction -> buildAuditRow).
    const auditBefore = await testDb.prisma.auditEvent.count();
    await recordAuditInTransaction(testDb.prisma, {
      actorId,
      action: "licence.test_probe",
      targetType: "LICENCE",
      outcome: "SUCCESS",
    });
    expect(await testDb.prisma.auditEvent.count()).toBe(auditBefore + 1);
    await testDb.prisma.auditEvent.deleteMany({ where: { action: "licence.test_probe" } });

    // A Postgres-level write lock would show in the server settings and fail writes in a transaction.
    const readOnly = await testDb.prisma.$queryRaw<Array<{ default_transaction_read_only: string }>>`
      SHOW default_transaction_read_only`;
    expect(readOnly[0].default_transaction_read_only).toBe("off");
    const inTransaction = await testDb.prisma.$queryRaw<Array<{ transaction_read_only: string }>>`
      SHOW transaction_read_only`;
    expect(inTransaction[0].transaction_read_only).toBe("off");
  });
});

// ---------------------------------------------------------------------------
// Task 2: no deletion code (LIC-08, P3)
// ---------------------------------------------------------------------------

const LICENCE_SOURCE_FILES = [
  "src/server/services/licence-service.ts",
  "src/server/services/licence-activation-service.ts",
  "src/server/services/licence-notice-service.ts",
  "src/server/services/licence-staff-service.ts",
  "src/server/services/licence-startup-service.ts",
];

function listTypeScript(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) found.push(...listTypeScript(full));
    else if (full.endsWith(".ts") && !full.endsWith(".d.ts")) found.push(full);
  }
  return found;
}

type DeletionFinding = { line: number; text: string };

/**
 * Reports every property call named delete or deleteMany whose receiver is not a
 * same-file in-memory collection (a `new Map`, `new Set` or `new WeakMap` const),
 * plus any string or template text that holds a DELETE FROM or TRUNCATE statement.
 * A Map.delete is not data deletion; a prisma delegate or a raw statement is.
 */
function scanForDeletion(fileName: string, text: string): DeletionFinding[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const memoryCollections = new Set<string>();
  const collect = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isNewExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      ["Map", "Set", "WeakMap", "WeakSet"].includes(node.initializer.expression.text)
    ) {
      memoryCollections.add(node.name.text);
    }
    ts.forEachChild(node, collect);
  };
  collect(source);

  const findings: DeletionFinding[] = [];
  const lineOf = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = node.expression.name.text;
      if (name === "delete" || name === "deleteMany") {
        const receiver = node.expression.expression;
        const exempt = ts.isIdentifier(receiver) && memoryCollections.has(receiver.text);
        if (!exempt) findings.push({ line: lineOf(node), text: node.getText(source) });
      }
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      const literal = ts.isTemplateExpression(node)
        ? [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" ")
        : node.text;
      if (/\bDELETE\s+FROM\b|\bTRUNCATE\b/i.test(literal)) {
        findings.push({ line: lineOf(node), text: literal.slice(0, 80) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

describe("no licence code deletes application data (LIC-08, P3)", () => {
  it("the scanner flags a prisma delete, deleteMany and a raw TRUNCATE and exempts only an in-memory Map", () => {
    const flagged = scanForDeletion(
      "fixture.ts",
      [
        "const seen = new Map<string, number>();",
        "seen.delete('a');",
        "await tx.user.delete({ where: { id } });",
        "await prisma.enrolment.deleteMany();",
        "await prisma.$executeRawUnsafe('TRUNCATE TABLE \"User\"');",
        "await prisma.$executeRaw`DELETE FROM \"Order\"`;",
      ].join("\n"),
    );
    expect(flagged.map((finding) => finding.line)).toEqual([3, 4, 5, 6]);
  });

  it("src/server/licence and the licence services contain zero deletion calls on any table", () => {
    const root = process.cwd();
    const files = [
      ...listTypeScript(path.join(root, "src/server/licence")),
      ...LICENCE_SOURCE_FILES.map((file) => path.join(root, file)),
    ];
    // Guard against a vacuous pass: the scan really covers the licence modules.
    expect(files.length).toBeGreaterThanOrEqual(15);

    const findings = files.flatMap((file) =>
      scanForDeletion(file, readFileSync(file, "utf8")).map(
        (finding) => `${path.relative(root, file)}:${finding.line} ${finding.text}`,
      ),
    );
    expect(findings).toEqual([]);
  });
});
