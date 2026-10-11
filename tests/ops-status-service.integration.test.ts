/**
 * Real-Postgres proof for the staff Operations status service (plan 15-13;
 * D-18, NFR-07, NFR-13).
 *
 * Proves, against stored rows in a disposable database:
 *   - the email failures section lists FAILED and stale SENDING dispatches with
 *     "{n} of {max}" attempts and carries no recipient address and no provider
 *     error text (P5);
 *   - job health follows the staleness rule: waiting exactly the threshold is
 *     on time and one minute more is Behind, for event processing and for the
 *     other work-queue jobs, and a job with no stored signal is Not tracked;
 *   - failed and stuck work, payment exceptions and the integrity checks are
 *     listed from stored rows, ten at a time, with an exact total (10 versus
 *     11 rows), and unknown order exception codes read "Payment needs review";
 *   - a failing section is isolated and the others still load;
 *   - the whole serialised result contains no seeded address, learner name,
 *     amount, webhook payload text or provider error text;
 *   - the service refuses a caller without `audit.view`.
 *
 * SAFETY: the only database here is a disposable Testcontainers instance from
 * `startTestDatabase()`. Nothing reads `.env` or reaches a shared database.
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails with a
 * container-start error, which is the expected failure mode, not a code bug.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { seedCohortFixture, seedEnrolmentFixture, seedLearnerFixture } from "./support/cohort-fixtures";
import { createWithPermission, type RawGrant } from "@/server/permissions/with-permission";
import { AuthorizationError } from "@/server/permissions";
import {
  createOpsStatusService,
  JOB_STALENESS,
  type OpsClient,
  type OpsJobId,
  type OpsStatus,
} from "@/server/services/ops-status-service";
import { summariseOpsStatus } from "@/server/services/ops-status-types";
import { createIntegrityCheckService } from "@/server/services/integrity-check-service";
import { STALE_SENDING_MS } from "@/server/communications/contracts";

let database: TestDatabase;
let counter = 0;
const uniq = (prefix: string) => `${prefix}-${++counter}`;

beforeAll(async () => {
  database = await startTestDatabase();
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await database?.stop();
}, TEST_DB_TIMEOUT_MS);

afterEach(async () => {
  // One statement so foreign keys never order the cleanup; users and cohorts stay.
  await database.prisma.$executeRawUnsafe(
    `TRUNCATE "DomainEvent", "ExportJob", "EmailDispatch", "WebhookEvent", "Refund", "ReconciliationCase",
       "PaymentAttempt", "Order", "Ticket", "LessonResource", "Enrolment", "LicenceState" RESTART IDENTITY CASCADE`,
  );
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = new Date("2026-10-08T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const grant = (permission: string): RawGrant => ({
  permission: permission as RawGrant["permission"],
  scopeType: "GLOBAL",
  scopeId: null,
  active: true,
  revokedAt: null,
  startsAt: null,
  endsAt: null,
});

/** The real service over the real database, with a test permission layer. */
function buildService(options: { grants?: RawGrant[]; client?: OpsClient; realIntegrity?: boolean } = {}) {
  const withPermission = createWithPermission({
    getActor: async () => ({ userId: "ops-test-actor" }),
    loadGrants: async () => options.grants ?? [grant("audit.view")],
    audit: async () => {},
  });
  const logged: string[] = [];
  const client = options.client ?? (database.prisma as unknown as OpsClient);
  const service = createOpsStatusService({
    client,
    withPermission,
    // The seven real checks are slow on a container; only the tests about them run them.
    integrity: options.realIntegrity
      ? createIntegrityCheckService({ client: database.prisma })
      : { runIntegrityChecks: async () => [] },
    now: () => NOW,
    log: (message) => logged.push(message),
  });
  return { service, logged };
}

async function status(options: { realIntegrity?: boolean } = {}): Promise<OpsStatus> {
  return buildService(options).service.getOperationsStatus();
}

function job(result: OpsStatus, id: OpsJobId) {
  if (result.jobs.state !== "ok") throw new Error("jobs section did not load");
  const found = result.jobs.jobs.find((row) => row.id === id);
  if (!found) throw new Error(`job ${id} missing`);
  return found;
}

