/**
 * Real-Postgres proof of the learner data export (Phase 15, plan 15-21; D-12,
 * NFR-11, NFR-13, P6): one authorised request prepares one learner's data as a
 * single long-format CSV through the existing ExportJob pipeline, the worker
 * produces the file, and the file holds that learner's records and nothing
 * that belongs to anyone else, no secret and no staff-only note.
 *
 * `@/server/db` is pointed at the Testcontainers client so the real
 * permission layer and audit sink run against it, never against the configured
 * DATABASE_URL. The worker uploads to an in-memory capture, so no object
 * storage is touched.
 *
 * PREREQUISITE: Docker must be running (tests/support/pg.ts starts a
 * throwaway postgres:16-alpine container). If it is not, `beforeAll` fails with
 * a container-start error: every case reports BLOCKED, never a silent pass.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

const dbHolder = vi.hoisted(() => ({ prisma: null as unknown as object }));
vi.mock("@/server/db", () => ({
  prisma: new Proxy(
    {},
    {
      get(_target, key) {
        const client = dbHolder.prisma as Record<PropertyKey, unknown>;
        const value = Reflect.get(client, key);
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(client) : value;
      },
    },
  ),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

import {
  AuthorizationError,
  createWithPermission,
  LicenceRestrictedError,
  type RawGrant,
} from "@/server/permissions/with-permission";
import { recordAuthorizationAudit } from "@/server/services/audit-service";
import { createExportService, ExportRequestError } from "@/server/services/export-service";
import { canAccessExportJob } from "@/server/services/export-read-service";
import { createExportWorkerService } from "@/server/services/export-worker-service";
import { createPrivacyAnonymiseService } from "@/server/services/privacy-anonymise-service";
import {
  createPrivacyExportService,
  LEARNER_EXPORT_SECTIONS,
  LearnerExportNotFoundError,
  LearnerExportReasonError,
  learnerSubjectProducer,
} from "@/server/services/privacy-export-service";
import { seedAttendanceFixture, seedCohortFixture, seedSessionFixture } from "./support/cohort-fixtures";
import { grant } from "./support/harness";
import { activateAt, guardedWithPermission, makeClock, resetLicenceFlow } from "./support/licence-flow";
import { FIXTURE_NOW } from "./support/licence-fixtures";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";

// Real Postgres and several transactions per case.
vi.setConfig({ testTimeout: 60_000 });

let db: TestDatabase;
let prisma: PrismaClient;
let actorId: string;
let staffReplyId: string;
let cohortId: string;
let courseId: string;
let sequence = 0;
let clock = new Date("2026-10-09T09:00:00.000Z");

const REASON = "Learner asked for a copy of their data, ref PRIV-7";
const CORRELATION = "corr-privacy-export-test";
const STAFF_NAME = "Grace Staffwriter";
const STAFF_EMAIL = "grace.staffwriter@privacy-export.test";
const INTERNAL_NOTE = "INTERNAL-ONLY note: learner is disputing the refund, escalate to finance";
const DRAFT_FEEDBACK = "DRAFT-ONLY feedback that was never released to the learner";
const PASSWORD_HASH = "scrypt:SECRET-PASSWORD-HASH-VALUE";
const SESSION_TOKEN_HASH = "SECRET-SESSION-TOKEN-HASH";
const VERIFICATION_TOKEN_HASH = "SECRET-VERIFICATION-TOKEN-HASH";
const STORAGE_KEY_PART = "private-storage-key";

beforeAll(async () => {
  db = await startTestDatabase();
  prisma = db.prisma;
  dbHolder.prisma = prisma;

  actorId = (
    await prisma.user.create({
      data: { email: "privacy-export-actor@privacy-export.test", name: "Privacy Export Actor", status: "ACTIVE", isStaff: true },
    })
  ).id;
  // The pipeline authorises from real Assignment rows: privacy.manage alone.
  const role = await prisma.role.create({ data: { name: "Privacy officer (export test)", permissions: ["privacy.manage"] } });
  await prisma.assignment.create({ data: { userId: actorId, roleId: role.id, scopeType: "GLOBAL" } });

  staffReplyId = (
    await prisma.user.create({ data: { email: STAFF_EMAIL, name: STAFF_NAME, status: "ACTIVE", isStaff: true } })
  ).id;
  ({ cohortId, courseId } = await seedCohortFixture(prisma, { capacity: 50 }));
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await db?.stop();
}, TEST_DB_TIMEOUT_MS);

beforeEach(async () => {
  clock = new Date("2026-10-09T09:00:00.000Z");
  uploads.length = 0;
  failKey = null;
  await prisma.exportJob.deleteMany();
  await prisma.auditEvent.deleteMany({ where: { action: { in: ["privacy.learner_export_requested", "export.requested", "export.retried", "export.succeeded", "export.failed", "export.expired"] } } });
});

// ---------------------------------------------------------------- harness

const uploads: Array<{ key: string; csv: string }> = [];
let failKey: string | null = null;

function worker() {
  return createExportWorkerService({
    db: prisma,
    now: () => clock,
    upload: async ({ key, body }) => {
      if (failKey && key.includes(failKey)) throw new Error("storage-provider-secret-should-never-be-shown");
      const chunks: Buffer[] = [];
      for await (const chunk of body) chunks.push(Buffer.from(chunk));
      uploads.push({ key, csv: Buffer.concat(chunks).toString("utf8") });
    },
    deleteObject: async () => {},
  });
}

function pipeline(userId: string = actorId) {
  return createExportService({
    db: prisma,
    actor: async () => ({ userId }),
    now: () => clock,
    producers: { "learner-subject": learnerSubjectProducer },
  });
}

function buildService(options: { grants?: RawGrant[]; userId?: string; pipelineActor?: string } = {}) {
  const withPermission = createWithPermission({
    getActor: async () => ({ userId: options.userId ?? actorId }),
    loadGrants: async () => options.grants ?? [grant("privacy.manage")],
    audit: recordAuthorizationAudit,
  });
  return createPrivacyExportService({
    store: prisma as never,
    withPermission,
    pipeline: pipeline(options.pipelineActor ?? options.userId ?? actorId),
    correlationId: async () => CORRELATION,
    now: () => clock,
  });
}

/** Runs the worker once and returns the CSV it produced for the job. */
async function runWorker(jobId: string): Promise<string> {
  await worker().processBatch(5);
  const job = await prisma.exportJob.findUniqueOrThrow({ where: { id: jobId } });
  expect(job.status).toBe("SUCCEEDED");
  const upload = uploads.find((item) => item.key.includes(jobId));
  if (!upload) throw new Error("no CSV was uploaded for the job");
  return upload.csv;
}

