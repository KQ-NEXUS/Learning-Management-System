/**
 * Real-Postgres proof of the guarantees that cannot be trusted to a JS fake
 * (D-05, D-06, COM-02): the `(template, correlationId)` unique constraint
 * actually enforcing exactly-once dispatch under a real unique-violation
 * error, `FOR UPDATE SKIP LOCKED` actually preventing two overlapping
 * `sendQueued` runs from claiming the same row, and the resend requeue plus
 * its audit write actually sharing one transaction (a failing audit insert
 * really rolls back the requeue at the database level, not just in a fake's
 * simulated rollback).
 *
 * PREREQUISITE: Docker must be running (tests/support/pg.ts starts a
 * throwaway postgres:16-alpine container).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import {
  createEmailDispatchService,
  createPrismaEmailDispatchStore,
  buildAuthCorrelationId,
} from "@/server/services/email-dispatch-service";

let database: TestDatabase;

beforeAll(async () => {
  database = await startTestDatabase();
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await database?.stop();
}, TEST_DB_TIMEOUT_MS);

afterEach(async () => {
  await database.prisma.auditEvent.deleteMany({ where: { action: "email.resent" } });
  await database.prisma.emailDispatch.deleteMany();
  await database.prisma.user.deleteMany({ where: { email: { contains: "@dispatch-integration.test" } } });
});

/** A fresh service instance bound to the real, transactional prisma-backed
 * store — `send` and `render` are simple in-memory spies, never the real
 * Brevo client or template registry, so this proves the store's own
 * guarantees without touching any external provider. */
function service(options: { sendOk?: boolean } = {}) {
  const sendOk = options.sendOk ?? true;
  const sendCalls: { to: string }[] = [];
  const store = createPrismaEmailDispatchStore(database.prisma);
  const svc = createEmailDispatchService({
    store,
    send: async (params) => {
      sendCalls.push({ to: params.to });
      if (!sendOk) throw new Error("simulated provider failure");
      return { providerMessageId: `msg-${sendCalls.length}` };
    },
    describeFailure: () => "described failure",
    classifyFailure: () => "transient",
    render: (template, params) => ({
      subject: `Subject ${String(template)}`,
      html: `<p>${JSON.stringify(params)}</p>`,
      text: `text ${JSON.stringify(params)}`,
    }),
  });
  return { svc, sendCalls, store };
}

describe("dispatch — stable-key deduplication against real Postgres (D-05, COM-02)", () => {
  it("two dispatch calls under the same (template, correlationId) leave exactly one row and one send call", async () => {
    const { svc, sendCalls } = service();
    const correlationId = buildAuthCorrelationId("raw-token-value-never-stored-anywhere");

    const first = await svc.dispatch({
      template: "email-verification",
      toEmail: "learner@dispatch-integration.test",
      subject: "Verify your account",
      textContent: "text",
      htmlContent: "<p>html</p>",
      correlationId,
    });
    const second = await svc.dispatch({
      template: "email-verification",
      toEmail: "learner@dispatch-integration.test",
      subject: "Verify your account",
      textContent: "text",
      htmlContent: "<p>html</p>",
      correlationId,
    });

    const rows = await database.prisma.emailDispatch.findMany({ where: { correlationId } });
    expect(rows).toHaveLength(1);
    expect(sendCalls).toHaveLength(1);
    expect(second.id).toBe(first.id);
    expect(second.status).toBe("SENT");
  });

  it("the persisted row's JSON (every column) never contains the raw token that produced its correlationId", async () => {
    const rawToken = "super-secret-raw-token-do-not-store-9f8e7d21";
    const correlationId = buildAuthCorrelationId(rawToken);
    const { svc } = service();

    await svc.dispatch({
      template: "password-reset",
      toEmail: "learner2@dispatch-integration.test",
      subject: "Reset your password",
      textContent: `Reset here: https://example.com/reset-password?token=${rawToken}`,
      htmlContent: "<p>Reset here</p>",
      correlationId,
    });

    const row = await database.prisma.emailDispatch.findFirstOrThrow({ where: { correlationId } });
    expect(JSON.stringify(row)).not.toContain(rawToken);
    expect(correlationId).not.toContain(rawToken);
  });
});