async function seedUserAndOrder(extra: { status?: string; amountMinor?: number } = {}) {
  const { cohortId } = await seedCohortFixture(database.prisma, { capacity: 50 });
  const { userId } = await seedLearnerFixture(database.prisma, { name: "Zainab Learner-Privacy" });
  const order = await database.prisma.order.create({
    data: {
      reference: uniq("ORD-OPS"),
      userId,
      cohortId,
      amountMinor: extra.amountMinor ?? 987_654_321,
      currency: "NGN",
      status: (extra.status ?? "PENDING") as never,
      idempotencyKey: uniq("ops-order-key"),
    },
    select: { id: true, reference: true },
  });
  return { cohortId, userId, orderId: order.id, reference: order.reference };
}

async function seedExport(
  requestedById: string,
  data: { status: string; dataset?: string; createdAt?: Date; startedAt?: Date | null; completedAt?: Date | null; expiresAt?: Date | null; storageKey?: string | null; retryOfId?: string | null },
) {
  return database.prisma.exportJob.create({
    data: {
      requestedById,
      dataset: data.dataset ?? "payments",
      status: data.status as never,
      createdAt: data.createdAt,
      startedAt: data.startedAt ?? null,
      completedAt: data.completedAt ?? null,
      expiresAt: data.expiresAt ?? null,
      storageKey: data.storageKey ?? null,
      retryOfId: data.retryOfId ?? null,
    },
    select: { id: true },
  });
}

// ---------------------------------------------------------------------------
// Email failures (the tracer slice, NFR-13)
// ---------------------------------------------------------------------------

describe("Operations status: email failures", () => {
  it("lists failed and stale sending dispatches without any address or provider error text", async () => {
    const secretError = "550 mailbox unavailable for private.person (provider-detail-xyz)";
    await database.prisma.emailDispatch.create({
      data: {
        template: "enrolment-confirmed",
        toEmail: "private.person@ops-status-privacy.test",
        correlationId: "ops-email-failed-1",
        status: "FAILED",
        attempts: 5,
        lastAttemptAt: ago(30 * MINUTE),
        failedAt: ago(30 * MINUTE),
        error: secretError,
      },
    });
    await database.prisma.emailDispatch.create({
      data: {
        template: "staff-ticket-assigned",
        toEmail: "second.person@ops-status-privacy.test",
        correlationId: "ops-email-failed-2",
        status: "FAILED",
        attempts: 2,
        lastAttemptAt: ago(20 * MINUTE),
        error: secretError,
      },
    });
    await database.prisma.emailDispatch.create({
      data: {
        template: "password-reset",
        toEmail: "third.person@ops-status-privacy.test",
        correlationId: "ops-email-stuck-1",
        status: "SENDING",
        attempts: 1,
        lastAttemptAt: ago(STALE_SENDING_MS + MINUTE),
      },
    });
    // Not failures: a recent SENDING row and a SENT row.
    await database.prisma.emailDispatch.create({
      data: {
        template: "password-reset",
        toEmail: "fourth.person@ops-status-privacy.test",
        correlationId: "ops-email-sending-recent",
        status: "SENDING",
        attempts: 1,
        lastAttemptAt: ago(MINUTE),
      },
    });
    await database.prisma.emailDispatch.create({
      data: {
        template: "password-reset",
        toEmail: "fifth.person@ops-status-privacy.test",
        correlationId: "ops-email-sent",
        status: "SENT",
        attempts: 1,
        sentAt: NOW,
      },
    });

    const result = await status();

    expect(result.emailFailures.state).toBe("ok");
    if (result.emailFailures.state !== "ok") return;
    expect(result.emailFailures.total).toBe(3);
    expect(result.emailFailures.rows).toHaveLength(3);
    // Newest attempt first.
    expect(result.emailFailures.rows.map((r) => r.templateLabel)).toEqual([
      "Password reset",
      "Staff ticket assigned",
      "Enrolment confirmed",
    ]);
    const stuck = result.emailFailures.rows.filter((r) => r.stuckSending);
    expect(stuck).toHaveLength(1);
    expect(stuck[0].templateLabel).toBe("Password reset");
    // NFR-13: attempts shown against the maximum.
    expect(result.emailFailures.rows.find((r) => r.templateLabel === "Staff ticket assigned")).toMatchObject({
      attempts: 2,
      maxAttempts: 5,
    });
    expect(result.emailFailures.rows.every((r) => r.reference.length === 8)).toBe(true);

    const serialised = JSON.stringify(result.emailFailures);
    expect(serialised).not.toContain("ops-status-privacy.test");
    expect(serialised).not.toContain("private.person");
    expect(serialised).not.toContain("provider-detail-xyz");
    expect(serialised).not.toContain("550 mailbox");
  });

  it("shows ten rows with an exact total of 10, and ten rows with a total of 11 for eleven failures", async () => {
    const seed = async (n: number) => {
      for (let i = 0; i < n; i += 1) {
        await database.prisma.emailDispatch.create({
          data: {
            template: "enrolment-confirmed",
            toEmail: `person${i}@ops-status-privacy.test`,
            correlationId: uniq("ops-email-many"),
            status: "FAILED",
            attempts: 5,
            lastAttemptAt: ago((i + 1) * MINUTE),
          },
        });
      }
    };
    await seed(10);
    const ten = (await status()).emailFailures;
    expect(ten.state === "ok" && ten.rows.length).toBe(10);
    expect(ten.state === "ok" && ten.total).toBe(10);

    await seed(1);
    const eleven = (await status()).emailFailures;
    expect(eleven.state === "ok" && eleven.rows.length).toBe(10);
    expect(eleven.state === "ok" && eleven.total).toBe(11);
  });

  it("refuses a caller without audit.view", async () => {
    const { service } = buildService({ grants: [grant("users.view")] });
    await expect(service.getOperationsStatus()).rejects.toBeInstanceOf(AuthorizationError);
  });
});

