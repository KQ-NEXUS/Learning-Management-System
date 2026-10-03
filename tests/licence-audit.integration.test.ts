/**
 * Real-Postgres proof that every licence event is audited with safe context
 * (Phase 14, plan 14-21; LIC-06, D-17, T-14-21-04, T-14-21-05, PRD 18.4).
 *
 * Audit rows are written through the real redacting row builder
 * (`recordAuditInTransaction` -> `buildAuditRow`) bound to the TEST database
 * client, never the configured DATABASE_URL singleton (the application's own
 * `recordAudit` is bound to the application's prisma instance). Time is an
 * injected clock; the audit table is append-only to the application, so cleanup
 * runs only through the test database client.
 *
 * PREREQUISITE: Docker must be running (`tests/support/pg.ts` starts the
 * container). If it is not, `beforeAll` fails with a container-start error:
 * every case reports BLOCKED, never a silent pass.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LICENCE_PERMISSION_EFFECT } from "@/server/licence/effects";
import { PERMISSION_GROUPS, groupOf } from "@/lib/permission-groups";
import { LicenceRestrictedError } from "@/server/permissions/with-permission";
import { hasPermission } from "@/server/permissions/scope";
import { createLicenceStaffService } from "@/server/services/licence-staff-service";
import { grant } from "./support/harness";
import {
  FLOW_KEY,
  activateAt,
  activationAt,
  auditSink,
  guardedWithPermission,
  makeClock,
  mintAt,
  resetLicenceFlow,
  serviceAt,
  spyHandler,
} from "./support/licence-flow";
import { FIXTURE_NOW } from "./support/licence-fixtures";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";

let testDb: TestDatabase;
let actorId: string;
let otherActorId: string;

beforeAll(async () => {
  testDb = await startTestDatabase();
  const make = async (email: string) =>
    (
      await testDb.prisma.user.create({
        data: { email, name: email, status: "ACTIVE", emailVerified: new Date(), isStaff: true },
      })
    ).id;
  actorId = await make("audit-actor@licence-audit.test");
  otherActorId = await make("audit-other@licence-audit.test");
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

/** Ids of every licence audit row this file created, deleted by id after each test. */
const createdAuditIds = new Set<string>();

async function trackAuditRows() {
  const rows = await testDb.prisma.auditEvent.findMany({
    where: { action: { startsWith: "licence." } },
    select: { id: true },
  });
  for (const row of rows) createdAuditIds.add(row.id);
}

beforeEach(async () => {
  await resetLicenceFlow(testDb);
  await trackAuditRows();
  await testDb.prisma.auditEvent.deleteMany({ where: { id: { in: [...createdAuditIds] } } });
  createdAuditIds.clear();
});

afterEach(async () => {
  await trackAuditRows();
  await testDb.prisma.auditEvent.deleteMany({ where: { id: { in: [...createdAuditIds] } } });
  createdAuditIds.clear();
});

async function auditRows(action: string) {
  return testDb.prisma.auditEvent.findMany({ where: { action }, orderBy: { createdAt: "asc" } });
}

async function activateDefault() {
  const activated = await activateAt(testDb, { now: FIXTURE_NOW, actorId });
  expect(activated.result.ok).toBe(true);
  return activated;
}

function tamperSignature(raw: string): string {
  const parts = raw.split(".");
  const mid = Math.floor(parts[3].length / 2);
  parts[3] = `${parts[3].slice(0, mid)}${parts[3][mid] === "A" ? "B" : "A"}${parts[3].slice(mid + 1)}`;
  return parts.join(".");
}

