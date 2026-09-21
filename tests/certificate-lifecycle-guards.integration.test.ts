/**
 * Real-Postgres proof for the certificate lifecycle guards CR-03, CR-04 and
 * CR-06 (plan 11-32 Task 2).
 *
 * The unit suites drive these rules against in-memory fakes. A fake cannot prove
 * what only Postgres arbitrates: that a refused issuance leaves the caller's
 * OWN transaction committable (no IllegalTransitionError aborting it), that a
 * revoked credential survives a lesson undo and redo with real rows, that
 * Reissue works from real REVOKED rows including the legacy two-REVOKED state,
 * and that the widened partial unique index
 * `enrolment_one_live_per_learner_cohort` (migration
 * 20260919120000) makes a duplicate live enrolment impossible while the revoke
 * and flag reversals (COMPLETED -> ACTIVE) still succeed.
 *
 * PRE-FIX FAILURE MODES (cited from the earlier plans' SUMMARYs; this file
 * cannot compile against the pre-fix tree because the `not-eligible` and
 * `revoked-blocked` outcomes do not exist there):
 *   - CR-03 (plan 11-25): a WITHDRAWN or PENDING_PAYMENT enrolment satisfying an
 *     AUTOMATIC award made `assertTransition(x, "COMPLETED")` throw
 *     `IllegalTransitionError` inside the caller's transaction; the pending
 *     queue listed those enrolments. 12 unit failures recorded against pre-fix
 *     source.
 *   - CR-04 (plan 11-25): undo then redo of a lesson after a revoke issued a NEW
 *     ACTIVE certificate and returned the enrolment to COMPLETED; the legacy
 *     two-REVOKED Reissue dead-ended. 9 unit failures recorded, and the
 *     supersede-all step was shown load-bearing (neutralising STEP 1b failed
 *     only the legacy two-REVOKED test).
 *   - CR-06 (plan 11-27): with the old index (`WHERE status = 'ACTIVE'`) a second
 *     ACTIVE enrolment could be created next to a COMPLETED one and the later
 *     revoke / flag reversal then failed with P2002. 6 of 10 real-Postgres
 *     tests failed without the migration.
 *
 * SAFETY (T-11-134): a throwaway Testcontainers Postgres; `DATABASE_URL` is set
 * to the container URL in `beforeAll` before any dynamic import and asserted.
 * The `.env` database is never contacted. PDFs are irrelevant here (issuance
 * is database-only since plan 11-30), so no object storage is exercised and the
 * post-commit settle is a no-op.
 *
 * ENV-VAR-BEFORE-IMPORT HAZARD: same discipline as
 * tests/certificate-concurrency.integration.test.ts. `S3_*` is set at top level
 * (the services import storage-service transitively), `DATABASE_URL` in
 * `beforeAll`, all app imports are dynamic.
 *
 * PREREQUISITE: Docker running; otherwise the hooks fail (BLOCKED), never pass.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";
import { seedCohortFixture, seedEnrolmentFixture } from "./support/cohort-fixtures";
import { createTestWithPermission, grant } from "./support/harness";
import { parseCertificateTemplateLayout, EMPTY_LAYOUT_V1 } from "@/server/services/certificate-template-layout";
import type {
  CertificateIssuanceTxClient,
  IssueCertificateDeps,
} from "@/server/services/certificate-issuance-service";
import type {
  CertificateServiceTxClient,
  PendingIssuanceStore,
} from "@/server/services/certificate-service";
import type { CompletionScopeResult } from "@/server/services/completion-service";

process.env.S3_BUCKET = "lms-private";
process.env.S3_ENDPOINT = "http://localhost:9002";
process.env.S3_PUBLIC_ENDPOINT = "http://localhost:9002";
process.env.S3_ACCESS_KEY_ID = "lms-minio";
process.env.S3_SECRET_ACCESS_KEY = "change-me-minio";
process.env.S3_FORCE_PATH_STYLE = "true";
process.env.S3_REGION = "us-east-1";

let testDb: TestDatabase;
let staffUserId: string;
let issueCertificateForEnrolment: typeof import("@/server/services/certificate-issuance-service")["issueCertificateForEnrolment"];
let reactToCompletionResults: typeof import("@/server/services/certificate-issuance-service")["reactToCompletionResults"];
let flagCertificateForReview: typeof import("@/server/services/certificate-issuance-service")["flagCertificateForReview"];
let liveIssuanceDeps: IssueCertificateDeps;
let service: ReturnType<typeof import("@/server/services/certificate-service")["createCertificateService"]>;

beforeAll(async () => {
  testDb = await startTestDatabase();

  // MUST happen before any dynamic import below — see file header.
  process.env.DATABASE_URL = testDb.url;
  expect(process.env.DATABASE_URL).toBe(testDb.url);

  const issuance = await import("@/server/services/certificate-issuance-service");
  issueCertificateForEnrolment = issuance.issueCertificateForEnrolment;
  reactToCompletionResults = issuance.reactToCompletionResults;
  flagCertificateForReview = issuance.flagCertificateForReview;
  liveIssuanceDeps = issuance.liveIssuanceDeps;

  const certificateServiceModule = await import("@/server/services/certificate-service");
  const domainEvents = await import("@/server/services/domain-event-service");

  const staff = await testDb.prisma.user.create({
    data: { email: "lifecycle-staff@fixture.test", name: "Lifecycle Staff", status: "ACTIVE" },
    select: { id: true },
  });
  staffUserId = staff.id;

  // A permissive withPermission (GLOBAL grants), acting as the real staff user.
  const { withPermission } = createTestWithPermission(
    [grant("certificates.view", "GLOBAL"), grant("certificates.issue", "GLOBAL"), grant("certificates.revoke", "GLOBAL")],
    { userId: staffUserId },
  );

  service = certificateServiceModule.createCertificateService({
    delegate: testDb.prisma.certificate as never,
    withPermission,
    audit: async () => {},
    enrolmentScope: async () => ({}),
    pendingStore: {
      completionRecord: testDb.prisma.completionRecord as unknown as PendingIssuanceStore["completionRecord"],
      certificate: testDb.prisma.certificate as unknown as PendingIssuanceStore["certificate"],
    },
    auditStore: { auditEvent: testDb.prisma.auditEvent as never },
    // Real transactions over the container client, so rollback semantics are genuine.
    runInTransaction: (fn) => testDb.prisma.$transaction((tx) => fn(tx as unknown as CertificateServiceTxClient)),
    issuanceDeps: liveIssuanceDeps,
    writeEvent: domainEvents.writeDomainEvent,
    // The file step is out of scope for this file (lifecycle state only).
    settle: async () => {},
  });
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.stop();
}, TEST_DB_TIMEOUT_MS);

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

let counter = 0;
function uniq(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}-${Date.now()}`;
}

const LAYOUT = parseCertificateTemplateLayout(EMPTY_LAYOUT_V1);
const REVOKE_REASON = "Misconduct confirmed by the review panel";
const REISSUE_REASON = "Reinstated after the appeal was upheld";

async function seedEnrolment(input: {
  mode: "AUTOMATIC" | "MANUAL";
  status?: string;
  withCompletion?: boolean;
}) {
  const template = await testDb.prisma.certificateTemplate.create({
    data: { name: uniq("Lifecycle Template"), layout: LAYOUT as never, isDefault: false },
    select: { id: true },
  });
  const course = await testDb.prisma.course.create({
    data: {
      slug: uniq("lifecycle-course"),
      title: "Lifecycle Course",
      certificateEnabled: true,
      certificateIssuanceMode: input.mode,
      certificateTemplateId: template.id,
    },
    select: { id: true },
  });
  const { cohortId } = await seedCohortFixture(testDb.prisma, { courseId: course.id });
  const { enrolmentId, userId } = await seedEnrolmentFixture(testDb.prisma, {
    cohortId,
    status: input.status ?? "ACTIVE",
  });
  if (input.withCompletion !== false) {
    await testDb.prisma.completionRecord.create({
      data: { enrolmentId, scope: "COURSE", courseId: course.id, ruleVersion: 1, completedAt: new Date() },
    });
  }
  return { enrolmentId, userId, cohortId, courseId: course.id };
}

const createdResult = (courseId: string): CompletionScopeResult => ({
  scope: "COURSE",
  courseId,
  verdict: { satisfied: true } as never,
  action: "created",
});
const supersededResult = (courseId: string): CompletionScopeResult => ({
  scope: "COURSE",
  courseId,
  verdict: { satisfied: false } as never,
  action: "superseded",
});

/** Runs `fn` in a real transaction, the way a caller's write does. */
function inTransaction<R>(fn: (tx: CertificateIssuanceTxClient) => Promise<R>): Promise<R> {
  return testDb.prisma.$transaction((tx) => fn(tx as unknown as CertificateIssuanceTxClient));
}