// ---------------------------------------------------------------------------
// Scheduled jobs and the staleness boundary (NFR-07)
// ---------------------------------------------------------------------------

describe("Operations status: job health", () => {
  it("defines ten jobs and the threshold rule: three intervals with a 5-minute minimum", () => {
    expect(Object.keys(JOB_STALENESS)).toHaveLength(10);
    expect(JOB_STALENESS["drain-domain-events"].thresholdMs).toBe(5 * MINUTE);
    expect(JOB_STALENESS["dispatch-export-jobs"].thresholdMs).toBe(5 * MINUTE);
    expect(JOB_STALENESS["release-expired-holds"].thresholdMs).toBe(15 * MINUTE);
    expect(JOB_STALENESS["expire-export-jobs"].thresholdMs).toBe(45 * MINUTE);
    expect(JOB_STALENESS["reconcile-payments"].thresholdMs).toBe(45 * MINUTE);
    expect(JOB_STALENESS["cleanup-stale-uploads"].thresholdMs).toBe(3 * HOUR);
    expect(JOB_STALENESS["close-resolved-tickets"].thresholdMs).toBe(3 * HOUR);
    expect(JOB_STALENESS["check-licence"].thresholdMs).toBe(3 * HOUR);
    expect(JOB_STALENESS["cleanup-notifications"].thresholdMs).toBeNull();
  });

  it("reads an empty database as nothing waiting, with unrecorded jobs Not tracked, and all clear overall", async () => {
    const result = await status({ realIntegrity: true });
    expect(job(result, "drain-domain-events").status).toBe("idle");
    expect(job(result, "dispatch-export-jobs").status).toBe("idle");
    expect(job(result, "release-expired-holds").status).toBe("idle");
    expect(job(result, "cleanup-notifications").status).toBe("untracked");
    // No licence record has ever been verified here, so there is no stored signal.
    expect(job(result, "check-licence").status).toBe("untracked");
    const summary = summariseOpsStatus(result);
    expect(summary).toMatchObject({ failedJobs: 0, paymentExceptions: 0, emailFailures: 0, needsAttention: false });
    expect(result.integrity.state === "ok" && result.integrity.checks).toHaveLength(7);
  });

  it("event processing: waiting exactly 5 minutes is Running normally, one minute longer is Behind", async () => {
    const event = await database.prisma.domainEvent.create({
      data: { type: "ticket.created", payload: {}, occurredAt: ago(5 * MINUTE) },
      select: { id: true },
    });
    const onTime = job(await status(), "drain-domain-events");
    expect(onTime.status).toBe("running");
    expect(onTime.detail.text).toBe("Oldest waiting event: 5 minutes");

    await database.prisma.domainEvent.update({ where: { id: event.id }, data: { occurredAt: ago(6 * MINUTE) } });
    const late = job(await status(), "drain-domain-events");
    expect(late.status).toBe("behind");
    expect(late.detail.text).toBe("Oldest waiting event: 6 minutes");
    expect(summariseOpsStatus(await status()).needsAttention).toBe(true);
  });

  it("event processing: a poisoned event makes the job Failing and is listed as stopped after 3 of 3 attempts", async () => {
    await database.prisma.domainEvent.create({
      data: {
        type: "order.exception",
        payload: { orderId: "x", secret: "event-payload-text" },
        occurredAt: ago(HOUR),
        processedAt: ago(50 * MINUTE),
        attempts: 3,
        lastError: "mapper exploded: provider-detail-xyz",
      },
    });
    const result = await status();
    expect(job(result, "drain-domain-events").status).toBe("failing");
    expect(result.failedWork.state).toBe("ok");
    if (result.failedWork.state !== "ok") return;
    expect(result.failedWork.total).toBe(1);
    expect(result.failedWork.rows[0]).toMatchObject({
      kind: "event_stopped",
      label: "Order exception",
      attempts: 3,
      maxAttempts: 3,
    });
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("event-payload-text");
    expect(serialised).not.toContain("provider-detail-xyz");
  });

  it("event processing: an event with attempts above zero and no processedAt shows as retrying", async () => {
    await database.prisma.domainEvent.create({
      data: { type: "ticket.created", payload: {}, occurredAt: ago(2 * MINUTE), attempts: 1 },
    });
    const result = await status();
    expect(result.failedWork.state === "ok" && result.failedWork.rows[0]).toMatchObject({
      kind: "event_retrying",
      attempts: 1,
      maxAttempts: 3,
    });
    expect(job(result, "drain-domain-events").status).toBe("running");
  });

  it("export dispatch, processing and expiry follow the same boundary", async () => {
    const { userId } = await seedLearnerFixture(database.prisma);

    // Dispatch: queued exactly 5 minutes is on time, 6 minutes is Behind.
    const queued = await seedExport(userId, { status: "QUEUED", createdAt: ago(5 * MINUTE) });
    expect(job(await status(), "dispatch-export-jobs").status).toBe("running");
    await database.prisma.exportJob.update({ where: { id: queued.id }, data: { createdAt: ago(6 * MINUTE) } });
    const behindDispatch = await status();
    expect(job(behindDispatch, "dispatch-export-jobs").status).toBe("behind");
    expect(behindDispatch.failedWork.state === "ok" && behindDispatch.failedWork.rows[0]).toMatchObject({
      kind: "export_waiting",
    });
    await database.prisma.exportJob.delete({ where: { id: queued.id } });

    // Processing: 20 minutes is on time, 21 is Behind.
    const processing = await seedExport(userId, { status: "PROCESSING", startedAt: ago(20 * MINUTE) });
    expect(job(await status(), "process-export-jobs").status).toBe("running");
    await database.prisma.exportJob.update({ where: { id: processing.id }, data: { startedAt: ago(21 * MINUTE) } });
    expect(job(await status(), "process-export-jobs").status).toBe("behind");
    await database.prisma.exportJob.delete({ where: { id: processing.id } });

    // Expiry: a ready export 45 minutes past its expiry is on time, 46 is Behind.
    const ready = await seedExport(userId, {
      status: "SUCCEEDED",
      storageKey: "exports/opaque",
      expiresAt: ago(45 * MINUTE),
      completedAt: ago(DAY),
    });
    expect(job(await status(), "expire-export-jobs").status).toBe("running");
    await database.prisma.exportJob.update({ where: { id: ready.id }, data: { expiresAt: ago(46 * MINUTE) } });
    expect(job(await status(), "expire-export-jobs").status).toBe("behind");
  });

  it("payment reconciliation, seat holds, abandoned uploads, tickets and the licence check follow the boundary", async () => {
    // Reconciliation: successful, unreconciled Paystack payment waiting 45 minutes vs 46.
    const { orderId, cohortId, userId } = await seedUserAndOrder({ status: "PAID" });
    const attempt = await database.prisma.paymentAttempt.create({
      data: {
        orderId,
        provider: "PAYSTACK",
        amountMinor: 1000,
        currency: "NGN",
        status: "SUCCEEDED",
        idempotencyKey: uniq("ops-attempt"),
        confirmedAt: ago(45 * MINUTE),
      },
      select: { id: true },
    });
    expect(job(await status(), "reconcile-payments").status).toBe("running");
    await database.prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { confirmedAt: ago(46 * MINUTE) } });
    expect(job(await status(), "reconcile-payments").status).toBe("behind");

    // Seat holds: an expired hold waiting 15 minutes vs 16.
    const enrolment = await seedEnrolmentFixture(database.prisma, {
      cohortId,
      status: "PENDING_PAYMENT",
      holdExpiresAt: ago(15 * MINUTE),
    });
    expect(job(await status(), "release-expired-holds").status).toBe("running");
    await database.prisma.enrolment.update({ where: { id: enrolment.enrolmentId }, data: { holdExpiresAt: ago(16 * MINUTE) } });
    expect(job(await status(), "release-expired-holds").status).toBe("behind");

    // Abandoned uploads: due after 24 hours, so 27 hours old waited exactly 3 hours.
    const course = await database.prisma.course.create({ data: { slug: uniq("ops-course"), title: "Ops Course" } });
    const moduleRow = await database.prisma.module.create({ data: { courseId: course.id, title: "M", position: 0 } });
    const lesson = await database.prisma.lesson.create({ data: { moduleId: moduleRow.id, title: "L", type: "FILE", position: 0 } });
    const upload = await database.prisma.lessonResource.create({
      data: {
        lessonId: lesson.id,
        title: "Handout",
        storageKey: "lesson-uploads/ops/opaque",
        filename: "h.pdf",
        mimeType: "application/pdf",
        sizeBytes: BigInt(10),
        uploadStatus: "UPLOADING",
        createdAt: ago(DAY + 3 * HOUR),
      },
      select: { id: true },
    });
    expect(job(await status(), "cleanup-stale-uploads").status).toBe("running");
    await database.prisma.lessonResource.update({ where: { id: upload.id }, data: { createdAt: ago(DAY + 3 * HOUR + MINUTE) } });
    expect(job(await status(), "cleanup-stale-uploads").status).toBe("behind");

    // Tickets: a resolved ticket is due for closing after 7 days.
    const ticket = await database.prisma.ticket.create({
      data: {
        reference: uniq("TKT-OPS"),
        userId,
        category: "OTHER",
        subject: "Ops",
        status: "RESOLVED",
        resolvedAt: ago(7 * DAY + 3 * HOUR),
      },
      select: { id: true },
    });
    expect(job(await status(), "close-resolved-tickets").status).toBe("running");
    await database.prisma.ticket.update({ where: { id: ticket.id }, data: { resolvedAt: ago(7 * DAY + 3 * HOUR + MINUTE) } });
    expect(job(await status(), "close-resolved-tickets").status).toBe("behind");

    // Licence check: last verified 3 hours ago vs 3 hours 1 minute.
    await database.prisma.licenceState.create({ data: { id: "current", lastVerifiedAt: ago(3 * HOUR) } });
    const onTimeLicence = job(await status(), "check-licence");
    expect(onTimeLicence.status).toBe("running");
    expect(onTimeLicence.detail.at?.toISOString()).toBe(ago(3 * HOUR).toISOString());
    await database.prisma.licenceState.update({ where: { id: "current" }, data: { lastVerifiedAt: ago(3 * HOUR + MINUTE) } });
    expect(job(await status(), "check-licence").status).toBe("behind");
  });
});