describe("each LIC-06 event class writes exactly the expected audit row (D-17)", () => {
  it("licence.activated: a successful activation, actor the user, targeting the licence at Global scope", async () => {
    const minted = mintAt(FIXTURE_NOW);
    const licenceId = (minted.payload as { licenceId: string }).licenceId;

    const result = await activationAt(testDb, makeClock(FIXTURE_NOW)).activateLicence({
      actorId,
      raw: minted.raw,
      correlationId: "corr-activated-1",
    });
    expect(result.ok).toBe(true);

    const rows = await auditRows("licence.activated");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId,
      actorType: "USER",
      targetType: "LICENCE",
      targetId: licenceId,
      scopeType: "GLOBAL",
      outcome: "SUCCESS",
      correlationId: "corr-activated-1",
    });
    expect(rows[0].after).toMatchObject({ state: "ACTIVE", licenceId });
  });

  it("licence.activation_rejected: a rejected activation carries the closed code and no licence identifier", async () => {
    const { minted } = await activateDefault();

    const result = await activationAt(testDb, makeClock(FIXTURE_NOW)).activateLicence({
      actorId: otherActorId,
      raw: minted.raw,
      correlationId: "corr-rejected-1",
    });
    expect(result).toEqual({ ok: false, code: "ALREADY_ACTIVE" });

    const rows = await auditRows("licence.activation_rejected");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: otherActorId,
      actorType: "USER",
      targetType: "LICENCE",
      targetId: null,
      scopeType: "GLOBAL",
      outcome: "REJECTED",
      correlationId: "corr-rejected-1",
    });
    expect(rows[0].after).toEqual({ code: "ALREADY_ACTIVE" });

    // A forged file is rejected too, again with a code only.
    const forged = tamperSignature(minted.raw);
    const forgedResult = await activationAt(testDb, makeClock(FIXTURE_NOW)).activateLicence({
      actorId: otherActorId,
      raw: forged,
    });
    expect(forgedResult.ok).toBe(false);
    const all = await auditRows("licence.activation_rejected");
    expect(all).toHaveLength(2);
    expect((all[1].after as { code: string }).code).toBe(forgedResult.ok ? "" : forgedResult.code);
  });

  it("licence.restriction_enforced: an enforcement denial names the operation and state", async () => {
    const { graceEndsAt, licenceId } = await activateDefault();
    const clock = makeClock(graceEndsAt);
    const { withPermission } = guardedWithPermission(testDb, clock, {
      grants: [grant("courses.edit")],
      userId: actorId,
    });

    await expect(
      withPermission("courses.edit", () => ({}))(spyHandler("x"))({}),
    ).rejects.toBeInstanceOf(LicenceRestrictedError);

    const rows = await auditRows("licence.restriction_enforced");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId,
      actorType: "USER",
      targetType: "LICENCE",
      targetId: licenceId,
      scopeType: "GLOBAL",
      outcome: "DENIED",
    });
    expect(rows[0].after).toMatchObject({ operation: "courses.edit", state: "RESTRICTED_CONTINUITY" });
  });

  it("licence.diagnostic_downloaded: a staff download is audited with the actor and no report content", async () => {
    const { licenceId } = await activateDefault();
    const clock = makeClock(FIXTURE_NOW);
    const guarded = guardedWithPermission(testDb, clock, { grants: [grant("licence.view")], userId: actorId });
    const staff = createLicenceStaffService({
      withPermission: guarded.withPermission,
      licence: guarded.service,
      activation: activationAt(testDb, clock),
      audit: auditSink(testDb),
    });

    const report = await staff.getDiagnosticForStaff();
    expect(report.licenceId).toBe(licenceId);

    const rows = await auditRows("licence.diagnostic_downloaded");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId,
      actorType: "USER",
      targetType: "LICENCE",
      targetId: licenceId,
      scopeType: "GLOBAL",
      outcome: "SUCCESS",
    });
    // No report content: no before, after or reason.
    expect(rows[0].before).toBeNull();
    expect(rows[0].after).toBeNull();
    expect(rows[0].reason).toBeNull();
    // Viewing the status is not audited (PRD 18.4); only the download is.
    await staff.getStatusForStaff();
    expect(await auditRows("licence.diagnostic_downloaded")).toHaveLength(1);
  });

  it("licence.state_changed: a transition by evaluateAndRecord is a system-actor row with before and after", async () => {
    const { expiresAt, licenceId } = await activateDefault();
    const service = serviceAt(testDb, makeClock(new Date(expiresAt.getTime() + 60 * 60 * 1000)));

    const result = await service.evaluateAndRecord({ source: "SCHEDULED", correlationId: "corr-state-1" });
    expect(result.transitions).toEqual([{ from: "ACTIVE", to: "GRACE", won: true }]);

    const rows = await auditRows("licence.state_changed");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: null,
      actorType: "SYSTEM",
      targetType: "LICENCE",
      targetId: licenceId,
      scopeType: "GLOBAL",
      outcome: "SUCCESS",
      correlationId: "corr-state-1",
    });
    expect(rows[0].before).toEqual({ state: "ACTIVE", reasonCode: null });
    expect(rows[0].after).toMatchObject({ state: "GRACE", source: "SCHEDULED" });
  });

  it("licence.verified: a verification outcome change (stored text tampered) is a system-actor FAILED row", async () => {
    const { minted, licenceId } = await activateDefault();
    await testDb.prisma.licenceRecord.update({
      where: { licenceId },
      data: { raw: tamperSignature(minted.raw) },
    });
    const service = serviceAt(testDb, makeClock(FIXTURE_NOW));

    const result = await service.evaluateAndRecord({ source: "SCHEDULED" });
    expect(result.verificationChanged).toBe(true);

    const rows = await auditRows("licence.verified");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: null,
      actorType: "SYSTEM",
      targetType: "LICENCE",
      targetId: licenceId,
      scopeType: "GLOBAL",
      outcome: "FAILED",
    });
    expect(rows[0].before).toEqual({ outcome: "OK" });
    expect(rows[0].after).toMatchObject({ outcome: "FAILED", source: "SCHEDULED" });
  });

  it("licence.clock_rollback: a stored high-water mark ahead of the clock writes one DETECTED system row", async () => {
    const { licenceId } = await activateDefault();
    await testDb.prisma.licenceState.update({
      where: { id: "current" },
      data: { highWaterAt: new Date(FIXTURE_NOW.getTime() + 60 * 60 * 1000) },
    });
    const service = serviceAt(testDb, makeClock(FIXTURE_NOW));

    const result = await service.evaluateAndRecord({ source: "SCHEDULED" });
    expect(result.rollbackDetected).toBe(true);

    const rows = await auditRows("licence.clock_rollback");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: null,
      actorType: "SYSTEM",
      targetType: "LICENCE",
      targetId: licenceId,
      scopeType: "GLOBAL",
      outcome: "DETECTED",
    });
    expect(rows[0].after).toMatchObject({ detectedBy: "STORED_MARK", behindSeconds: 3600 });
    // The anomaly never changes the licence state (P4: recovery is never locked out).
    expect((await testDb.prisma.licenceState.findUniqueOrThrow({ where: { id: "current" } })).state).toBe("ACTIVE");
  });
});

