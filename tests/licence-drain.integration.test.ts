/**
 * Real-Postgres proof of the licence notice pipeline (Phase 14 plan 14-14;
 * LIC-07, D-15, prohibition P5): `licenceNoticeService.emitNotices` writes one
 * deduplicated `licence.notice` event per notice key, and the real Phase 13
 * drain turns it into exactly one Notification and (except for expiring-60)
 * one EmailDispatch for each active staff member holding a Global
 * `licence.view` grant, with no signing, contract, key or deployment detail.
 *
 * PREREQUISITE: Docker must be running (`tests/support/pg.ts` starts the
 * container). If it is not, `beforeAll` fails with a container-start error;
 * every case then reports BLOCKED, never a silent pass. The shared
 * development database is never contacted: the service is built over the
 * container's client.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { startDrainHarness, seedStaffUser, seedVerifiedLearner } from "./support/drain-harness";
import {
  createLicenceNoticeService,
  prismaCreateManyClient,
} from "@/server/services/licence-notice-service";
import { renderNotificationText } from "@/server/communications/notification-text";
import type { LicenceStatusSnapshot } from "@/server/licence/types";

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await startTestDatabase();
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

afterEach(async () => {
  // FK-safe order: children (notification, dispatch), then the event outbox,
  // then assignments, roles and the users this file seeded.
  await testDb.prisma.notification.deleteMany();
  await testDb.prisma.emailPreference.deleteMany();
  await testDb.prisma.emailDispatch.deleteMany();
  await testDb.prisma.domainEvent.deleteMany();
  await testDb.prisma.auditEvent.deleteMany({ where: { action: "domain_event.poisoned" } });
  await testDb.prisma.assignment.deleteMany();
  await testDb.prisma.role.deleteMany();
  await testDb.prisma.user.deleteMany({ where: { email: { contains: "@drain-harness.test" } } });
});

const NOW = new Date("2026-10-02T09:00:00.000Z");
const SECRET_DEPLOYMENT_ID = "fixture-deployment-0001";
const SECRET_KEY_ID = "kid-secret-1";
const SECRET_CLIENT = "Fixture Training Academy";

function graceSnapshot(overrides: Partial<LicenceStatusSnapshot> = {}): LicenceStatusSnapshot {
  return {
    state: "GRACE",
    reasonCode: null,
    isRestricted: false,
    everActivated: true,
    licenceId: "L1",
    keyId: SECRET_KEY_ID,
    schemaVersion: 1,
    clientName: SECRET_CLIENT,
    deploymentId: SECRET_DEPLOYMENT_ID,
    issuedAt: new Date("2026-01-01T00:00:00.000Z"),
    notBefore: new Date("2026-01-01T00:00:00.000Z"),
    expiresAt: new Date("2026-09-30T22:59:59.000Z"),
    graceEndsAt: new Date("2026-10-14T22:59:59.000Z"),
    timeZone: "Africa/Lagos",
    support: { renewalEmail: "renew@fixture.test", supportEmail: "support@fixture.test", phone: null, hours: null },
    restrictedAt: null,
    daysRemaining: -2,
    daysToGraceEnd: 12,
    underOneDay: false,
    lastVerifiedAt: NOW,
    lastVerificationOutcome: "OK",
    attentionSince: null,
    clockAlertAt: null,
    highWaterAt: null,
    evaluatedAt: NOW,
    ...overrides,
  };
}

/** Staff A and B (Global licence.view), C (courses.view only), learner D and deactivated staff E (licence.view). */
async function seedAudience() {
  const a = await seedStaffUser(testDb.prisma, ["licence.view"]);
  const b = await seedStaffUser(testDb.prisma, ["licence.view"]);
  const c = await seedStaffUser(testDb.prisma, ["courses.view"]);
  const d = await seedVerifiedLearner(testDb.prisma);
  const e = await seedStaffUser(testDb.prisma, ["licence.view"]);
  await testDb.prisma.user.update({ where: { id: e.id }, data: { status: "DEACTIVATED" } });
  return { a, b, c, d, e, holders: [a.id, b.id].sort(), others: [c.id, d.id, e.id] };
}

function noticeService() {
  return createLicenceNoticeService({ db: prismaCreateManyClient(testDb.prisma), now: () => NOW });
}

async function notices(type = "staff.licence_notice") {
  return testDb.prisma.notification.findMany({ where: { type }, orderBy: { createdAt: "asc" } });
}

async function licenceDispatches() {
  return testDb.prisma.emailDispatch.findMany({ where: { template: "staff-licence-notice" } });
}