// ---------------------------------------------------------------------------
// Failed and stuck work (NFR-13)
// ---------------------------------------------------------------------------

describe("Operations status: failed and stuck work", () => {
  it("lists failed exports with the dataset label, skips a failed export that was retried, and shows 10 of 11", async () => {
    const { userId } = await seedLearnerFixture(database.prisma);
    const failedIds: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const row = await seedExport(userId, { status: "FAILED", dataset: "reconciliation-refunds", completedAt: ago((i + 1) * MINUTE) });
      failedIds.push(row.id);
    }
    const ten = (await status()).failedWork;
    expect(ten.state === "ok" && ten.total).toBe(10);
    expect(ten.state === "ok" && ten.rows).toHaveLength(10);
    expect(ten.state === "ok" && ten.rows[0]).toMatchObject({ kind: "export_failed", label: "Reconciliation refunds" });

    await seedExport(userId, { status: "FAILED", dataset: "audit", completedAt: ago(MINUTE / 2) });
    const eleven = (await status()).failedWork;
    expect(eleven.state === "ok" && eleven.total).toBe(11);
    expect(eleven.state === "ok" && eleven.rows).toHaveLength(10);
    // Newest first: the audit export failed most recently.
    expect(eleven.state === "ok" && eleven.rows[0].label).toBe("Audit");

    // A retry closes the failed export it retried (the failed row stays for the record).
    await seedExport(userId, { status: "QUEUED", createdAt: ago(MINUTE), retryOfId: failedIds[0] });
    const afterRetry = (await status()).failedWork;
    expect(afterRetry.state === "ok" && afterRetry.total).toBe(10);
  });

  it("wraps long unknown dataset codes into a plain label rather than the raw code", async () => {
    const { userId } = await seedLearnerFixture(database.prisma);
    await seedExport(userId, { status: "FAILED", dataset: "a-very-long-dataset-code-that-keeps-going-and-going", completedAt: ago(MINUTE) });
    const result = (await status()).failedWork;
    expect(result.state === "ok" && result.rows[0].label).toBe("A very long dataset code that keeps going and going");
  });
});

