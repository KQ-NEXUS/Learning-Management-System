/**
 * Real-Postgres proof of the delivery log's one write path (D-06, T-13-08):
 * resending a FAILED row actually requeues the SAME row (compare-and-set) and
 * actually writes one `email.resent` audit entry in the same transaction as
 * the requeue — neither guarantee is trustworthy from a JS fake, since both
 * are enforced inside `email-dispatch-service.ts`'s real Prisma transaction.
 * This file only adds the permission gate and the reason minimum on top of
 * that proven mechanism; the mechanism itself is proven in
 * `tests/email-dispatch.integration.test.ts`.
 *
 * PREREQUISITE: Docker must be running (tests/support/pg.ts starts a
 * throwaway postgres:16-alpine container).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { createWithPermission, type RawGrant } from "@/server/permissions/with-permission";
import {
  createEmailDeliveryLogService,
  type EmailDeliveryLogStore,
} from "@/server/services/email-delivery-log-service";
import {
  createEmailDispatchService,
  createPrismaEmailDispatchStore,
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
  await database.prisma.user.deleteMany({ where: { email: { contains: "@email-log-integration.test" } } });
});

const grant = (permission: string): RawGrant => ({
  permission: permission as RawGrant["permission"],
  scopeType: "GLOBAL",
  scopeId: null,
  active: true,
  revokedAt: null,
  startsAt: null,
  endsAt: null,
});

/** A fresh log service bound to the real, transactional prisma-backed
 * dispatch store — `send`/`render` are simple in-memory stubs, never the
 * real Brevo client, so this proves the store's own guarantees without
 * touching any external provider. */