describe("a transition has exactly one winner under parallel load (D-17, LIC-05)", () => {
  it("three parallel evaluators and two parallel REQUEST gate calls produce one licence.state_changed row and the final state is GRACE", async () => {
    const { expiresAt } = await activateDefault();
    const at = new Date(expiresAt.getTime() + 60 * 60 * 1000);
    const versionBefore = (await testDb.prisma.licenceState.findUniqueOrThrow({ where: { id: "current" } })).version;

    const evaluators = Array.from({ length: 3 }, () =>
      serviceAt(testDb, makeClock(at)).evaluateAndRecord({ source: "REQUEST" }),
    );
    const gates = Array.from({ length: 2 }, (_, index) =>
      serviceAt(testDb, makeClock(at)).checkWriteGate({
        operation: "courses.edit",
        actorId: index === 0 ? actorId : otherActorId,
      }),
    );
    const [results, decisions] = await Promise.all([Promise.all(evaluators), Promise.all(gates)]);

    // Inside the grace period nothing is refused.
    for (const decision of decisions) expect(decision).toEqual({ allowed: true });
    expect(results.flatMap((r) => r.transitions).filter((t) => t.won)).toHaveLength(1);

    const rows = await auditRows("licence.state_changed");
    expect(rows).toHaveLength(1);
    expect(rows[0].before).toEqual({ state: "ACTIVE", reasonCode: null });
    expect(rows[0].after).toMatchObject({ state: "GRACE" });

    const state = await testDb.prisma.licenceState.findUniqueOrThrow({ where: { id: "current" } });
    expect(state.state).toBe("GRACE");
    expect(state.version).toBe(versionBefore + 1);
  });
});