function issueSystem(enrolmentId: string) {
  return inTransaction((tx) =>
    issueCertificateForEnrolment(tx, { enrolmentId, scope: "COURSE", now: new Date(), actor: null }, liveIssuanceDeps),
  );
}

async function enrolmentStatus(enrolmentId: string): Promise<string> {
  return (await testDb.prisma.enrolment.findUniqueOrThrow({ where: { id: enrolmentId } })).status;
}

async function certificatesFor(enrolmentId: string) {
  return testDb.prisma.certificate.findMany({ where: { enrolmentId }, orderBy: { issuedAt: "asc" } });
}

async function liveEnrolmentCount(userId: string, cohortId: string): Promise<number> {
  return testDb.prisma.enrolment.count({
    where: { userId, cohortId, status: { in: ["ACTIVE", "COMPLETED"] } },
  });
}

async function errorCodeOf(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (err) {
    return (err as { code?: string }).code ?? `no-code:${String(err)}`;
  }
}

// ---------------------------------------------------------------------------
// CR-03 — ineligible enrolments
// ---------------------------------------------------------------------------

describe("CR-03: an enrolment that cannot hold a certificate is refused without breaking the caller's write (real Postgres)", () => {
  it.each(["WITHDRAWN", "PENDING_PAYMENT"])(
    "%s enrolment satisfying an AUTOMATIC award: reactToCompletionResults resolves, creates no certificate, leaves the status, and the transaction's other write commits",
    async (status) => {
      const { enrolmentId, courseId } = await seedEnrolment({ mode: "AUTOMATIC", status });
      const markerType = uniq("test.caller-write");

      await inTransaction(async (tx) => {
        // The caller's own write, in the same transaction.
        await tx.domainEvent.create({
          data: { type: markerType, payload: { enrolmentId } as never, occurredAt: new Date() },
        });
        // Pre-fix this threw IllegalTransitionError and aborted the whole transaction.
        await reactToCompletionResults(
          tx,
          { enrolmentId, results: [createdResult(courseId)], now: new Date() },
          liveIssuanceDeps,
        );
      });

      expect(await certificatesFor(enrolmentId)).toHaveLength(0);
      expect(await enrolmentStatus(enrolmentId)).toBe(status);
      expect(await testDb.prisma.domainEvent.count({ where: { type: markerType } })).toBe(1);
    },
    TEST_DB_TIMEOUT_MS,
  );

  it.each(["WITHDRAWN", "PENDING_PAYMENT"])(
    "%s enrolment: issueCertificateForEnrolment returns the typed not-eligible outcome and writes nothing",
    async (status) => {
      const { enrolmentId } = await seedEnrolment({ mode: "AUTOMATIC", status });
      const outcome = await issueSystem(enrolmentId);
      expect(outcome).toEqual({ kind: "not-eligible" });
      expect(await certificatesFor(enrolmentId)).toHaveLength(0);
      expect(await enrolmentStatus(enrolmentId)).toBe(status);
    },
    TEST_DB_TIMEOUT_MS,
  );

  it("manual queue: with a satisfied completion record, an ACTIVE enrolment is listed and a WITHDRAWN one is omitted", async () => {
    const active = await seedEnrolment({ mode: "MANUAL", status: "ACTIVE" });
    const withdrawn = await seedEnrolment({ mode: "MANUAL", status: "WITHDRAWN" });

    const queue = await service.listPendingIssuance();
    const ids = queue.map((row) => row.enrolmentId);
    expect(ids).toContain(active.enrolmentId);
    expect(ids).not.toContain(withdrawn.enrolmentId);
  }, TEST_DB_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// CR-04 — a revoked credential is never re-issued by automation
// ---------------------------------------------------------------------------

describe("CR-04: revoke, undo/redo and Reissue (real Postgres)", () => {
  it("issue -> revoke -> undo -> redo leaves ONE REVOKED certificate and an ACTIVE enrolment; only staff Reissue restores COMPLETED with exactly one ACTIVE certificate", async () => {
    const { enrolmentId, courseId } = await seedEnrolment({ mode: "AUTOMATIC" });

    // Issue: an ACTIVE certificate and a COMPLETED enrolment.
    const issued = await issueSystem(enrolmentId);
    expect(issued.kind).toBe("issued");
    if (issued.kind !== "issued") return;
    expect(await enrolmentStatus(enrolmentId)).toBe("COMPLETED");

    // Revoke through the real service.
    const revoked = await service.revokeCertificate({ certificateId: issued.certificateId, reason: REVOKE_REASON });
    expect(revoked.status).toBe("REVOKED");
    expect(await enrolmentStatus(enrolmentId)).toBe("ACTIVE");

    // Undo (completion superseded) then redo (completion created), as a learner
    // un-completing and re-completing a lesson would, on an AUTOMATIC course.
    await inTransaction((tx) =>
      reactToCompletionResults(
        tx,
        { enrolmentId, results: [supersededResult(courseId)], now: new Date() },
        liveIssuanceDeps,
      ),
    );
    await inTransaction((tx) =>
      reactToCompletionResults(
        tx,
        { enrolmentId, results: [createdResult(courseId)], now: new Date() },
        liveIssuanceDeps,
      ),
    );

    // Pre-fix: a NEW ACTIVE certificate appeared and the enrolment went back to COMPLETED.
    const afterRedo = await certificatesFor(enrolmentId);
    expect(afterRedo).toHaveLength(1);
    expect(afterRedo[0].id).toBe(issued.certificateId);
    expect(afterRedo[0].status).toBe("REVOKED");
    expect(afterRedo.filter((c) => c.status === "ACTIVE")).toHaveLength(0);
    expect(await enrolmentStatus(enrolmentId)).toBe("ACTIVE");

    // The issuance function itself refuses for every actor.
    expect(await issueSystem(enrolmentId)).toEqual({ kind: "revoked-blocked" });
    const staffAttempt = await inTransaction((tx) =>
      issueCertificateForEnrolment(
        tx,
        { enrolmentId, scope: "COURSE", now: new Date(), actor: { userId: staffUserId } },
        liveIssuanceDeps,
      ),
    );
    expect(staffAttempt).toEqual({ kind: "revoked-blocked" });

    // Staff Reissue is the only way back.
    const reissued = await service.reissueCertificate({ certificateId: issued.certificateId, reason: REISSUE_REASON });
    expect(reissued.status).toBe("ACTIVE");
    expect(reissued.supersedesId).toBe(issued.certificateId);
    expect(reissued.id).not.toBe(issued.certificateId);

    const finalRows = await certificatesFor(enrolmentId);
    expect(finalRows).toHaveLength(2);
    expect(finalRows.filter((c) => c.status === "ACTIVE")).toHaveLength(1);
    expect(finalRows.find((c) => c.id === issued.certificateId)?.status).toBe("SUPERSEDED");
    expect(await enrolmentStatus(enrolmentId)).toBe("COMPLETED");
  }, TEST_DB_TIMEOUT_MS);

  it("MANUAL course: a revoked enrolment is not listed in the queue and manual issue is blocked (revoked-blocked)", async () => {
    const { enrolmentId } = await seedEnrolment({ mode: "MANUAL" });

    // Listed before anything is issued.
    expect((await service.listPendingIssuance()).map((r) => r.enrolmentId)).toContain(enrolmentId);

    const issued = await service.issueCertificateManually({ enrolmentId, scope: "COURSE" });
    expect(issued.kind).toBe("issued");
    if (issued.kind !== "issued") return;
    expect((await service.listPendingIssuance()).map((r) => r.enrolmentId)).not.toContain(enrolmentId);

    await service.revokeCertificate({ certificateId: issued.certificateId, reason: REVOKE_REASON });
    expect(await enrolmentStatus(enrolmentId)).toBe("ACTIVE");

    // The revoked enrolment does not reappear in the queue, and a stale
    // manual-queue click cannot replace the revoked credential.
    expect((await service.listPendingIssuance()).map((r) => r.enrolmentId)).not.toContain(enrolmentId);
    const again = await service.issueCertificateManually({ enrolmentId, scope: "COURSE" });
    expect(again).toEqual({ kind: "revoked-blocked" });
    expect(await certificatesFor(enrolmentId)).toHaveLength(1);
  }, TEST_DB_TIMEOUT_MS);

  it("flag path guard: flagging an enrolment that holds only a REVOKED certificate is a no-op (nothing ACTIVE to flag)", async () => {
    const { enrolmentId } = await seedEnrolment({ mode: "AUTOMATIC" });
    const issued = await issueSystem(enrolmentId);
    if (issued.kind !== "issued") throw new Error("fixture issuance failed");
    await service.revokeCertificate({ certificateId: issued.certificateId, reason: REVOKE_REASON });

    await inTransaction((tx) =>
      flagCertificateForReview(
        tx,
        { enrolmentId, now: new Date(), reason: "completion superseded", actorId: null },
        liveIssuanceDeps,
      ),
    );

    const [row] = await certificatesFor(enrolmentId);
    expect(row.status).toBe("REVOKED");
    expect(row.reviewFlaggedAt).toBeNull();
    expect(await enrolmentStatus(enrolmentId)).toBe("ACTIVE");
    expect(
      await testDb.prisma.auditEvent.count({
        where: { action: "certificate.review_flagged", targetId: issued.certificateId },
      }),
    ).toBe(0);
  }, TEST_DB_TIMEOUT_MS);

  it("legacy two-REVOKED state: Reissue from one row supersedes BOTH, creates exactly one ACTIVE row linked to it, and restores COMPLETED", async () => {
    const { enrolmentId, userId, courseId } = await seedEnrolment({ mode: "AUTOMATIC" });

    // The state today's CR-04 bug could leave behind: revoke A, automation
    // issues B, revoke B. Seeded directly; the enrolment sits at ACTIVE.
    const seedRevoked = (label: string, offsetMs: number) =>
      testDb.prisma.certificate.create({
        data: {
          enrolmentId,
          userId,
          scope: "COURSE",
          courseId,
          awardTitle: "Lifecycle Course",
          learnerName: "Legacy Learner",
          issuedAt: new Date(Date.now() - offsetMs),
          status: "REVOKED",
          verificationRef: uniq(`legacy-${label}`),
          storageKey: null,
          revokedAt: new Date(),
          revokedById: staffUserId,
          revocationReason: "Legacy revocation kept for the reissue proof",
        },
      });
    const a = await seedRevoked("a", 20_000);
    const b = await seedRevoked("b", 10_000);
    expect(await enrolmentStatus(enrolmentId)).toBe("ACTIVE");

    // Without the supersede-all-REVOKED step this ends in revoked-blocked and rolls back.
    const reissued = await service.reissueCertificate({ certificateId: b.id, reason: REISSUE_REASON });

    expect(reissued.status).toBe("ACTIVE");
    expect(reissued.supersedesId).toBe(b.id);
    const rows = await certificatesFor(enrolmentId);
    expect(rows).toHaveLength(3);
    expect(rows.filter((c) => c.status === "ACTIVE")).toHaveLength(1);
    expect(rows.find((c) => c.id === a.id)?.status).toBe("SUPERSEDED");
    expect(rows.find((c) => c.id === b.id)?.status).toBe("SUPERSEDED");
    expect(await enrolmentStatus(enrolmentId)).toBe("COMPLETED");
  }, TEST_DB_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// CR-06 — one live enrolment per learner and cohort, and reversals still work
// ---------------------------------------------------------------------------

describe("CR-06: a duplicate live enrolment is impossible and the revoke / flag reversals still succeed (real Postgres)", () => {
  it("after issuance a second ACTIVE enrolment for the same learner and cohort fails P2002; revoke succeeds, returns the enrolment to ACTIVE, and the learner keeps exactly one live enrolment", async () => {
    const { enrolmentId, userId, cohortId } = await seedEnrolment({ mode: "AUTOMATIC" });
    const issued = await issueSystem(enrolmentId);
    if (issued.kind !== "issued") throw new Error("fixture issuance failed");
    expect(await enrolmentStatus(enrolmentId)).toBe("COMPLETED");

    // Pre-migration the duplicate insert succeeded, and the reversal below then failed.
    expect(
      await errorCodeOf(() => testDb.prisma.enrolment.create({ data: { cohortId, userId, status: "ACTIVE" } })),
    ).toBe("P2002");

    const revoked = await service.revokeCertificate({ certificateId: issued.certificateId, reason: REVOKE_REASON });
    expect(revoked.status).toBe("REVOKED");
    expect(await enrolmentStatus(enrolmentId)).toBe("ACTIVE");
    expect(await liveEnrolmentCount(userId, cohortId)).toBe(1);

    // Still impossible once the enrolment is back to ACTIVE.
    expect(
      await errorCodeOf(() => testDb.prisma.enrolment.create({ data: { cohortId, userId, status: "ACTIVE" } })),
    ).toBe("P2002");
    expect(await liveEnrolmentCount(userId, cohortId)).toBe(1);
  }, TEST_DB_TIMEOUT_MS);

  it("the CRD-06 review flag reversal (COMPLETED -> ACTIVE) succeeds, keeps the credential ACTIVE and flagged, and leaves exactly one live enrolment", async () => {
    const { enrolmentId, userId, cohortId } = await seedEnrolment({ mode: "AUTOMATIC" });
    const issued = await issueSystem(enrolmentId);
    if (issued.kind !== "issued") throw new Error("fixture issuance failed");

    expect(
      await errorCodeOf(() => testDb.prisma.enrolment.create({ data: { cohortId, userId, status: "ACTIVE" } })),
    ).toBe("P2002");

    await inTransaction((tx) =>
      flagCertificateForReview(
        tx,
        { enrolmentId, now: new Date(), reason: "completion superseded", actorId: null },
        liveIssuanceDeps,
      ),
    );

    const [row] = await certificatesFor(enrolmentId);
    expect(row.status).toBe("ACTIVE");
    expect(row.reviewFlaggedAt).not.toBeNull();
    expect(await enrolmentStatus(enrolmentId)).toBe("ACTIVE");
    expect(await liveEnrolmentCount(userId, cohortId)).toBe(1);
  }, TEST_DB_TIMEOUT_MS);

  it("re-enrolment after WITHDRAWN is still allowed (REG-03 unaffected by the widened index)", async () => {
    const { userId, cohortId } = await seedEnrolment({ mode: "AUTOMATIC", status: "WITHDRAWN", withCompletion: false });
    expect(
      await errorCodeOf(() => testDb.prisma.enrolment.create({ data: { cohortId, userId, status: "ACTIVE" } })),
    ).toBeNull();
    expect(await liveEnrolmentCount(userId, cohortId)).toBe(1);
  }, TEST_DB_TIMEOUT_MS);
});