function buildService(options: { actorId: string; grants: RawGrant[]; sendOk?: boolean }) {
  const sendOk = options.sendOk ?? true;
  const sendCalls: { to: string }[] = [];
  const dispatchService = createEmailDispatchService({
    store: createPrismaEmailDispatchStore(database.prisma),
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

  const withPermission = createWithPermission({
    getActor: async () => ({ userId: options.actorId }),
    loadGrants: async () => options.grants,
    audit: async () => {},
  });

  const service = createEmailDeliveryLogService({
    store: database.prisma as unknown as EmailDeliveryLogStore,
    withPermission,
    resendDispatch: (params) => dispatchService.resend(params),
  });

  return { service, dispatchService, sendCalls };
}

describe("email delivery log — real Postgres (D-06, T-13-08)", () => {
  it("resending a FAILED row with stored params and an ACTIVE recipient leaves it QUEUED with resentCount 1, attempts 0 and exactly one audit row; a subsequent sendQueued sets it SENT", async () => {
    const activeUser = await database.prisma.user.create({
      data: { email: "resend-eligible@email-log-integration.test", name: "Eligible Learner", status: "ACTIVE" },
    });
    const actor = await database.prisma.user.create({
      data: { email: "admin-actor@email-log-integration.test", name: "Admin Actor", status: "ACTIVE" },
    });
    const row = await database.prisma.emailDispatch.create({
      data: {
        template: "enrolment-confirmed",
        toEmail: activeUser.email,
        userId: activeUser.id,
        correlationId: `email-log-resend-${Date.now()}`,
        status: "FAILED",
        templateParams: { foo: "bar" },
      },
    });

    const { service, dispatchService, sendCalls } = buildService({
      actorId: actor.id,
      grants: [grant("audit.view"), grant("users.manage")],
    });

    await service.resendDispatch({ dispatchId: row.id, reason: "customer requested a retry" });

    const reloaded = await database.prisma.emailDispatch.findUniqueOrThrow({ where: { id: row.id } });
    expect(reloaded.status).toBe("QUEUED");
    expect(reloaded.resentCount).toBe(1);
    expect(reloaded.attempts).toBe(0);

    const audits = await database.prisma.auditEvent.findMany({
      where: { targetId: row.id, action: "email.resent" },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].actorId).toBe(actor.id);
    expect(audits[0].reason).toBe("customer requested a retry");

    const result = await dispatchService.sendQueued({ limit: 10 });
    expect(result.sent).toBe(1);
    expect(sendCalls).toHaveLength(1);

    const finalRow = await database.prisma.emailDispatch.findUniqueOrThrow({ where: { id: row.id } });
    expect(finalRow.status).toBe("SENT");
  });

  it("a 9-character reason is rejected and changes nothing; a 10-character reason then succeeds", async () => {
    const activeUser = await database.prisma.user.create({
      data: { email: "reason-min@email-log-integration.test", name: "Reason Learner", status: "ACTIVE" },
    });
    const actor = await database.prisma.user.create({
      data: { email: "admin-actor-2@email-log-integration.test", name: "Admin Actor 2", status: "ACTIVE" },
    });
    const row = await database.prisma.emailDispatch.create({
      data: {
        template: "enrolment-confirmed",
        toEmail: activeUser.email,
        userId: activeUser.id,
        correlationId: `email-log-reason-${Date.now()}`,
        status: "FAILED",
        templateParams: { foo: "bar" },
      },
    });

    const { service } = buildService({
      actorId: actor.id,
      grants: [grant("audit.view"), grant("users.manage")],
    });

    await expect(service.resendDispatch({ dispatchId: row.id, reason: "123456789" })).rejects.toThrow();
    const untouched = await database.prisma.emailDispatch.findUniqueOrThrow({ where: { id: row.id } });
    expect(untouched.status).toBe("FAILED");
    expect(untouched.resentCount).toBe(0);

    await service.resendDispatch({ dispatchId: row.id, reason: "1234567890" });
    const changed = await database.prisma.emailDispatch.findUniqueOrThrow({ where: { id: row.id } });
    expect(changed.status).toBe("QUEUED");
    expect(changed.resentCount).toBe(1);
  });

  it("listDispatches rows contain no templateParams and canResend matches eligibility; a caller without audit.view is refused", async () => {
    const activeUser = await database.prisma.user.create({
      data: { email: "list-user@email-log-integration.test", name: "List Learner", status: "ACTIVE" },
    });
    await database.prisma.emailDispatch.create({
      data: {
        template: "password-reset",
        toEmail: activeUser.email,
        userId: activeUser.id,
        correlationId: `email-log-list-auth-${Date.now()}`,
        status: "FAILED",
        // templateParams omitted (defaults to null) — a plain `null` literal
        // does not satisfy Prisma's generated Json-nullable input type.
      },
    });
    await database.prisma.emailDispatch.create({
      data: {
        template: "ticket-created",
        toEmail: activeUser.email,
        userId: activeUser.id,
        correlationId: `email-log-list-eligible-${Date.now()}`,
        status: "FAILED",
        templateParams: { foo: "bar" },
      },
    });

    const { service } = buildService({
      actorId: activeUser.id,
      grants: [grant("audit.view"), grant("users.manage")],
    });
    const rows = await service.listDispatches();

    expect(rows.every((row) => !("templateParams" in row))).toBe(true);
    const authRow = rows.find((row) => row.template === "password-reset");
    const eligibleRow = rows.find((row) => row.template === "ticket-created");
    expect(authRow?.canResend).toBe(false);
    expect(eligibleRow?.canResend).toBe(true);

    const { service: deniedService } = buildService({ actorId: activeUser.id, grants: [] });
    await expect(deniedService.listDispatches()).rejects.toThrow();
  });

  it("refuses resendDispatch for a caller with audit.view but without users.manage, and changes nothing", async () => {
    const activeUser = await database.prisma.user.create({
      data: { email: "no-manage@email-log-integration.test", name: "No Manage", status: "ACTIVE" },
    });
    const row = await database.prisma.emailDispatch.create({
      data: {
        template: "enrolment-confirmed",
        toEmail: activeUser.email,
        userId: activeUser.id,
        correlationId: `email-log-no-manage-${Date.now()}`,
        status: "FAILED",
        templateParams: { foo: "bar" },
      },
    });

    const { service } = buildService({ actorId: activeUser.id, grants: [grant("audit.view")] });
    await expect(
      service.resendDispatch({ dispatchId: row.id, reason: "a valid reason here" }),
    ).rejects.toThrow();

    const untouched = await database.prisma.emailDispatch.findUniqueOrThrow({ where: { id: row.id } });
    expect(untouched.status).toBe("FAILED");
    expect(untouched.resentCount).toBe(0);
  });
});