describe("enforcement audit is coalesced (A14)", () => {
  it("20 refused calls by one actor within one minute create one licence.restriction_enforced row; a second actor creates a second", async () => {
    const { graceEndsAt } = await activateDefault();
    const clock = makeClock(graceEndsAt);
    const service = serviceAt(testDb, clock);
    const first = guardedWithPermission(testDb, clock, { grants: [grant("courses.edit")], userId: actorId, service });
    const second = guardedWithPermission(testDb, clock, {
      grants: [grant("courses.edit")],
      userId: otherActorId,
      service,
    });

    for (let call = 0; call < 20; call += 1) {
      await expect(
        first.withPermission("courses.edit", () => ({}))(spyHandler("x"))({}),
      ).rejects.toBeInstanceOf(LicenceRestrictedError);
    }
    const afterFirst = await auditRows("licence.restriction_enforced");
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0].actorId).toBe(actorId);

    await expect(
      second.withPermission("courses.edit", () => ({}))(spyHandler("x"))({}),
    ).rejects.toBeInstanceOf(LicenceRestrictedError);
    const afterSecond = await auditRows("licence.restriction_enforced");
    expect(afterSecond).toHaveLength(2);
    expect(afterSecond.map((row) => row.actorId).sort()).toEqual([actorId, otherActorId].sort());
  });
});

describe("no licence audit row carries licence text or key material (T-14-21-05)", () => {
  it("across every licence.* row, before, after and reason hold none of the minted text, its segments, key material or credential words", async () => {
    // A scenario that writes every licence event class.
    const { minted, licenceId, expiresAt, graceEndsAt } = await activateDefault();
    const clock = makeClock(FIXTURE_NOW);
    const rejectedRaw = tamperSignature(minted.raw);
    await activationAt(testDb, clock).activateLicence({ actorId: otherActorId, raw: minted.raw });
    await activationAt(testDb, clock).activateLicence({ actorId: otherActorId, raw: rejectedRaw });

    // Rollback, then a tampered store (verified FAILED + INVALID), then restored (verified OK).
    const evaluator = serviceAt(testDb, clock);
    await testDb.prisma.licenceState.update({
      where: { id: "current" },
      data: { highWaterAt: new Date(FIXTURE_NOW.getTime() + 60 * 60 * 1000) },
    });
    await evaluator.evaluateAndRecord({ source: "SCHEDULED" });
    await testDb.prisma.licenceRecord.update({ where: { licenceId }, data: { raw: rejectedRaw } });
    await evaluator.evaluateAndRecord({ source: "SCHEDULED" });
    await testDb.prisma.licenceRecord.update({ where: { licenceId }, data: { raw: minted.raw } });
    await evaluator.evaluateAndRecord({ source: "SCHEDULED" });

    // Grace, restriction, enforcement and a diagnostic download.
    clock.set(new Date(expiresAt.getTime() + 60 * 60 * 1000));
    await evaluator.evaluateAndRecord({ source: "SCHEDULED" });
    clock.set(graceEndsAt);
    const guarded = guardedWithPermission(testDb, clock, {
      grants: [grant("courses.edit"), grant("licence.view")],
      userId: actorId,
      service: evaluator,
    });
    await guarded.withPermission("courses.edit", () => ({}))(spyHandler("x"))({}).catch(() => undefined);
    const staff = createLicenceStaffService({
      withPermission: guarded.withPermission,
      licence: guarded.service,
      activation: activationAt(testDb, clock),
      audit: auditSink(testDb),
    });
    await staff.getDiagnosticForStaff();

    const rows = await testDb.prisma.auditEvent.findMany({ where: { action: { startsWith: "licence." } } });
    const actions = new Set(rows.map((row) => row.action));
    for (const action of [
      "licence.activated",
      "licence.activation_rejected",
      "licence.state_changed",
      "licence.verified",
      "licence.restriction_enforced",
      "licence.clock_rollback",
      "licence.diagnostic_downloaded",
    ]) {
      expect(actions, `scenario must produce ${action}`).toContain(action);
    }

    const [, header, payload, signature] = minted.raw.split(".");
    const [, , , forgedSignature] = rejectedRaw.split(".");
    const privateKeyDer = FLOW_KEY.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
    const forbidden = [
      minted.raw,
      rejectedRaw,
      header,
      payload,
      signature,
      forgedSignature,
      privateKeyDer,
      FLOW_KEY.x,
      "PRIVATE KEY",
    ];

    for (const row of rows) {
      expect(row.targetType, `${row.action} must name a target type`).not.toBeNull();
      expect(row.targetType).toBe("LICENCE");
      const body = JSON.stringify({ before: row.before, after: row.after, reason: row.reason });
      for (const needle of forbidden) {
        expect(body.includes(needle), `${row.action} must not contain licence text or key material`).toBe(false);
      }
      expect(/password|secret/i.test(body), `${row.action} must not contain credential words`).toBe(false);
    }
  });
});