describe("licence.notice drain: dedupe, recipients and content (D-15, LIC-07)", () => {
  it("Test 1: a grace notice reaches exactly the Global licence.view holders, one notification and one email each", async () => {
    const { holders, others } = await seedAudience();
    const harness = startDrainHarness(testDb.prisma);

    const emitted = await noticeService().emitNotices({ snapshot: graceSnapshot(), noticeKeys: ["expired"] });
    expect(emitted.created).toEqual(["licence:L1:expired"]);

    const result = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(result.processed).toBe(1);

    const rows = await notices();
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.recipientId).sort()).toEqual(holders);
    for (const row of rows) {
      expect(row.type).toBe("staff.licence_notice");
      expect(row.targetType).toBe("STAFF_LICENCE");
      expect(row.targetId).toBe("L1");
      expect(row.sourceEventId).toBe("licence:L1:expired");
    }

    const dispatches = await licenceDispatches();
    expect(dispatches).toHaveLength(2);
    expect(dispatches.map((row) => row.userId).sort()).toEqual(holders);
    for (const holder of holders) {
      expect(dispatches.filter((row) => row.userId === holder)).toHaveLength(1);
      expect(rows.filter((row) => row.recipientId === holder)).toHaveLength(1);
    }

    // Staff C, learner D and deactivated staff E receive nothing at all.
    for (const other of others) {
      expect(await testDb.prisma.notification.count({ where: { recipientId: other } })).toBe(0);
      expect(await testDb.prisma.emailDispatch.count({ where: { userId: other } })).toBe(0);
    }
  });

  it("Test 2: re-emitting is skipped, a second drain changes nothing, and replaying the processed event creates no duplicate", async () => {
    await seedAudience();
    const harness = startDrainHarness(testDb.prisma);
    const service = noticeService();

    await service.emitNotices({ snapshot: graceSnapshot(), noticeKeys: ["expired"] });
    await harness.drainService.drain({ events: 25, sends: 25 });
    const before = {
      events: await testDb.prisma.domainEvent.count({ where: { type: "licence.notice" } }),
      notifications: (await notices()).length,
      dispatches: (await licenceDispatches()).length,
      sends: harness.send.mock.calls.length,
    };
    expect(before).toEqual({ events: 1, notifications: 2, dispatches: 2, sends: 2 });

    const again = await service.emitNotices({ snapshot: graceSnapshot(), noticeKeys: ["expired"] });
    expect(again).toEqual({ created: [], skipped: ["licence:L1:expired"] });
    const second = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(second.processed).toBe(0);
    expect(await testDb.prisma.domainEvent.count({ where: { type: "licence.notice" } })).toBe(1);
    expect((await notices()).length).toBe(2);
    expect((await licenceDispatches()).length).toBe(2);

    // Replay: mark the processed event unprocessed again and drain once more.
    await testDb.prisma.domainEvent.update({ where: { id: "licence:L1:expired" }, data: { processedAt: null } });
    const replay = await harness.drainService.drain({ events: 25, sends: 25 });
    expect(replay.processed).toBe(1);
    expect((await notices()).length).toBe(2);
    expect((await licenceDispatches()).length).toBe(2);
    expect(harness.send.mock.calls.length).toBe(2);
  });

  it("Test 3: expiring-60 is in-product only; expiring-30 creates a notification and an email", async () => {
    const { holders } = await seedAudience();
    const harness = startDrainHarness(testDb.prisma);
    const service = noticeService();
    const expiring = graceSnapshot({ state: "EXPIRING_SOON", daysRemaining: 59, daysToGraceEnd: null });

    await service.emitNotices({ snapshot: expiring, noticeKeys: ["expiring-60"] });
    await harness.drainService.drain({ events: 25, sends: 25 });

    expect((await notices()).map((row) => row.recipientId).sort()).toEqual(holders);
    expect(await licenceDispatches()).toHaveLength(0);

    await service.emitNotices({ snapshot: expiring, noticeKeys: ["expiring-30"] });
    await harness.drainService.drain({ events: 25, sends: 25 });

    expect(await notices()).toHaveLength(4);
    const dispatches = await licenceDispatches();
    expect(dispatches).toHaveLength(2);
    expect(dispatches.map((row) => row.userId).sort()).toEqual(holders);
  });

  it("Test 4: a replacement licence (new licence id) renews the same notice key", async () => {
    const { holders } = await seedAudience();
    const harness = startDrainHarness(testDb.prisma);
    const service = noticeService();

    await service.emitNotices({
      snapshot: graceSnapshot({ state: "EXPIRING_SOON", licenceId: "L1", daysRemaining: 29 }),
      noticeKeys: ["expiring-30"],
    });
    await harness.drainService.drain({ events: 25, sends: 25 });
    expect(await notices()).toHaveLength(2);

    const renewed = await service.emitNotices({
      snapshot: graceSnapshot({ state: "EXPIRING_SOON", licenceId: "L2", daysRemaining: 29 }),
      noticeKeys: ["expiring-30"],
    });
    expect(renewed.created).toEqual(["licence:L2:expiring-30"]);
    await harness.drainService.drain({ events: 25, sends: 25 });

    const rows = await notices();
    expect(rows).toHaveLength(4);
    for (const holder of holders) {
      expect(rows.filter((row) => row.recipientId === holder).map((row) => row.targetId).sort()).toEqual(["L1", "L2"]);
    }
    expect(await licenceDispatches()).toHaveLength(4);
  });

  it("Test 5: stored params are allow-listed, carry no signing, contract, key or deployment detail, and the email subject equals the title", async () => {
    await seedAudience();
    const harness = startDrainHarness(testDb.prisma);

    await noticeService().emitNotices({
      snapshot: graceSnapshot({ daysToGraceEnd: 3, state: "GRACE" }),
      noticeKeys: ["expired", "grace-ending"],
    });
    await noticeService().emitNotices({
      snapshot: graceSnapshot({ state: "INVALID", reasonCode: "WRONG_DEPLOYMENT" }),
      noticeKeys: ["invalid-WRONG_DEPLOYMENT"],
    });
    await harness.drainService.drain({ events: 25, sends: 25 });

    const rows = await notices();
    expect(rows).toHaveLength(6);
    const forbidden = ["deploymentId", "signature", "privateKey", "client", "contract"];
    const secrets = [SECRET_DEPLOYMENT_ID, SECRET_KEY_ID, SECRET_CLIENT, "fixture.test", "LMS-LIC1"];
    for (const row of rows) {
      const params = row.params as Record<string, unknown>;
      expect(Object.keys(params).every((key) => ["noticeKey", "days", "expiry", "graceEnd"].includes(key))).toBe(true);
      const json = JSON.stringify(params);
      for (const word of forbidden) expect(json).not.toContain(word);
      for (const secret of secrets) expect(json).not.toContain(secret);
    }

    const dispatches = await licenceDispatches();
    expect(dispatches).toHaveLength(6);
    for (const dispatch of dispatches) {
      const params = dispatch.templateParams as Record<string, unknown>;
      expect(Object.keys(params).sort()).toEqual(["detail", "headline", "licencePath"]);
      expect(params.licencePath).toBe("/staff/licence");
      const json = JSON.stringify(params);
      for (const word of forbidden) expect(json).not.toContain(word);
      for (const secret of secrets) expect(json).not.toContain(secret);
    }

    const sentSubjects = harness.send.mock.calls.map((call) => (call[0] as unknown as { subject: string }).subject);
    expect(sentSubjects).toHaveLength(6);
    const titles = rows.map((row) => renderNotificationText(row.type, row.params as Record<string, unknown>).title);
    expect([...sentSubjects].sort()).toEqual([...titles].sort());
    for (const title of titles) expect(title).not.toBe("Licence status update");
  });

  it("Test 6: a licence.notice event with an unknown key is retried, poisoned after the attempt limit, and notifies nobody", async () => {
    await seedAudience();
    const harness = startDrainHarness(testDb.prisma);
    const bad = await testDb.prisma.domainEvent.create({
      data: {
        id: "licence:L1:bogus",
        type: "licence.notice",
        payload: { licenceId: "L1", noticeKey: "bogus", state: "GRACE" },
        occurredAt: NOW,
      },
    });
    const missing = await testDb.prisma.domainEvent.create({
      data: { id: "licence:L1:missing", type: "licence.notice", payload: { licenceId: "L1" }, occurredAt: NOW },
    });

    for (let pass = 1; pass <= 3; pass += 1) {
      await harness.drainService.processEvents(25);
      for (const id of [bad.id, missing.id]) {
        const row = await testDb.prisma.domainEvent.findUniqueOrThrow({ where: { id } });
        expect(row.attempts).toBe(pass);
        expect(row.lastError).toBe("MalformedEventError");
        expect(row.processedAt === null).toBe(pass < 3);
      }
    }

    expect(await testDb.prisma.notification.count()).toBe(0);
    expect(await testDb.prisma.emailDispatch.count()).toBe(0);
    expect(harness.send).not.toHaveBeenCalled();
  });
});