// ---------------------------------------------------------------------------
// Payment exceptions
// ---------------------------------------------------------------------------

describe("Operations status: payment exceptions", () => {
  it("lists exception orders with reason labels, rejected webhooks, failed refunds, stuck attempts and open cases, without amounts, names or payloads", async () => {
    // Orders in EXCEPTION, one per reason kind.
    const known = await seedUserAndOrder({ status: "EXCEPTION" });
    const unknown = await seedUserAndOrder({ status: "EXCEPTION" });
    const inherited = await seedUserAndOrder({ status: "EXCEPTION" });
    await database.prisma.domainEvent.createMany({
      data: [
        { type: "order.exception", payload: { orderId: known.orderId, reason: "amount_or_currency_mismatch" }, processedAt: NOW },
        { type: "order.exception", payload: { orderId: unknown.orderId, reason: "totally_new_code" }, processedAt: NOW },
        { type: "order.exception", payload: { orderId: inherited.orderId, reason: "constructor" }, processedAt: NOW },
      ],
    });
    await database.prisma.order.update({ where: { id: known.orderId }, data: { updatedAt: ago(MINUTE) } });

    // Webhooks: two that count, one old, and two healthy ones. The payload and error never leave the service.
    await database.prisma.webhookEvent.createMany({
      data: [
        { provider: "PAYSTACK", providerEventId: uniq("evt"), eventType: "charge.success", payload: { secret: "webhook-payload-text" }, signatureValid: false, status: "SIGNATURE_INVALID", receivedAt: ago(HOUR) },
        { provider: "STRIPE", providerEventId: uniq("evt"), eventType: "payment_intent.succeeded", payload: { secret: "webhook-payload-text" }, signatureValid: true, status: "EXCEPTION", receivedAt: ago(2 * HOUR), error: "provider-error-text-xyz" },
        { provider: "STRIPE", providerEventId: uniq("evt"), eventType: "old", payload: {}, signatureValid: false, status: "SIGNATURE_INVALID", receivedAt: ago(20 * DAY) },
        { provider: "STRIPE", providerEventId: uniq("evt"), eventType: "ok", payload: {}, signatureValid: true, status: "PROCESSED", receivedAt: ago(HOUR) },
        { provider: "STRIPE", providerEventId: uniq("evt"), eventType: "ok2", payload: {}, signatureValid: true, status: "RECEIVED", receivedAt: ago(HOUR) },
      ],
    });

    // A failed refund and a stuck attempt on a paid order.
    const paid = await seedUserAndOrder({ status: "PAID" });
    const succeeded = await database.prisma.paymentAttempt.create({
      data: { orderId: paid.orderId, provider: "PAYSTACK", amountMinor: 1000, currency: "NGN", status: "SUCCEEDED", idempotencyKey: uniq("a"), confirmedAt: ago(DAY), reconciledAt: ago(DAY) },
      select: { id: true },
    });
    const refund = await database.prisma.refund.create({
      data: { orderId: paid.orderId, paymentAttemptId: succeeded.id, amountMinor: 500, currency: "NGN", provider: "PAYSTACK", reason: "refund-reason-text", accessDecision: "REVOKE", status: "FAILED" },
      select: { id: true },
    });
    const stuckOrder = await seedUserAndOrder({ status: "PENDING" });
    await database.prisma.paymentAttempt.create({
      data: { orderId: stuckOrder.orderId, provider: "PAYSTACK", amountMinor: 1000, currency: "NGN", status: "PROCESSING", idempotencyKey: uniq("a"), initiatedAt: ago(46 * MINUTE) },
    });
    // A processing attempt under the 45-minute limit is not stuck.
    const freshOrder = await seedUserAndOrder({ status: "PENDING" });
    await database.prisma.paymentAttempt.create({
      data: { orderId: freshOrder.orderId, provider: "PAYSTACK", amountMinor: 1000, currency: "NGN", status: "PROCESSING", idempotencyKey: uniq("a"), initiatedAt: ago(44 * MINUTE) },
    });

    // Reconciliation cases: two open (one captured money), one resolved.
    const openAttempt = await database.prisma.paymentAttempt.create({
      data: { orderId: paid.orderId, provider: "STRIPE", amountMinor: 1000, currency: "USD", status: "SUCCEEDED", idempotencyKey: uniq("a"), confirmedAt: ago(DAY), reconciledAt: ago(DAY) },
      select: { id: true },
    });
    const secondAttempt = await database.prisma.paymentAttempt.create({
      data: { orderId: paid.orderId, provider: "STRIPE", amountMinor: 1000, currency: "USD", status: "SUCCEEDED", idempotencyKey: uniq("a"), confirmedAt: ago(DAY), reconciledAt: ago(DAY) },
      select: { id: true },
    });
    const thirdAttempt = await database.prisma.paymentAttempt.create({
      data: { orderId: paid.orderId, provider: "STRIPE", amountMinor: 1000, currency: "USD", status: "SUCCEEDED", idempotencyKey: uniq("a"), confirmedAt: ago(DAY), reconciledAt: ago(DAY) },
      select: { id: true },
    });
    const caseBase = { subject: "PAYMENT" as const, evidence: { note: "case-evidence-text" }, lastEvidenceAt: ago(HOUR) };
    await database.prisma.reconciliationCase.createMany({
      data: [
        { ...caseBase, risk: "CAPTURED_MONEY", status: "OPEN", paymentAttemptId: openAttempt.id, evidenceFingerprint: uniq("fp") },
        { ...caseBase, risk: "SETTLEMENT_VARIANCE", status: "REOPENED", paymentAttemptId: secondAttempt.id, evidenceFingerprint: uniq("fp") },
        { ...caseBase, risk: "CAPTURED_MONEY", status: "RESOLVED", paymentAttemptId: thirdAttempt.id, evidenceFingerprint: uniq("fp") },
      ],
    });

    const result = await status();
    expect(result.paymentExceptions.state).toBe("ok");
    if (result.paymentExceptions.state !== "ok") return;
    const section = result.paymentExceptions;

    // 3 orders + 2 recent webhooks + 1 refund + 1 stuck attempt.
    expect(section.total).toBe(7);
    expect(section.rows).toHaveLength(7);
    expect(section.reconciliation).toEqual({ open: 2, highRisk: 1 });

    const orders = section.rows.filter((r) => r.kind === "order");
    const labelFor = (orderId: string) => orders.find((r) => r.kind === "order" && r.orderId === orderId);
    expect(labelFor(known.orderId)).toMatchObject({ reasonLabel: "Amount or currency mismatch", orderReference: known.reference });
    expect(labelFor(unknown.orderId)).toMatchObject({ reasonLabel: "Payment needs review" });
    // An inherited property name is not an order exception code.
    expect(labelFor(inherited.orderId)).toMatchObject({ reasonLabel: "Payment needs review" });

    expect(section.rows.filter((r) => r.kind === "webhook").map((r) => r.kind === "webhook" && `${r.provider}:${r.reason}`).sort()).toEqual([
      "Paystack:signature_invalid",
      "Stripe:exception",
    ]);
    expect(section.rows.find((r) => r.kind === "refund")).toMatchObject({ orderReference: paid.reference });
    expect(section.rows.find((r) => r.kind === "stuck_attempt")).toMatchObject({ minutes: 46, orderId: stuckOrder.orderId });
    expect(refund.id).toBeTruthy();

    // Privacy: no payload text, error text, evidence, name or amount anywhere in the result.
    const serialised = JSON.stringify(result);
    for (const forbidden of ["webhook-payload-text", "provider-error-text-xyz", "refund-reason-text", "case-evidence-text", "Zainab", "987654321"]) {
      expect(serialised).not.toContain(forbidden);
    }
    expect(summariseOpsStatus(result).paymentExceptions).toBe(9);
  });

  it("shows ten rows and a total of 11 for eleven exception orders", async () => {
    for (let i = 0; i < 11; i += 1) await seedUserAndOrder({ status: "EXCEPTION" });
    const section = (await status()).paymentExceptions;
    expect(section.state === "ok" && section.rows).toHaveLength(10);
    expect(section.state === "ok" && section.total).toBe(11);
  });
});