describe("licence permissions do not grant audit access (PRD 18.4)", () => {
  it("licence.view and licence.activate are a separate group from audit.view and audit.export", () => {
    const licenceGroup = PERMISSION_GROUPS.find((group) => group.id === "licence");
    const auditGroup = PERMISSION_GROUPS.find((group) => group.id === "audit");
    expect(licenceGroup?.permissions).toEqual(["licence.view", "licence.activate"]);
    expect(auditGroup?.permissions).toEqual(["audit.view", "audit.export"]);
    expect(groupOf("licence.view")?.id).toBe("licence");
    expect(groupOf("licence.activate")?.id).toBe("licence");
    expect(groupOf("audit.view")?.id).toBe("audit");
    expect(groupOf("audit.export")?.id).toBe("audit");
    for (const permission of licenceGroup?.permissions ?? []) {
      expect(auditGroup?.permissions).not.toContain(permission);
    }
  });

  it("holding both licence permissions authorizes neither audit permission, and the reverse", () => {
    const licenceGrants = (["licence.view", "licence.activate"] as const).map((permission) => ({
      permission,
      scopeType: "GLOBAL" as const,
      scopeId: null,
    }));
    const auditGrants = (["audit.view", "audit.export"] as const).map((permission) => ({
      permission,
      scopeType: "GLOBAL" as const,
      scopeId: null,
    }));
    for (const permission of ["audit.view", "audit.export"] as const) {
      expect(hasPermission(licenceGrants, permission, {})).toBe(false);
    }
    for (const permission of ["licence.view", "licence.activate"] as const) {
      expect(hasPermission(auditGrants, permission, {})).toBe(false);
    }
    // The effect classification is about restriction behaviour, not access: each is its own entry.
    expect(LICENCE_PERMISSION_EFFECT["licence.view"]).toBe("read");
    expect(LICENCE_PERMISSION_EFFECT["licence.activate"]).toBe("continuity");
    expect(LICENCE_PERMISSION_EFFECT["audit.view"]).toBe("read");
    expect(LICENCE_PERMISSION_EFFECT["audit.export"]).toBe("continuity");
  });
});
