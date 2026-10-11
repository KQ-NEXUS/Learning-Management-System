/**
 * Real-Postgres proof for the D-11 entry-point limiter (plan 15-03, NFR-04,
 * NFR-07, threats T-15-03-01, T-15-03-02, T-15-03-05).
 *
 * What only Postgres can prove: the count is consumed in ONE
 * `INSERT ... ON CONFLICT ... RETURNING` statement, so 40 genuinely
 * concurrent attempts from one device allow exactly 20 and refuse 20 (a
 * read-then-write limiter would let more through under READ COMMITTED). Each
 * refusal writes one `rate_limit.blocked` AuditEvent carrying the IP and a
 * correlation id and never the address. A known and an unknown address
 * produce identical decisions and identical rows (P4). The exact 15-minute
 * window edge is proven against the real SQL CASE.
 *
 * ENV-VAR-BEFORE-IMPORT HAZARD (mirrors tests/certificate-concurrency.integration.test.ts):
 * `rate-limit-service.ts` and `audit-service.ts` import `@/server/db`, which
 * constructs the singleton PrismaClient from `process.env.DATABASE_URL` the
 * first time it is evaluated. This file takes no static import of either;
 * `DATABASE_URL` is pointed at the throwaway container inside `beforeAll`
 * before the one dynamic import, and the service under test is bound to the
 * container's own client anyway.
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails with
 * a container-start error and every case reports BLOCKED — the expected
 * failure mode, never a silent pass or a weakened mock.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import type { RateLimitStore } from "@/server/auth/rate-limit";

let db: TestDatabase;
let mod: typeof import("@/server/services/rate-limit-service");
let audit: typeof import("@/server/services/audit-service");

beforeAll(async () => {
  db = await startTestDatabase();
  // MUST happen before the dynamic imports below — see file header.
  process.env.DATABASE_URL = db.url;
  mod = await import("@/server/services/rate-limit-service");
  audit = await import("@/server/services/audit-service");
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await db?.stop();
}, TEST_DB_TIMEOUT_MS);

beforeEach(async () => {
  await db.prisma.loginThrottle.deleteMany({});
  await db.prisma.auditEvent.deleteMany({ where: { action: "rate_limit.blocked" } });
});

function service(now?: () => Date) {
  return mod.createRateLimitService({
    store: db.prisma as unknown as RateLimitStore,
    audit: async (event) => {
      await db.prisma.auditEvent.create({ data: audit.buildAuditRow(event) });
    },
    ...(now ? { now } : {}),
  });
}

async function blockedRows() {
  return db.prisma.auditEvent.findMany({ where: { action: "rate_limit.blocked" }, orderBy: { createdAt: "asc" } });
}

describe("rate limiter — real Postgres", () => {
  it("40 concurrent forgot-password attempts from one device allow exactly 20 and refuse 20", async () => {
    const limiter = service();
    const address = "known.learner@example.test";

    const decisions = await Promise.all(
      Array.from({ length: 40 }, () => limiter.consume("forgotPassword", { ip: "203.0.113.50", email: address })),
    );

    expect(decisions.filter((d) => !d.limited)).toHaveLength(20);
    expect(decisions.filter((d) => d.limited)).toHaveLength(20);
    expect(new Set(decisions.map((d) => d.windowMinutes))).toEqual(new Set([15]));

    const row = await db.prisma.loginThrottle.findUnique({ where: { key: "forgot:ip:203.0.113.50" } });
    expect(row?.failures).toBe(40);
    expect(row?.email).toBeNull();

    const rows = await blockedRows();
    expect(rows).toHaveLength(20);
    for (const r of rows) {
      expect(r).toMatchObject({
        actorId: null,
        actorType: "SYSTEM",
        targetType: "RateLimit",
        targetId: "forgotPassword",
        outcome: "DENIED",
        ipAddress: "203.0.113.50",
      });
      expect(r.correlationId).toEqual(expect.any(String));
      expect(r.correlationId?.length).toBeGreaterThan(0);
      // No column, including before/after/reason, carries the address.
      expect(JSON.stringify(r).toLowerCase()).not.toContain(address);
      expect(JSON.stringify(r).toLowerCase()).not.toContain("example.test");
    }
  });

  it("a known and an unknown address produce identical decisions and rows (P4)", async () => {
    await db.prisma.user.create({
      data: { email: "real.account@example.test", name: "Real account", status: "ACTIVE", passwordHash: "x" },
    });
    const limiter = service();

    // No trusted IP: the per-address fallback is the strictest path that
    // touches the address, so it is the one that must not leak.
    const run = async (email: string) => {
      const out: boolean[] = [];
      for (let i = 0; i < 22; i += 1) out.push((await limiter.consume("resendVerification", { ip: null, email })).limited);
      return out;
    };
    const known = await run("real.account@example.test");
    const unknown = await run("no.account@example.test");

    expect(known).toEqual(unknown);
    expect(known.filter(Boolean)).toHaveLength(2);

    const rows = await blockedRows();
    expect(rows).toHaveLength(4);
    const shape = (r: (typeof rows)[number]) => ({
      actorId: r.actorId,
      actorType: r.actorType,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      scopeType: r.scopeType,
      scopeId: r.scopeId,
      before: r.before,
      after: r.after,
      reason: r.reason,
      outcome: r.outcome,
      ipAddress: r.ipAddress,
    });
    expect(new Set(rows.map((r) => JSON.stringify(shape(r)))).size).toBe(1);
    for (const r of rows) expect(JSON.stringify(r)).not.toMatch(/account@example\.test/);
  });

  it("an attempt exactly 15 minutes after windowStartedAt starts a new window in the real SQL", async () => {
    const now = new Date("2026-10-06T12:00:00Z");
    const limiter = service(() => now);
    await db.prisma.loginThrottle.create({
      data: {
        key: "register:ip:203.0.113.60",
        failures: 99,
        windowStartedAt: new Date(now.getTime() - 15 * 60_000),
      },
    });

    expect(await limiter.consume("register", { ip: "203.0.113.60" })).toEqual({ limited: false, windowMinutes: 15 });
    const row = await db.prisma.loginThrottle.findUnique({ where: { key: "register:ip:203.0.113.60" } });
    expect(row).toMatchObject({ failures: 1, windowStartedAt: now });
    expect(await blockedRows()).toHaveLength(0);
  });

  it("one millisecond inside the window still refuses, and a learner refusal names the learner as actor", async () => {
    const now = new Date("2026-10-06T12:00:00Z");
    const limiter = service(() => now);
    const learner = await db.prisma.user.create({
      data: { email: "ticket.learner@example.test", name: "Ticket learner", status: "ACTIVE", passwordHash: "x" },
    });
    await db.prisma.loginThrottle.create({
      data: {
        key: `ticket:user:${learner.id}`,
        failures: 5,
        windowStartedAt: new Date(now.getTime() - 15 * 60_000 + 1),
      },
    });

    expect(await limiter.consume("supportTicket", { ip: null, userId: learner.id })).toEqual({
      limited: true,
      windowMinutes: 15,
    });
    const [row] = await blockedRows();
    expect(row).toMatchObject({ actorId: learner.id, actorType: "USER", targetId: "supportTicket", ipAddress: null });
    expect(JSON.stringify(row)).not.toContain("ticket.learner@example.test");
  });

  it("the certificate check without a trusted IP records nothing", async () => {
    const limiter = service();
    for (let i = 0; i < 70; i += 1) {
      expect((await limiter.consume("certificateCheck", { ip: null })).limited).toBe(false);
    }
    expect(await db.prisma.loginThrottle.count()).toBe(0);
    expect(await blockedRows()).toHaveLength(0);
  });
});
