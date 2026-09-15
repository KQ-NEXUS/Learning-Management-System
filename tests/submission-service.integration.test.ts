/**
 * Real-Postgres + real-MinIO proof for the submission upload pipeline
 * (plan 10-05, ASM-04).
 *
 * The unit test for `submission-service.ts` drives `beginSubmissionUpload`/
 * `completeSubmissionUpload` against an in-memory fake storage object. That
 * fake cannot raise a real `HeadObject` 404 on a missing/never-uploaded
 * object, cannot prove the staged-to-final `CopyObject` promote actually
 * moves bytes in a real bucket, cannot fire the real
 * `@@unique([assessmentId, enrolmentId, attemptNumber])` constraint under a
 * genuine concurrent second submission, and cannot prove a failed upload
 * leaves a durable `ERROR` row rather than a rolled-back gap. This file
 * starts a throwaway `postgres:16-alpine` (`tests/support/pg.ts`), deploys
 * the checked-in migrations, and drives every case through the REAL MinIO
 * container this environment already has healthy
 * (`learning-management-system-minio-1`, 10-RESEARCH.md Environment
 * Availability) — real presigned PUTs, real `HeadObject`/`CopyObject`/
 * `DeleteObject` calls, no mocked S3 client anywhere in this file.
 *
 * No prior test in this codebase exercises `storage-service.ts` against a
 * real object store — `tests/lesson-resource-service.test.ts` and
 * `tests/storage-upload-service.test.ts` both drive it with an in-memory
 * fake or a mocked `S3Client`. This file establishes that real-MinIO path,
 * reusing `storage-service.ts`'s own exported functions (never a
 * reimplementation) with the exact `S3_*` env vars it already reads.
 *
 * ENV-VAR-BEFORE-IMPORT HAZARD: `storage-service.ts` constructs its module-
 * scoped `S3Client` from `process.env.S3_*` the FIRST time the module is
 * evaluated. A static top-level `import` of `submission-service.ts` (which
 * itself statically imports `storage-service.ts`) would therefore lock the
 * client to whatever `S3_*` values happened to be set (or unset) at that
 * instant — before this file's own `process.env.S3_*` assignments below ever
 * ran, because static imports are hoisted and evaluated before any of this
 * module's own top-level statements (the same hazard
 * `tests/storage-upload-service.test.ts`'s header documents for its mocked
 * client). This file therefore sets every `S3_*` var FIRST, then reaches
 * `submission-service.ts`/`storage-service.ts` only through a dynamic
 * `await import(...)` — see `tests/learner-journey.integration.test.ts`'s
 * header for the identical technique applied to `DATABASE_URL`.
 *
 * The port below (9002, not the 9000 `storage-service.ts`'s own
 * `.env.example` documents) is this environment's actual published MinIO
 * port — verified reachable and holding the `lms-private` bucket with the
 * `.env.example` placeholder credentials before writing this file.
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails with
 * a container-start error and every case reports BLOCKED — never a silent
 * pass, never a weakened mock (mirrors
 * `tests/attendance-service.integration.test.ts`'s header discipline).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { seedCohortFixture, seedEnrolmentFixture } from "./support/cohort-fixtures";
import type {
  SubmissionDelegate,
  SubmissionStore,
  SubmissionStorage,
  SubmissionTxClient,
} from "@/server/services/submission-service";

process.env.S3_BUCKET = "lms-private";
process.env.S3_ENDPOINT = "http://localhost:9002";
process.env.S3_PUBLIC_ENDPOINT = "http://localhost:9002";
process.env.S3_ACCESS_KEY_ID = "lms-minio";
process.env.S3_SECRET_ACCESS_KEY = "change-me-minio";
process.env.S3_FORCE_PATH_STYLE = "true";
process.env.S3_REGION = "us-east-1";

const {
  createSubmissionService,
  SubmissionNotAllowedError,
  SubmissionConstraintError,
  SubmissionUploadValidationError,
} = await import("@/server/services/submission-service");
const {
  buildStagedSubmissionStorageKey,
  finalSubmissionKeyFor,
  presignLessonUploadUrl,
  presignLessonObjectUrl,
  inspectLessonObject,
  promoteLessonObject,
  deleteLessonObject,
} = await import("@/server/services/storage-service");
const { writeDomainEvent } = await import("@/server/services/domain-event-service");

let testDb: TestDatabase;

type Svc = ReturnType<typeof createSubmissionService>;

const storage: SubmissionStorage = {
  presign: (input) => presignLessonUploadUrl(input),
  inspect: async (key) => {
    const result = await inspectLessonObject(key);
    return { sizeBytes: Number(result.sizeBytes), contentType: result.contentType };
  },
  promote: (input) => promoteLessonObject(input),
  remove: (key) => deleteLessonObject(key),
  stagedKey: (input) => buildStagedSubmissionStorageKey(input),
  finalKey: (stagedKey) => finalSubmissionKeyFor(stagedKey),
};

/**
 * `createSubmissionService`'s default live binding is bound to the app's
 * singleton `@/server/db` prisma client and writes audit rows through
 * `recordAudit` (also app-prisma-bound). Every call site here injects
 * `testDb.prisma`-bound delegates/audit explicitly, mirroring
 * `tests/attendance-service.integration.test.ts`'s `serviceWithGrants`.
 */