describe("sendQueued — overlapping runs never double-send (real FOR UPDATE SKIP LOCKED, D-02)", () => {
  it("two concurrent sendQueued calls over 5 due rows produce exactly 5 provider sends in total, one per row", async () => {
    const { svc, sendCalls } = service();
    const unique = Date.now();
    const created = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        database.prisma.emailDispatch.create({
          data: {
            template: "enrolment-confirmed",
            toEmail: `learner-${i}@dispatch-integration.test`,
            correlationId: `concurrency-${unique}-${i}`,
            status: "QUEUED",
            templateParams: { foo: "bar" },
          },
        }),
      ),
    );

    const [a, b] = await Promise.all([svc.sendQueued({ limit: 10 }), svc.sendQueued({ limit: 10 })]);

    expect(sendCalls).toHaveLength(5);
    expect(a.sent + b.sent).toBe(5);

    const finalRows = await database.prisma.emailDispatch.findMany({
      where: { id: { in: created.map((r) => r.id) } },
    });
    expect(finalRows).toHaveLength(5);
    expect(finalRows.every((r) => r.status === "SENT")).toBe(true);
    expect(finalRows.every((r) => r.attempts === 1)).toBe(true);
  });
});

describe("resend — audit atomicity against real Postgres (D-06, T-13-08)", () => {
  it("a failing audit write (foreign-key violation on a bogus actorId) rolls back the requeue entirely", async () => {
    const activeUser = await database.prisma.user.create({
      data: { email: "resend-eligible@dispatch-integration.test", name: "Eligible Learner", status: "ACTIVE" },
    });
    const row = await database.prisma.emailDispatch.create({
      data: {
        template: "enrolment-confirmed",
        toEmail: activeUser.email,
        userId: activeUser.id,
        correlationId: `resend-atomicity-${Date.now()}`,
        status: "FAILED",
        templateParams: { foo: "bar" },
      },
    });

    const { svc } = service();
    await expect(
      svc.resend({ dispatchId: row.id, actorId: "nonexistent-actor-id-fk-violation", reason: "atomicity check" }),
    ).rejects.toThrow();

    const reloaded = await database.prisma.emailDispatch.findUniqueOrThrow({ where: { id: row.id } });
    // The CAS status update and the audit insert are one transaction: the
    // audit's foreign-key violation rolls the status change back too.
    expect(reloaded.status).toBe("FAILED");
    expect(reloaded.resentCount).toBe(0);

    const audits = await database.prisma.auditEvent.findMany({ where: { targetId: row.id, action: "email.resent" } });
    expect(audits).toHaveLength(0);
  });

  it("resend of an eligible SENT row sets QUEUED with resentCount 1, and writes exactly one email.resent audit row with the actor and reason", async () => {
    const activeUser = await database.prisma.user.create({
      data: { email: "resend-happy@dispatch-integration.test", name: "Happy Learner", status: "ACTIVE" },
    });
    const row = await database.prisma.emailDispatch.create({
      data: {
        template: "enrolment-confirmed",
        toEmail: activeUser.email,
        userId: activeUser.id,
        correlationId: `resend-happy-${Date.now()}`,
        status: "SENT",
        templateParams: { foo: "bar" },
      },
    });

    const { svc } = service();
    const result = await svc.resend({
      dispatchId: row.id,
      actorId: activeUser.id,
      reason: "customer requested a copy",
    });

    expect(result.status).toBe("QUEUED");
    expect(result.resentCount).toBe(1);
    expect(result.attempts).toBe(0);

    const audits = await database.prisma.auditEvent.findMany({ where: { targetId: row.id, action: "email.resent" } });
    expect(audits).toHaveLength(1);
    expect(audits[0].actorId).toBe(activeUser.id);
    expect(audits[0].reason).toBe("customer requested a copy");
  });
});