/** Parses the data section of the export CSV (after the blank line and header). */
function parseCsv(csv: string): Array<Record<string, string>> {
  const body = csv.replace(/^﻿/, "");
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { record.push(cell); cell = ""; }
    else if (ch === "\r" && body[i + 1] === "\n") { record.push(cell); records.push(record); record = []; cell = ""; i++; }
    else cell += ch;
  }
  if (cell || record.length) { record.push(cell); records.push(record); }
  const headerIndex = records.findIndex((r) => r[0] === "Section");
  if (headerIndex < 0) throw new Error("export CSV has no header row");
  const header = records[headerIndex];
  return records.slice(headerIndex + 1).filter((r) => r.length === header.length).map((r) => Object.fromEntries(header.map((name, index) => [name, r[index]])));
}

type Seeded = Awaited<ReturnType<typeof seedLearner>>;

/** A learner with a record in every section, including the things that must NOT be exported. */
async function seedLearner(label: string) {
  sequence += 1;
  const tag = `${label}-${sequence}-${randomUUID().slice(0, 6)}`;
  const email = `${label}.${tag}@privacy-export.test`;
  const name = `${label} Okafor ${tag}`;
  const user = await prisma.user.create({
    data: {
      email,
      name,
      phone: "+2348012345678",
      pendingEmail: `${label}.new.${tag}@privacy-export.test`,
      passwordHash: `${PASSWORD_HASH}-${tag}`,
      status: "ACTIVE",
      emailVerified: new Date("2026-08-01T10:00:00.000Z"),
      learnerNumber: `KQL-EXP-${tag}`,
    },
  });
  const enrolment = await prisma.enrolment.create({ data: { cohortId, userId: user.id, status: "ACTIVE", reason: `STAFF-ENROLMENT-NOTE-${tag}` } });
  const order = await prisma.order.create({
    data: { reference: `ORD-${tag}`, userId: user.id, cohortId, amountMinor: 50_000, idempotencyKey: `idem-order-${tag}`, status: "PAID", paidAt: new Date("2026-08-02T10:00:00.000Z") },
  });
  const attempt = await prisma.paymentAttempt.create({
    data: {
      orderId: order.id,
      provider: "MANUAL",
      amountMinor: 50_000,
      currency: "NGN",
      status: "SUCCEEDED",
      idempotencyKey: `idem-attempt-${tag}`,
      manualChannel: "BANK_TRANSFER",
      manualReference: `BANKREF-${tag}`,
      manualPaidAt: new Date("2026-08-02T09:00:00.000Z"),
      manualEvidenceKey: `evidence/${STORAGE_KEY_PART}-${tag}.pdf`,
      reason: `STAFF-PAYMENT-REASON-${tag}`,
      evidence: { providerSecret: `PROVIDER-SECRET-${tag}` },
    },
  });
  const refund = await prisma.refund.create({
    data: { orderId: order.id, paymentAttemptId: attempt.id, amountMinor: 5_000, currency: "NGN", provider: "MANUAL", reason: `STAFF-REFUND-REASON-${tag}`, accessDecision: "KEEP" },
  });
  const { sessionId } = await seedSessionFixture(prisma, { cohortId });
  const attendance = await seedAttendanceFixture(prisma, { sessionId, enrolmentId: enrolment.id, state: "PRESENT", note: `STAFF-ATTENDANCE-NOTE-${tag}` });
  const assignment = await prisma.assessment.create({ data: { courseId, type: "ASSIGNMENT", title: `Assignment ${tag}` } });
  const draftAssignment = await prisma.assessment.create({ data: { courseId, type: "ASSIGNMENT", title: `Draft assignment ${tag}` } });
  const submission = await prisma.submission.create({
    data: {
      assessmentId: assignment.id,
      enrolmentId: enrolment.id,
      versionUsed: 1,
      storageKey: `submissions/${STORAGE_KEY_PART}-${tag}.pdf`,
      filename: `work-${tag}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 1234,
    },
  });
  const grade = await prisma.grade.create({
    data: {
      assessmentId: assignment.id,
      enrolmentId: enrolment.id,
      submissionId: submission.id,
      score: 8,
      maxScore: 10,
      passed: true,
      feedback: `Released feedback for ${tag}`,
      status: "RELEASED",
      releasedAt: new Date("2026-09-01T10:00:00.000Z"),
      gradedById: staffReplyId,
      releasedById: staffReplyId,
    },
  });
  await prisma.grade.create({
    data: { assessmentId: draftAssignment.id, enrolmentId: enrolment.id, score: 2, maxScore: 10, feedback: `${DRAFT_FEEDBACK} ${tag}`, status: "DRAFT" },
  });
  const certificate = await prisma.certificate.create({
    data: {
      verificationRef: `VER-${tag}`,
      enrolmentId: enrolment.id,
      userId: user.id,
      scope: "COURSE",
      courseId,
      awardTitle: `Certificate of completion ${tag}`,
      learnerName: name,
      storageKey: `certificates/${STORAGE_KEY_PART}-${tag}.pdf`,
    },
  });
  const policy = await prisma.policyAcceptance.create({ data: { userId: user.id, policyType: "terms", version: "2", accepted: true } });
  const ticket = await prisma.ticket.create({
    data: { reference: `TKT-${tag}`, userId: user.id, category: "OTHER", subject: `Help with my account ${tag}`, assigneeId: staffReplyId },
  });
  const learnerMessage = await prisma.ticketMessage.create({
    data: { ticketId: ticket.id, authorId: user.id, kind: "INITIAL", visibility: "PUBLIC", body: `Please help ${tag}` },
  });
  const staffMessage = await prisma.ticketMessage.create({
    data: { ticketId: ticket.id, authorId: staffReplyId, kind: "REPLY", visibility: "PUBLIC", body: `We are looking into it ${tag}` },
  });
  const internalMessage = await prisma.ticketMessage.create({
    data: { ticketId: ticket.id, authorId: staffReplyId, kind: "INTERNAL_NOTE", visibility: "INTERNAL", body: `${INTERNAL_NOTE} ${tag}` },
  });
  await prisma.emailPreference.create({ data: { userId: user.id, category: "MARKETING", muted: true } });
  // Secrets that live next to the learner but must never reach the file.
  await prisma.session.create({ data: { sessionToken: `${SESSION_TOKEN_HASH}-${tag}`, userId: user.id, expires: new Date(Date.now() + 3_600_000), ipAddress: "203.0.113.77", userAgent: "SecretAgent/1.0" } });
  await prisma.verificationToken.create({
    data: { identifier: email, token: `${VERIFICATION_TOKEN_HASH}-${tag}`, expires: new Date(Date.now() + 3_600_000), purpose: "EMAIL_VERIFICATION" },
  });

  return {
    tag,
    user,
    email,
    name,
    ids: {
      enrolment: enrolment.id,
      order: order.id,
      attempt: attempt.id,
      refund: refund.id,
      attendance: attendance.attendanceId,
      submission: submission.id,
      grade: grade.id,
      certificate: certificate.id,
      policy: policy.id,
      ticket: ticket.id,
      learnerMessage: learnerMessage.id,
      staffMessage: staffMessage.id,
      internalMessage: internalMessage.id,
    },
  };
}

function rowsOf(rows: Array<Record<string, string>>, section: string) {
  return rows.filter((row) => row["Section"] === section);
}
function valueOf(rows: Array<Record<string, string>>, section: string, recordId: string, field: string) {
  return rows.find((row) => row["Section"] === section && row["Record"] === recordId && row["Field"] === field)?.["Value"];
}

async function auditRows(userId: string) {
  return prisma.auditEvent.findMany({ where: { action: "privacy.learner_export_requested", targetId: userId } });
}

// ------------------------------------------------------------------- tests

describe("tracer: request one learner's export, run the worker, read the file (D-12, NFR-11)", () => {
  it("queues a job through the pipeline, the worker finishes it, and the file holds the learner's profile", async () => {
    const learner = await seedLearner("Ada");
    const service = buildService();

    const requested = await service.requestLearnerExport({ userId: learner.user.id, reason: REASON });
    expect(requested.reused).toBe(false);
    expect(requested.status).toBe("QUEUED");

    const queued = await prisma.exportJob.findUniqueOrThrow({ where: { id: requested.jobId } });
    expect(queued.dataset).toBe("learner-subject");
    expect(queued.requestedById).toBe(actorId);
    expect(queued.filters).toEqual({ userId: learner.user.id });
    expect(queued.sensitiveReason).toBe(REASON);

    const csv = await runWorker(requested.jobId);
    const rows = parseCsv(csv);
    expect(csv).toContain("Section,Record type,Record,Field,Recorded at,Value");
    expect(valueOf(rows, "profile", learner.user.id, "name")).toBe(learner.name);
    expect(valueOf(rows, "profile", learner.user.id, "email")).toBe(learner.email);
    // The CSV contract prefixes an apostrophe to a cell that starts with + so a spreadsheet cannot read it as a formula.
    expect(valueOf(rows, "profile", learner.user.id, "phone")).toBe("'+2348012345678");
    expect(valueOf(rows, "profile", learner.user.id, "learnerNumber")).toBe(`KQL-EXP-${learner.tag}`);
    expect(valueOf(rows, "profile", learner.user.id, "status")).toBe("ACTIVE");
    expect(valueOf(rows, "profile", learner.user.id, "registeredAt")).toBe(learner.user.createdAt.toISOString());
    expect(valueOf(rows, "profile", learner.user.id, "emailVerifiedAt")).toBe("2026-08-01T10:00:00.000Z");
  });
});

describe("the file: every section, nothing else (T-15-21-02, T-15-21-03, P6)", () => {
  let first: Seeded;
  let second: Seeded;
  let rows: Array<Record<string, string>>;
  let csv: string;

  beforeAll(async () => {
    first = await seedLearner("Ada");
    second = await seedLearner("Bola");
    const requested = await buildService().requestLearnerExport({ userId: first.user.id, reason: REASON });
    csv = await runWorker(requested.jobId);
    rows = parseCsv(csv);
  }, TEST_DB_TIMEOUT_MS);

  it("contains rows for every section in LEARNER_EXPORT_SECTIONS", () => {
    for (const section of LEARNER_EXPORT_SECTIONS) {
      expect(rowsOf(rows, section).length, `section ${section}`).toBeGreaterThan(0);
    }
    expect([...new Set(rows.map((row) => row["Section"]))].sort()).toEqual([...LEARNER_EXPORT_SECTIONS].sort());
  });

  it("carries the learner's records with their own field values", () => {
    const { ids } = first;
    expect(valueOf(rows, "consent", ids.policy, "policyType")).toBe("terms");
    expect(valueOf(rows, "consent", ids.policy, "accepted")).toBe("true");
    expect(valueOf(rows, "enrolments", ids.enrolment, "status")).toBe("ACTIVE");
    expect(valueOf(rows, "orders", ids.order, "reference")).toBe(`ORD-${first.tag}`);
    expect(valueOf(rows, "orders", ids.order, "amountMinor")).toBe("50000");
    expect(valueOf(rows, "payment-attempts", ids.attempt, "manualReference")).toBe(`BANKREF-${first.tag}`);
    expect(valueOf(rows, "refunds", ids.refund, "amountMinor")).toBe("5000");
    expect(valueOf(rows, "attendance", ids.attendance, "state")).toBe("PRESENT");
    expect(valueOf(rows, "submissions", ids.submission, "filename")).toBe(`work-${first.tag}.pdf`);
    expect(valueOf(rows, "grades", ids.grade, "score")).toBe("8");
    expect(valueOf(rows, "grades", ids.grade, "feedback")).toBe(`Released feedback for ${first.tag}`);
    expect(valueOf(rows, "certificates", ids.certificate, "verificationReference")).toBe(`VER-${first.tag}`);
    expect(valueOf(rows, "support", ids.ticket, "subject")).toBe(`Help with my account ${first.tag}`);
    expect(valueOf(rows, "support", ids.learnerMessage, "message")).toBe(`Please help ${first.tag}`);
    expect(valueOf(rows, "email-preferences", "MARKETING", "muted")).toBe("true");
  });

  it("shows staff replies as the support team and leaves out staff-only notes (INTERNAL)", () => {
    const { ids } = first;
    expect(valueOf(rows, "support", ids.staffMessage, "author")).toBe("Support team");
    expect(valueOf(rows, "support", ids.staffMessage, "message")).toBe(`We are looking into it ${first.tag}`);
    expect(valueOf(rows, "support", ids.learnerMessage, "author")).toBe("Learner");
    expect(rows.some((row) => row["Record"] === ids.internalMessage)).toBe(false);
    expect(csv).not.toContain("INTERNAL-ONLY");
    expect(csv).not.toContain(INTERNAL_NOTE);
    expect(rows.every((row) => !row["Value"].includes(INTERNAL_NOTE))).toBe(true);
  });

  it("leaves out staff names and addresses", () => {
    expect(csv).not.toContain(STAFF_NAME);
    expect(csv).not.toContain(STAFF_EMAIL);
    expect(csv).not.toContain("privacy-export-actor@");
  });

  it("excludes draft grades: only the released grade and its feedback appear", () => {
    expect(rowsOf(rows, "grades").map((row) => row["Record"])).toEqual(expect.arrayContaining([first.ids.grade]));
    expect(new Set(rowsOf(rows, "grades").map((row) => row["Record"]))).toEqual(new Set([first.ids.grade]));
    expect(csv).not.toContain("DRAFT-ONLY");
    expect(csv).not.toContain(DRAFT_FEEDBACK);
  });

  it("contains no password hash, session or verification token hash, storage key or provider secret", () => {
    for (const secret of [PASSWORD_HASH, SESSION_TOKEN_HASH, VERIFICATION_TOKEN_HASH, STORAGE_KEY_PART, "PROVIDER-SECRET", "SecretAgent", "203.0.113.77"]) {
      expect(csv, secret).not.toContain(secret);
    }
    // No cell equals a seeded hash or the internal note body either.
    const cells = rows.flatMap((row) => Object.values(row));
    expect(cells.some((cell) => cell.startsWith("scrypt:"))).toBe(false);
    expect(cells.some((cell) => cell === INTERNAL_NOTE || cell.includes(INTERNAL_NOTE))).toBe(false);
  });

  it("leaves out staff free-text notes that the learner never saw", () => {
    for (const note of ["STAFF-ENROLMENT-NOTE", "STAFF-PAYMENT-REASON", "STAFF-REFUND-REASON", "STAFF-ATTENDANCE-NOTE"]) {
      expect(csv, note).not.toContain(note);
    }
  });

  it("contains nothing of the second learner: not their id, name, email, order, ticket or messages", () => {
    expect(csv).not.toContain(second.user.id);
    expect(csv).not.toContain(second.name);
    expect(csv).not.toContain(second.email);
    expect(csv).not.toContain(second.tag);
    for (const id of Object.values(second.ids)) expect(csv, id).not.toContain(id);
  });

  it("every row belongs to the first learner's own records", () => {
    const own = new Set<string>([first.user.id, ...Object.values(first.ids), "MARKETING"]);
    expect(rows.length).toBeGreaterThan(40);
    expect(rows.every((row) => own.has(row["Record"]))).toBe(true);
  });
});

describe("refusals (T-15-21-01)", () => {
  it("refuses a staff target, an unknown id and an anonymised learner with the same not-found error", async () => {
    const service = buildService();
    const anonymised = await seedLearner("Gone");
    await prisma.user.update({ where: { id: anonymised.user.id }, data: { anonymisedAt: new Date() } });
    const withRole = await seedLearner("Role");
    const role = await prisma.role.create({ data: { name: `Assigned ${withRole.tag}`, permissions: ["audit.view"] } });
    await prisma.assignment.create({ data: { userId: withRole.user.id, roleId: role.id, scopeType: "GLOBAL" } });

    for (const userId of [staffReplyId, actorId, "no-such-user-id", anonymised.user.id, withRole.user.id, ""]) {
      await expect(service.requestLearnerExport({ userId, reason: REASON }), userId).rejects.toBeInstanceOf(LearnerExportNotFoundError);
    }
    expect(await prisma.exportJob.count()).toBe(0);
    expect(await prisma.auditEvent.count({ where: { action: "privacy.learner_export_requested" } })).toBe(0);
  });

  it("refuses a reason under 10 characters (after trimming) and creates nothing", async () => {
    const learner = await seedLearner("Short");
    const service = buildService();
    for (const reason of ["", "   ", "too short", "   123456789   "]) {
      await expect(service.requestLearnerExport({ userId: learner.user.id, reason }), reason).rejects.toBeInstanceOf(LearnerExportReasonError);
    }
    expect(await prisma.exportJob.count()).toBe(0);
    // Exactly 10 characters is accepted.
    await expect(service.requestLearnerExport({ userId: learner.user.id, reason: "1234567890" })).resolves.toMatchObject({ reused: false });
  });

  it("the pipeline itself refuses a staff or anonymised target even when called without the privacy service", async () => {
    const learner = await seedLearner("Direct");
    await prisma.user.update({ where: { id: learner.user.id }, data: { anonymisedAt: new Date() } });
    for (const userId of [staffReplyId, learner.user.id]) {
      await expect(
        pipeline().requestExport({ dataset: "learner-subject", filters: { userId }, columns: ["section", "recordType", "recordId", "field", "recordedAt", "value"], reason: REASON }),
      ).rejects.toBeInstanceOf(LearnerExportNotFoundError);
    }
    expect(await prisma.exportJob.count()).toBe(0);
  });

  it("the pipeline refuses a request with no reason, because the value column is sensitive", async () => {
    const learner = await seedLearner("NoReason");
    await expect(
      pipeline().requestExport({ dataset: "learner-subject", filters: { userId: learner.user.id }, columns: ["section", "recordType", "recordId", "field", "recordedAt", "value"] }),
    ).rejects.toBeInstanceOf(ExportRequestError);
  });
});

describe("states and idempotency (NFR-13, T-15-21-05)", () => {
  it("a second request while the first is Queued or Processing returns the same job, and a finished job allows a new one", async () => {
    const learner = await seedLearner("Idem");
    const service = buildService();

    const first = await service.requestLearnerExport({ userId: learner.user.id, reason: REASON });
    const again = await service.requestLearnerExport({ userId: learner.user.id, reason: REASON });
    expect(again).toMatchObject({ jobId: first.jobId, reused: true });

    await prisma.exportJob.update({ where: { id: first.jobId }, data: { status: "PROCESSING", startedAt: clock } });
    const whileProcessing = await service.requestLearnerExport({ userId: learner.user.id, reason: REASON });
    expect(whileProcessing).toMatchObject({ jobId: first.jobId, reused: true });
    expect(await prisma.exportJob.count({ where: { dataset: "learner-subject" } })).toBe(1);

    await prisma.exportJob.update({ where: { id: first.jobId }, data: { status: "QUEUED" } });
    await runWorker(first.jobId);
    const next = await service.requestLearnerExport({ userId: learner.user.id, reason: REASON });
    expect(next.reused).toBe(false);
    expect(next.jobId).not.toBe(first.jobId);
    expect(await prisma.exportJob.count({ where: { dataset: "learner-subject" } })).toBe(2);
  });

  it("two simultaneous first requests end up with one job", async () => {
    const learner = await seedLearner("Race");
    const service = buildService();
    const [a, b] = await Promise.all([
      service.requestLearnerExport({ userId: learner.user.id, reason: REASON }),
      service.requestLearnerExport({ userId: learner.user.id, reason: REASON }),
    ]);
    expect(a.jobId).toBe(b.jobId);
    expect(await prisma.exportJob.count({ where: { dataset: "learner-subject" } })).toBe(1);
  });

  it("reports none, queued, processing, succeeded (with expiry and download path), expired and failed", async () => {
    const learner = await seedLearner("State");
    const service = buildService();
    const status = () => service.getLearnerExportStatus({ userId: learner.user.id });

    expect(await status()).toMatchObject({ state: "none", jobId: null, canDownload: false, canRetry: false, inFlight: false });

    const { jobId } = await service.requestLearnerExport({ userId: learner.user.id, reason: REASON });
    expect(await status()).toMatchObject({ state: "queued", jobId, inFlight: true, canDownload: false, canRetry: false });

    await prisma.exportJob.update({ where: { id: jobId }, data: { status: "PROCESSING", startedAt: clock } });
    expect(await status()).toMatchObject({ state: "processing", jobId, inFlight: true });
    await prisma.exportJob.update({ where: { id: jobId }, data: { status: "QUEUED" } });

    await runWorker(jobId);
    const done = await status();
    expect(done).toMatchObject({ state: "succeeded", jobId, canDownload: true, canRetry: false, inFlight: false });
    expect(done.downloadPath).toBe(`/api/staff/reports/exports/${jobId}/download`);
    expect(done.expiresAt?.getTime()).toBe(clock.getTime() + 24 * 60 * 60 * 1000);

    // Past the expiry the file is Expired even before the sweep has run.
    clock = new Date(clock.getTime() + 25 * 60 * 60 * 1000);
    expect(await status()).toMatchObject({ state: "expired", canDownload: false, downloadPath: null });
    expect(await worker().expireBatch(5)).toBe(1);
    expect(await status()).toMatchObject({ state: "expired", canDownload: false });
  });

  it("a failed job is retryable through the existing retry path and then succeeds, with no storage text in the status", async () => {
    const learner = await seedLearner("Fail");
    const service = buildService();
    const { jobId } = await service.requestLearnerExport({ userId: learner.user.id, reason: REASON });

    failKey = jobId;
    expect(await worker().processBatch(5)).toEqual({ processed: 0, failed: 1 });
    const failed = await service.getLearnerExportStatus({ userId: learner.user.id });
    expect(failed).toMatchObject({ state: "failed", jobId, canRetry: true, canDownload: false, inFlight: false });
    const saved = await prisma.exportJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(saved.errorMessage).not.toContain("storage-provider-secret");

    const retried = await pipeline().retryExport(jobId);
    expect(retried.status).toBe("QUEUED");
    expect(retried.jobId).not.toBe(jobId);
    expect(await service.getLearnerExportStatus({ userId: learner.user.id })).toMatchObject({ state: "queued", jobId: retried.jobId });

    failKey = null;
    const csv = await runWorker(retried.jobId);
    expect(valueOf(parseCsv(csv), "profile", learner.user.id, "email")).toBe(learner.email);
    expect(await service.getLearnerExportStatus({ userId: learner.user.id })).toMatchObject({ state: "succeeded", jobId: retried.jobId });
  });

  it("will not retry a failed export for a learner who has since been anonymised, and will not rerun an expired one", async () => {
    const learner = await seedLearner("Late");
    const service = buildService();
    const { jobId } = await service.requestLearnerExport({ userId: learner.user.id, reason: REASON });
    failKey = jobId;
    await worker().processBatch(5);
    failKey = null;
    await prisma.user.update({ where: { id: learner.user.id }, data: { anonymisedAt: new Date() } });
    await expect(pipeline().retryExport(jobId)).rejects.toBeInstanceOf(ExportRequestError);

    const other = await seedLearner("Expire");
    const expiring = await service.requestLearnerExport({ userId: other.user.id, reason: REASON });
    await runWorker(expiring.jobId);
    clock = new Date(clock.getTime() + 25 * 60 * 60 * 1000);
    await worker().expireBatch(5);
    await expect(pipeline().rerunExpiredExport(expiring.jobId)).rejects.toBeInstanceOf(ExportRequestError);
  });
});

describe("audit (T-15-21-01)", () => {
  it("writes one privacy.learner_export_requested row per request with actor, target, reason, outcome and correlationId", async () => {
    const learner = await seedLearner("Audit");
    const service = buildService();
    const { jobId } = await service.requestLearnerExport({ userId: learner.user.id, reason: REASON });

    const rows = await auditRows(learner.user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId,
      action: "privacy.learner_export_requested",
      targetType: "User",
      targetId: learner.user.id,
      reason: REASON,
      outcome: "SUCCESS",
      correlationId: CORRELATION,
      scopeType: "GLOBAL",
    });
    expect(rows[0].after).toMatchObject({ jobId, reused: false });
    // The pipeline's own row for the request exists too, and carries the reason.
    expect(await prisma.auditEvent.count({ where: { action: "export.requested", targetId: jobId, reason: REASON } })).toBe(1);

    // The audit text never holds the learner's email or name.
    const text = JSON.stringify(rows);
    expect(text).not.toContain(learner.email);
    expect(text).not.toContain(learner.name);

    // A repeat request is a request too: one more row, marked reused.
    await service.requestLearnerExport({ userId: learner.user.id, reason: REASON });
    const after = await auditRows(learner.user.id);
    expect(after).toHaveLength(2);
    expect(after.some((row) => (row.after as { reused?: boolean } | null)?.reused === true)).toBe(true);
  });
});

describe("authorization and download (T-15-21-04)", () => {
  it("a caller without privacy.manage, or with it only at a narrower scope, is denied and nothing is queued", async () => {
    const learner = await seedLearner("Deny");
    for (const grants of [[grant("users.manage"), grant("reports.export"), grant("users.view")], [grant("privacy.manage", "COHORT", "some-cohort")]]) {
      await expect(buildService({ grants }).requestLearnerExport({ userId: learner.user.id, reason: REASON })).rejects.toBeInstanceOf(AuthorizationError);
      await expect(buildService({ grants }).getLearnerExportStatus({ userId: learner.user.id })).rejects.toBeInstanceOf(AuthorizationError);
    }
    expect(await prisma.exportJob.count()).toBe(0);
    expect(await prisma.auditEvent.count({ where: { action: "authorization.denied", actorId, targetId: "privacy.manage" } })).toBeGreaterThanOrEqual(1);
  });

  it("the pipeline refuses a staff member whose stored role lacks privacy.manage, even with reports.export and users.view", async () => {
    const learner = await seedLearner("Pipe");
    const reporter = await prisma.user.create({ data: { email: `reporter-${randomUUID().slice(0, 6)}@privacy-export.test`, name: "Reporter", status: "ACTIVE", isStaff: true } });
    const role = await prisma.role.create({ data: { name: `Reporter ${randomUUID().slice(0, 6)}`, permissions: ["reports.view", "reports.export", "users.view"] } });
    await prisma.assignment.create({ data: { userId: reporter.id, roleId: role.id, scopeType: "GLOBAL" } });
    await expect(
      pipeline(reporter.id).requestExport({ dataset: "learner-subject", filters: { userId: learner.user.id }, columns: ["section", "recordType", "recordId", "field", "recordedAt", "value"], reason: REASON }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("the download access check needs privacy.manage only, and fails when it is lost", async () => {
    const learner = await seedLearner("Download");
    const service = buildService();
    const { jobId } = await service.requestLearnerExport({ userId: learner.user.id, reason: REASON });
    await runWorker(jobId);
    const job = await prisma.exportJob.findUniqueOrThrow({ where: { id: jobId } });
    const countCohorts = (where: Record<string, unknown>) => prisma.cohort.count({ where });

    expect(await canAccessExportJob(job, actorId, [grant("privacy.manage")], clock, { countCohorts })).toBe(true);
    // Losing the permission withdraws the file; reports.export and users.view do not stand in for it.
    expect(await canAccessExportJob(job, actorId, [grant("reports.export"), grant("users.view"), grant("reports.view")], clock, { countCohorts })).toBe(false);
    expect(await canAccessExportJob(job, actorId, [], clock, { countCohorts })).toBe(false);
    // Another person cannot use the job.
    expect(await canAccessExportJob(job, staffReplyId, [grant("privacy.manage")], clock, { countCohorts })).toBe(false);
  });
});

describe("licence restricted continuity mode (LIC-08, ledger P-03)", () => {
  beforeEach(async () => {
    await resetLicenceFlow(db);
  });

  it("the export request and status still work once restricted, while anonymise is refused", async () => {
    const learner = await seedLearner("Licence");
    const activated = await activateAt(db, { now: FIXTURE_NOW, actorId });
    expect(activated.result.ok).toBe(true);
    const licenceClock = makeClock(new Date(activated.graceEndsAt.getTime() - 1));
    const wrapped = () =>
      guardedWithPermission(db, licenceClock, { grants: [grant("privacy.manage")], userId: actorId }).withPermission;

    const exportService = () =>
      createPrivacyExportService({
        store: prisma as never,
        withPermission: wrapped(),
        pipeline: pipeline(),
        correlationId: async () => CORRELATION,
        now: () => clock,
      });
    const anonymiseService = () =>
      createPrivacyAnonymiseService({ store: prisma as never, withPermission: wrapped(), correlationId: async () => CORRELATION });

    // Restricted: anonymise (a write) is refused before it runs; export is not.
    licenceClock.set(activated.graceEndsAt);
    await expect(anonymiseService().anonymiseLearner({ userId: learner.user.id, reason: "Learner asked for erasure, ref PRIV-9" })).rejects.toBeInstanceOf(LicenceRestrictedError);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: learner.user.id } })).anonymisedAt).toBeNull();

    const requested = await exportService().requestLearnerExport({ userId: learner.user.id, reason: REASON });
    expect(requested.reused).toBe(false);
    expect(await exportService().getLearnerExportStatus({ userId: learner.user.id })).toMatchObject({ state: "queued", jobId: requested.jobId });
    const csv = await runWorker(requested.jobId);
    expect(valueOf(parseCsv(csv), "profile", learner.user.id, "email")).toBe(learner.email);
    expect(await auditRows(learner.user.id)).toHaveLength(1);
  });
});