function buildService(): Svc {
  return createSubmissionService({
    delegate: testDb.prisma.submission as unknown as SubmissionDelegate,
    resolveAssessment: (assessmentId) =>
      testDb.prisma.assessment.findUnique({
        where: { id: assessmentId },
        select: {
          id: true,
          courseId: true,
          type: true,
          status: true,
          version: true,
          dueAt: true,
          availableUntil: true,
          allowedFileTypes: true,
          maxFileSizeBytes: true,
          allowResubmission: true,
        },
      }) as never,
    store: testDb.prisma as unknown as SubmissionStore,
    storage,
    presignDownload: (input) =>
      presignLessonObjectUrl({
        key: input.key,
        lessonType: "ASSIGNMENT",
        filename: input.filename,
        contentType: input.mimeType,
      }),
    audit: async (entry) => {
      await testDb.prisma.auditEvent.create({
        data: {
          actorId: entry.actorId,
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId,
          before: (entry.before ?? undefined) as never,
          after: (entry.after ?? undefined) as never,
          reason: entry.reason ?? null,
          outcome: entry.outcome,
        },
      });
    },
    writeEvent: writeDomainEvent,
    runInTransaction: (fn) =>
      testDb.prisma.$transaction((tx) => fn(tx as unknown as SubmissionTxClient)),
  });
}

beforeAll(async () => {
  testDb = await startTestDatabase();
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

/**
 * A published ASSIGNMENT Assessment accepting only `.pdf`, plus one ACTIVE
 * enrolment covering its course. `dueAt`/`availableUntil` default a day/two
 * days out so the happy-path cases are never accidentally late or closed;
 * individual cases override either to exercise the window rules.
 */
async function seedAssignmentFixture(overrides: Record<string, unknown> = {}) {
  const { cohortId, courseId } = await seedCohortFixture(testDb.prisma);
  const { enrolmentId, userId } = await seedEnrolmentFixture(testDb.prisma, { cohortId });
  const now = Date.now();
  const assessment = await testDb.prisma.assessment.create({
    data: {
      courseId,
      type: "ASSIGNMENT",
      title: "Fixture Assignment",
      status: "PUBLISHED",
      version: 1,
      allowedFileTypes: ["pdf"],
      maxFileSizeBytes: 5_000_000,
      allowResubmission: false,
      dueAt: new Date(now + 24 * 3_600_000),
      availableUntil: new Date(now + 48 * 3_600_000),
      ...overrides,
    },
    select: { id: true },
  });
  return { courseId, cohortId, assessmentId: assessment.id, enrolmentId, userId };
}

/** A real PUT of `bytes` to a presigned upload URL — never a mocked fetch. */
async function putBytes(url: string, bytes: Buffer, contentType: string): Promise<void> {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: bytes,
  });
  if (!res.ok) {
    throw new Error(`PUT failed: ${res.status} ${res.statusText} ${await res.text()}`);
  }
}