// ---------------------------------------------------------------------------
// Integrity checks and section isolation
// ---------------------------------------------------------------------------

describe("Operations status: integrity checks and isolation", () => {
  it("returns the status and violation count of each integrity check, without sample ids", async () => {
    const { service } = buildService({ realIntegrity: true });
    const result = await service.getOperationsStatus();
    expect(result.integrity.state).toBe("ok");
    if (result.integrity.state !== "ok") return;
    expect(result.integrity.checks).toHaveLength(7);
    for (const check of result.integrity.checks) {
      expect(Object.keys(check).sort()).toEqual(["id", "label", "status", "violationCount"]);
      expect(check.status).toBe("passed");
    }
  });

  it("a failing section shows as an error while the other sections still load, and the log names only the section and error type", async () => {
    const target = database.prisma;
    const failing = new Proxy(target, {
      get(obj, prop) {
        const value = Reflect.get(obj, prop);
        if (prop === "order") {
          return new Proxy(value as object, {
            get(delegate, method) {
              if (method === "findMany" || method === "count") {
                return async () => {
                  throw new Error("boom with private.person@ops-status-privacy.test inside");
                };
              }
              const inner = Reflect.get(delegate, method);
              return typeof inner === "function" ? inner.bind(delegate) : inner;
            },
          });
        }
        return typeof value === "function" ? value.bind(obj) : value;
      },
    }) as unknown as OpsClient;

    const { service, logged } = buildService({ client: failing });
    const result = await service.getOperationsStatus();

    expect(result.paymentExceptions).toEqual({ state: "error" });
    expect(result.jobs.state).toBe("ok");
    expect(result.failedWork.state).toBe("ok");
    expect(result.emailFailures.state).toBe("ok");
    expect(result.integrity.state).toBe("ok");
    expect(logged).toEqual(["[ops-status] section paymentExceptions failed: Error"]);
    // A section that could not load is never read as healthy.
    expect(summariseOpsStatus(result).needsAttention).toBe(true);
  });

  it("an integrity run that throws or finds violations is reported, not hidden", async () => {
    const withPermission = createWithPermission({
      getActor: async () => ({ userId: "ops-test-actor" }),
      loadGrants: async () => [grant("audit.view")],
      audit: async () => {},
    });
    const broken = createOpsStatusService({
      client: database.prisma as unknown as OpsClient,
      withPermission,
      integrity: { runIntegrityChecks: async () => { throw new Error("db down"); } },
      now: () => NOW,
    });
    expect((await broken.getOperationsStatus()).integrity).toEqual({ state: "error" });

    const violating = createOpsStatusService({
      client: database.prisma as unknown as OpsClient,
      withPermission,
      integrity: {
        runIntegrityChecks: async () => [
          { id: "x", label: "Paid orders have a successful payment", status: "violations", violationCount: 2, sampleIds: ["a", "b"] },
        ],
      },
      now: () => NOW,
    });
    const result = await violating.getOperationsStatus();
    expect(result.integrity).toEqual({
      state: "ok",
      checks: [{ id: "x", label: "Paid orders have a successful payment", status: "violations", violationCount: 2 }],
    });
    expect(summariseOpsStatus(result).needsAttention).toBe(true);
  });
});
