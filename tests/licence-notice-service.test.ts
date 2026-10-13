/**
 * Phase 14 plan 14-14: the licence notice emitter (LIC-07, D-10, D-15). A fake
 * `createMany` client stands in for Prisma; the real-Postgres proof of the
 * drain lives in `tests/licence-drain.integration.test.ts`.
 */

import { describe, expect, it, vi } from "vitest";
import {
  createLicenceNoticeService,
  prismaCreateManyClient,
} from "@/server/services/licence-notice-service";
import type { DomainEventCreateManyClient } from "@/server/services/domain-event-service";
import type { LicenceStatusSnapshot } from "@/server/licence/types";
import { formatLicenceInstant } from "@/server/licence/display";

const NOW = new Date("2026-10-02T09:00:00.000Z");
const EXPIRES = new Date("2026-09-30T22:59:59.000Z");
const GRACE_END = new Date("2026-10-14T22:59:59.000Z");

function snapshot(overrides: Partial<LicenceStatusSnapshot> = {}): LicenceStatusSnapshot {
  return {
    state: "GRACE",
    reasonCode: null,
    isRestricted: false,
    everActivated: true,
    licenceId: "L1",
    keyId: "kid-secret-1",
    schemaVersion: 1,
    clientName: "Fixture Training Academy",
    deploymentId: "fixture-deployment-0001",
    issuedAt: new Date("2026-01-01T00:00:00.000Z"),
    notBefore: new Date("2026-01-01T00:00:00.000Z"),
    expiresAt: EXPIRES,
    graceEndsAt: GRACE_END,
    timeZone: "Africa/Lagos",
    support: {
      renewalEmail: "renew@fixture.test",
      supportEmail: "support@fixture.test",
      phone: null,
      hours: null,
    },
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

type CreateManyArgs = Parameters<DomainEventCreateManyClient["domainEvent"]["createMany"]>[0];

function fakeClient(counts: number[] = []) {
  const calls: CreateManyArgs[] = [];
  const createMany = vi.fn(async (args: CreateManyArgs) => {
    calls.push(args);
    return { count: counts.shift() ?? 1 };
  });
  return { calls, createMany, client: { domainEvent: { createMany } } as DomainEventCreateManyClient };
}

describe("licenceNoticeService.emitNotices (Task 1 tracer)", () => {
  it("writes one deterministic, allow-listed licence.notice row for a grace snapshot", async () => {
    const { client, calls, createMany } = fakeClient([1]);
    const service = createLicenceNoticeService({ db: client, now: () => NOW });

    const result = await service.emitNotices({ snapshot: snapshot(), noticeKeys: ["expired"] });

    expect(createMany).toHaveBeenCalledTimes(1);
    expect(calls[0]!.skipDuplicates).toBe(true);
    expect(calls[0]!.data).toHaveLength(1);
    const row = calls[0]!.data[0]!;
    expect(row.id).toBe("licence:L1:expired");
    expect(row.type).toBe("licence.notice");
    expect(row.occurredAt).toEqual(NOW);
    expect(row.payload).toEqual({
      licenceId: "L1",
      noticeKey: "expired",
      state: "GRACE",
      expiry: formatLicenceInstant(EXPIRES, "Africa/Lagos"),
      graceEnd: formatLicenceInstant(GRACE_END, "Africa/Lagos"),
    });
    expect(result).toEqual({ created: ["licence:L1:expired"], skipped: [] });
  });

  it("lists the id as skipped when the id already existed (count 0)", async () => {
    const { client } = fakeClient([0]);
    const service = createLicenceNoticeService({ db: client, now: () => NOW });

    const result = await service.emitNotices({ snapshot: snapshot(), noticeKeys: ["expired"] });

    expect(result).toEqual({ created: [], skipped: ["licence:L1:expired"] });
  });

  it("uses the none licence id when no licence was ever activated, and the UTC-hour rollback key", async () => {
    const { client, calls } = fakeClient();
    const service = createLicenceNoticeService({ db: client, now: () => NOW });
    const never = snapshot({
      state: "UNLICENSED",
      licenceId: null,
      everActivated: false,
      expiresAt: null,
      graceEndsAt: null,
      daysToGraceEnd: null,
      daysRemaining: null,
      timeZone: null,
    });

    const result = await service.emitNotices({
      snapshot: never,
      noticeKeys: ["clock-rollback-2026-10-01T14"],
    });

    const row = calls[0]!.data[0]!;
    expect(row.id).toBe("licence:none:clock-rollback-2026-10-01T14");
    expect(row.payload).toEqual({
      licenceId: "none",
      noticeKey: "clock-rollback-2026-10-01T14",
      state: "UNLICENSED",
    });
    expect(result.created).toEqual(["licence:none:clock-rollback-2026-10-01T14"]);
  });

  it("rejects an unknown notice key before writing anything, even after a valid one", async () => {
    const { client, createMany } = fakeClient();
    const service = createLicenceNoticeService({ db: client, now: () => NOW });

    await expect(
      service.emitNotices({ snapshot: snapshot(), noticeKeys: ["expired", "not-a-key"] }),
    ).rejects.toThrow("Unknown licence notice key.");
    expect(createMany).not.toHaveBeenCalled();
  });

  it("writes nothing for an empty key list", async () => {
    const { client, createMany } = fakeClient();
    const service = createLicenceNoticeService({ db: client, now: () => NOW });

    const result = await service.emitNotices({ snapshot: snapshot(), noticeKeys: [] });

    expect(createMany).not.toHaveBeenCalled();
    expect(result).toEqual({ created: [], skipped: [] });
  });
});

describe("licenceNoticeService payload shaping (Task 2)", () => {
  it("carries the bucket as days for expiring-30 and daysToGraceEnd for grace-ending", async () => {
    const { client, calls } = fakeClient();
    const service = createLicenceNoticeService({ db: client, now: () => NOW });

    await service.emitNotices({
      snapshot: snapshot({ state: "EXPIRING_SOON", daysRemaining: 29, daysToGraceEnd: null }),
      noticeKeys: ["expiring-30"],
    });
    await service.emitNotices({ snapshot: snapshot({ daysToGraceEnd: 2 }), noticeKeys: ["grace-ending"] });

    expect(calls[0]!.data[0]!.payload).toMatchObject({ noticeKey: "expiring-30", days: "30" });
    expect(calls[1]!.data[0]!.payload).toMatchObject({ noticeKey: "grace-ending", days: "2" });
    for (const call of calls) {
      for (const value of Object.values(call.data[0]!.payload as Record<string, unknown>)) {
        expect(typeof value).toBe("string");
      }
    }
  });

  it("carries only the reason code (not the key id or client) for an invalid key", async () => {
    const { client, calls } = fakeClient();
    const service = createLicenceNoticeService({ db: client, now: () => NOW });

    await service.emitNotices({
      snapshot: snapshot({ state: "INVALID", reasonCode: "BAD_SIGNATURE" }),
      noticeKeys: ["invalid-BAD_SIGNATURE"],
    });

    const payload = calls[0]!.data[0]!.payload as Record<string, string>;
    expect(payload.reasonCode).toBe("BAD_SIGNATURE");
    expect(Object.keys(payload).sort()).toEqual(
      ["expiry", "graceEnd", "licenceId", "noticeKey", "reasonCode", "state"].sort(),
    );
    const json = JSON.stringify(payload);
    expect(json).not.toContain("kid-secret-1");
    expect(json).not.toContain("fixture-deployment-0001");
    expect(json).not.toContain("Fixture Training Academy");
    expect(json).not.toContain("fixture.test");
  });

  it("writes the same id for the same snapshot and key, and a different id for a replacement licence", async () => {
    const { client, calls } = fakeClient();
    const service = createLicenceNoticeService({ db: client, now: () => NOW });

    await service.emitNotices({ snapshot: snapshot(), noticeKeys: ["expired"] });
    await service.emitNotices({ snapshot: snapshot(), noticeKeys: ["expired"] });
    await service.emitNotices({ snapshot: snapshot({ licenceId: "L2" }), noticeKeys: ["expired"] });

    expect(calls[0]!.data[0]!.id).toBe(calls[1]!.data[0]!.id);
    expect(calls[2]!.data[0]!.id).toBe("licence:L2:expired");
    expect(calls[2]!.data[0]!.id).not.toBe(calls[0]!.data[0]!.id);
  });

  it("emits several due keys in order, one row each", async () => {
    const { client, calls } = fakeClient();
    const service = createLicenceNoticeService({ db: client, now: () => NOW });

    const result = await service.emitNotices({
      snapshot: snapshot({ daysToGraceEnd: 3 }),
      noticeKeys: ["expired", "grace-ending"],
    });

    expect(calls.map((c) => c.data[0]!.id)).toEqual(["licence:L1:expired", "licence:L1:grace-ending"]);
    expect(result.created).toEqual(["licence:L1:expired", "licence:L1:grace-ending"]);
  });
});

describe("prismaCreateManyClient", () => {
  it("passes the rows and skipDuplicates through to the Prisma delegate and returns its count", async () => {
    const createMany = vi.fn(async () => ({ count: 1 }));
    const client = prismaCreateManyClient({ domainEvent: { createMany } });

    const out = await client.domainEvent.createMany({
      data: [{ id: "licence:L1:expired", type: "licence.notice", payload: {} }],
      skipDuplicates: true,
    });

    expect(out).toEqual({ count: 1 });
    expect(createMany).toHaveBeenCalledWith({
      data: [{ id: "licence:L1:expired", type: "licence.notice", payload: {} }],
      skipDuplicates: true,
    });
  });
});