describe("submission upload pipeline — real Postgres + real MinIO (ASM-04)", () => {
  it("happy path: real bytes verified and promoted, exactly one submission.created event and one upload_completed audit row", async () => {
    const fixture = await seedAssignmentFixture();
    const svc = buildService();
    const actor = { userId: fixture.userId };

    const begun = await svc.beginSubmissionUpload(actor, {
      assessmentId: fixture.assessmentId,
      filename: "essay.pdf",
      mimeType: "application/pdf",
      sizeBytes: 42,
    });
    expect(begun.isLate).toBe(false);
    expect(begun.attemptNumber).toBe(1);
    expect(begun.stagedKey.startsWith("submission-uploads/")).toBe(true);

    await putBytes(begun.uploadUrl, Buffer.alloc(42, 7), "application/pdf");

    const receipt = await svc.completeSubmissionUpload(actor, { submissionId: begun.submissionId });
    expect(receipt.uploadStatus).toBe("READY");
    expect(receipt.receiptId).toBeTruthy();

    const row = await testDb.prisma.submission.findUniqueOrThrow({ where: { id: begun.submissionId } });
    expect(row.uploadStatus).toBe("READY");
    expect(row.storageKey.startsWith("submissions/")).toBe(true);

    // The final object is really there; the staged object is really gone.
    const head = await inspectLessonObject(row.storageKey);
    expect(head.sizeBytes).toBe(BigInt(42));
    await expect(inspectLessonObject(begun.stagedKey)).rejects.toThrow();

    const events = await testDb.prisma.domainEvent.findMany({ where: { type: "submission.created" } });
    const ownEvents = events.filter(
      (e) => (e.payload as Record<string, unknown>).submissionId === begun.submissionId,
    );
    expect(ownEvents).toHaveLength(1);

    const audits = await testDb.prisma.auditEvent.findMany({
      where: { action: "submission.upload_completed", targetId: begun.submissionId },
    });
    expect(audits).toHaveLength(1);
  });

  it("never false success: completing without ever PUTting throws, leaves the row ERROR, writes no final object and no submission.created event", async () => {
    const fixture = await seedAssignmentFixture();
    const svc = buildService();
    const actor = { userId: fixture.userId };

    const begun = await svc.beginSubmissionUpload(actor, {
      assessmentId: fixture.assessmentId,
      filename: "essay.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
    });

    await expect(
      svc.completeSubmissionUpload(actor, { submissionId: begun.submissionId }),
    ).rejects.toBeInstanceOf(SubmissionUploadValidationError);

    const row = await testDb.prisma.submission.findUniqueOrThrow({ where: { id: begun.submissionId } });
    expect(row.uploadStatus).toBe("ERROR");

    const finalKey = finalSubmissionKeyFor(begun.stagedKey);
    await expect(inspectLessonObject(finalKey)).rejects.toThrow();

    const events = await testDb.prisma.domainEvent.findMany({ where: { type: "submission.created" } });
    expect(
      events.some((e) => (e.payload as Record<string, unknown>).submissionId === begun.submissionId),
    ).toBe(false);
  });

  it("PUTting a byte count that differs from the declared sizeBytes yields the same ERROR outcome and cleans up the staged object", async () => {
    const fixture = await seedAssignmentFixture();
    const svc = buildService();
    const actor = { userId: fixture.userId };

    const begun = await svc.beginSubmissionUpload(actor, {
      assessmentId: fixture.assessmentId,
      filename: "essay.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
    });
    await putBytes(begun.uploadUrl, Buffer.alloc(50, 1), "application/pdf");

    await expect(
      svc.completeSubmissionUpload(actor, { submissionId: begun.submissionId }),
    ).rejects.toBeInstanceOf(SubmissionUploadValidationError);

    const row = await testDb.prisma.submission.findUniqueOrThrow({ where: { id: begun.submissionId } });
    expect(row.uploadStatus).toBe("ERROR");
    await expect(inspectLessonObject(begun.stagedKey)).rejects.toThrow();
  });

  it("PUTting a content type that differs from the declared mimeType yields the same ERROR outcome", async () => {
    const fixture = await seedAssignmentFixture();
    const svc = buildService();
    const actor = { userId: fixture.userId };

    const begun = await svc.beginSubmissionUpload(actor, {
      assessmentId: fixture.assessmentId,
      filename: "essay.pdf",
      mimeType: "application/pdf",
      sizeBytes: 20,
    });
    // The presigned PUT URL signs only `host` (verified against this
    // environment's real MinIO before writing this test) — a mismatched
    // Content-Type header is accepted by the store, which is exactly what
    // makes this app-level verification load-bearing rather than redundant
    // with S3's own signature check.
    await putBytes(begun.uploadUrl, Buffer.alloc(20, 1), "text/plain");

    await expect(
      svc.completeSubmissionUpload(actor, { submissionId: begun.submissionId }),
    ).rejects.toBeInstanceOf(SubmissionUploadValidationError);

    const row = await testDb.prisma.submission.findUniqueOrThrow({ where: { id: begun.submissionId } });
    expect(row.uploadStatus).toBe("ERROR");
  });

  it("refuses a .docx filename against allowedFileTypes: ['pdf'] before any presigned url is issued", async () => {
    const fixture = await seedAssignmentFixture();
    const svc = buildService();
    const actor = { userId: fixture.userId };

    await expect(
      svc.beginSubmissionUpload(actor, {
        assessmentId: fixture.assessmentId,
        filename: "essay.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: 10,
      }),
    ).rejects.toBeInstanceOf(SubmissionConstraintError);

    const count = await testDb.prisma.submission.count({
      where: { assessmentId: fixture.assessmentId, enrolmentId: fixture.enrolmentId },
    });
    expect(count).toBe(0);
  });

  it("refuses a sizeBytes above maxFileSizeBytes before any presigned url is issued", async () => {
    const fixture = await seedAssignmentFixture({ maxFileSizeBytes: 1000 });
    const svc = buildService();
    const actor = { userId: fixture.userId };

    await expect(
      svc.beginSubmissionUpload(actor, {
        assessmentId: fixture.assessmentId,
        filename: "essay.pdf",
        mimeType: "application/pdf",
        sizeBytes: 5000,
      }),
    ).rejects.toBeInstanceOf(SubmissionConstraintError);

    const count = await testDb.prisma.submission.count({
      where: { assessmentId: fixture.assessmentId, enrolmentId: fixture.enrolmentId },
    });
    expect(count).toBe(0);
  });

  it("a submission begun after dueAt but before availableUntil persists isLate: true and still reaches READY", async () => {
    const now = Date.now();
    const fixture = await seedAssignmentFixture({
      dueAt: new Date(now - 3_600_000),
      availableUntil: new Date(now + 3_600_000),
    });
    const svc = buildService();
    const actor = { userId: fixture.userId };

    const begun = await svc.beginSubmissionUpload(actor, {
      assessmentId: fixture.assessmentId,
      filename: "essay.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12,
    });
    expect(begun.isLate).toBe(true);

    await putBytes(begun.uploadUrl, Buffer.alloc(12, 2), "application/pdf");
    const receipt = await svc.completeSubmissionUpload(actor, { submissionId: begun.submissionId });
    expect(receipt.uploadStatus).toBe("READY");
    expect(receipt.isLate).toBe(true);
  });

  it("a submission begun after availableUntil is refused", async () => {
    const now = Date.now();
    const fixture = await seedAssignmentFixture({ availableUntil: new Date(now - 3_600_000) });
    const svc = buildService();
    const actor = { userId: fixture.userId };

    await expect(
      svc.beginSubmissionUpload(actor, {
        assessmentId: fixture.assessmentId,
        filename: "essay.pdf",
        mimeType: "application/pdf",
        sizeBytes: 12,
      }),
    ).rejects.toBeInstanceOf(SubmissionNotAllowedError);
  });

  it("resubmission with allowResubmission:true persists attemptNumber 2, keeps the first row's receiptId/storageKey byte-identical, and both final objects exist", async () => {
    const fixture = await seedAssignmentFixture({ allowResubmission: true });
    const svc = buildService();
    const actor = { userId: fixture.userId };

    const first = await svc.beginSubmissionUpload(actor, {
      assessmentId: fixture.assessmentId,
      filename: "essay-v1.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
    });
    await putBytes(first.uploadUrl, Buffer.alloc(10, 3), "application/pdf");
    const firstReceipt = await svc.completeSubmissionUpload(actor, { submissionId: first.submissionId });
    const firstRowBefore = await testDb.prisma.submission.findUniqueOrThrow({ where: { id: first.submissionId } });

    const second = await svc.beginSubmissionUpload(actor, {
      assessmentId: fixture.assessmentId,
      filename: "essay-v2.pdf",
      mimeType: "application/pdf",
      sizeBytes: 11,
    });
    expect(second.attemptNumber).toBe(2);
    await putBytes(second.uploadUrl, Buffer.alloc(11, 4), "application/pdf");
    await svc.completeSubmissionUpload(actor, { submissionId: second.submissionId });

    const firstRowAfter = await testDb.prisma.submission.findUniqueOrThrow({ where: { id: first.submissionId } });
    expect(firstRowAfter.receiptId).toBe(firstReceipt.receiptId);
    expect(firstRowAfter.storageKey).toBe(firstRowBefore.storageKey);

    await expect(inspectLessonObject(firstRowAfter.storageKey)).resolves.toBeTruthy();
    const secondRow = await testDb.prisma.submission.findUniqueOrThrow({ where: { id: second.submissionId } });
    await expect(inspectLessonObject(secondRow.storageKey)).resolves.toBeTruthy();
  });

  it("a concurrent duplicate begin for the same enrolment/assessment is rejected by the unique constraint, never creating two rows sharing attemptNumber 1", async () => {
    const fixture = await seedAssignmentFixture();
    const svc = buildService();
    const actor = { userId: fixture.userId };

    const results = await Promise.allSettled([
      svc.beginSubmissionUpload(actor, {
        assessmentId: fixture.assessmentId,
        filename: "a.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
      }),
      svc.beginSubmissionUpload(actor, {
        assessmentId: fixture.assessmentId,
        filename: "b.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
      }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

    const rows = await testDb.prisma.submission.findMany({
      where: { assessmentId: fixture.assessmentId, enrolmentId: fixture.enrolmentId, attemptNumber: 1 },
    });
    expect(rows).toHaveLength(1);
  });

  it("the staged and final keys both contain the enrolment and assessment ids and differ only in their prefix", () => {
    const enrolmentId = "enr-xyz";
    const assessmentId = "asm-abc";
    const staged = buildStagedSubmissionStorageKey({ enrolmentId, assessmentId });
    const final = finalSubmissionKeyFor(staged);

    expect(staged).toContain(enrolmentId);
    expect(staged).toContain(assessmentId);
    expect(staged.startsWith("submission-uploads/")).toBe(true);
    expect(final).toBe(staged.replace(/^submission-uploads\//, "submissions/"));
  });
});
