/**
 * The staff-facing certificate surface (CRD-01, CRD-02, CRD-03, CRD-05, CRD-06 —
 * D-04's manual queue and D-04/CRD-05's audited mutations).
 *
 * Four concerns, deliberately kept in one file because they share one
 * `toScope` resolver and one transaction-client shape:
 *
 *   1. `certificateService.list`/`.get` — built on `createResourceService`
 *      (`resource-service.ts`), scoped through the certificate's owning
 *      enrolment's cohort (`enrolmentCohortScope`, `cohort-scope.ts`). Only
 *      `list`/`get` are exposed — never the factory's generic `create`,
 *      `update`, or `archive`. Certificates are created only by
 *      `certificate-issuance-service.ts`'s `issueCertificateForEnrolment`
 *      (reactively, or via this file's `issueCertificateManually`) and
 *      mutated only by this file's own `revokeCertificate`/
 *      `reissueCertificate`, both of which need a mandatory-reason and
 *      compare-and-set guard the generic factory does not provide.
 *
 *   2. `listPendingIssuance` — D-04's MANUAL-mode eligibility queue, computed
 *      FRESH at read time (the `readiness-service.ts` discipline: no
 *      denormalized eligibility flag column). D-01 is enforced here too: a
 *      Programme cohort surfaces at most one row (the PROGRAMME-scope
 *      completion record), never one row per member Course, even though
 *      `completion-service.ts` creates an internal COURSE-scope
 *      `CompletionRecord` for every member course. Only enrolments that can
 *      hold a certificate (`CERTIFICATE_ELIGIBLE_ENROLMENT_STATUSES`: ACTIVE
 *      or COMPLETED) are listed — a withdrawn or unpaid learner never is. An
 *      enrolment/scope holding a REVOKED certificate is never listed either:
 *      staff replace a revoked credential through Reissue (CR-04, CRD-05).
 *
 *   3. `getOwnCertificateForDownload` — the learner-side ownership predicate
 *      the download route needs, mirroring `lesson-resource-service.ts`'s
 *      `getDownloadableResourceForLearner`: NOT wrapped in `withPermission`
 *      (granting a learner `certificates.view` would hand them every other
 *      certificate in the school), returns `null` — never throws — for
 *      every denial reason (wrong owner, unknown id, revoked), so the route
 *      renders one indistinguishable 404 (T-11-51).
 *
 *   4. `issueCertificateManually`/`revokeCertificate`/`reissueCertificate` —
 *      audit-first mutations copying `grade-override-service.ts`'s exact
 *      shape: a mandatory 10-trimmed-character reason (revoke/reissue only —
 *      D-04/UI-SPEC §6.1 says issuing is a forward action, not a
 *      correction, and takes none), a compare-and-set `updateMany` guard so
 *      two simultaneous staff actions cannot double-revoke or double-
 *      reissue, and an audit row with before/after carried in the same
 *      transaction as the domain event. `issueCertificateManually` and
 *      `reissueCertificate` both DELEGATE to
 *      `certificate-issuance-service.ts`'s `issueCertificateForEnrolment` —
 *      one issuance implementation, three callers (the reactive path, this
 *      file's manual issue, this file's reissue) — never a second copy of
 *      the render/store/COMPLETED-transition logic.
 *
 * Never deletes, never blanks a preserved field (CAT-08, CRD-05): revoke
 * only flips `status`/sets the revocation fields; reissue only flips the old
 * row's `status` to `SUPERSEDED` and creates a new row linked via
 * `supersedesId` — the old row's `verificationRef`, `issuedAt`,
 * `learnerName`, `awardTitle`, `revocationReason` and `storageKey` are never
 * touched.
 */

import { prisma } from "@/server/db";
import { withPermission as liveWithPermission } from "@/server/permissions";
import type { ResourceScope } from "@/server/permissions/scope";
import type { createWithPermission } from "@/server/permissions/with-permission";
import {
  createResourceService,
  type Delegate,
  type ResourceAuditEntry,
} from "./resource-service";
import { enrolmentCohortScope } from "./cohort-scope";
import { recordAudit } from "./audit-service";
import { writeDomainEvent } from "./domain-event-service";
import { runTransactionThenSettleCertificateFiles } from "./certificate-file-service";
import {
  CERTIFICATE_ELIGIBLE_ENROLMENT_STATUSES,
  issueCertificateForEnrolment,
  liveIssuanceDeps,
  type CertificateIssuanceTxClient,
  type IssueCertificateDeps,
} from "./certificate-issuance-service";
import {
  assertTransition,
  type EnrolmentStatusValue,
} from "./enrolment-transitions";

type WithPermission = ReturnType<typeof createWithPermission>;

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

export type CertificateRow = {
  id: string;
  enrolmentId: string;
  userId: string;
  scope: "COURSE" | "PROGRAMME";
  courseId: string | null;
  programmeId: string | null;
  awardTitle: string;
  learnerName: string;
  issuedAt: Date;
  status: "ACTIVE" | "REVOKED" | "SUPERSEDED";
  storageKey: string | null;
  verificationRef: string;
  revokedAt: Date | null;
  revokedById: string | null;
  revocationReason: string | null;
  supersedesId: string | null;
  reviewFlaggedAt: Date | null;
};

// ---------------------------------------------------------------------------
// certificateDisplayStatus — UI-SPEC §5's four-branch tone precedence.
//
// Re-exported from the pure `src/lib/certificate-display-status.ts` module
// (plan 11-15) rather than defined here, so a `"use client"` table component
// can import the helper directly without pulling this file's server-only
// import graph (Prisma, `withPermission`, `next/headers`) into the browser
// bundle. Every existing `from "@/server/services/certificate-service"`
// import of this helper keeps working unchanged.
// ---------------------------------------------------------------------------

export { certificateDisplayStatus, type CertificateDisplayStatus } from "@/lib/certificate-display-status";

// ---------------------------------------------------------------------------
// Pending-issuance queue (D-04) — read-time evaluator, no denormalized flag.
// ---------------------------------------------------------------------------

export type PendingIssuanceAwardRow = {
  id: string;
  title: string;
  certificateEnabled: boolean;
  certificateIssuanceMode: "AUTOMATIC" | "MANUAL";
};

export type PendingIssuanceCompletionRecordRow = {
  enrolmentId: string;
  scope: "COURSE" | "PROGRAMME";
  completedAt: Date;
  enrolment: {
    userId: string;
    /** Only ACTIVE/COMPLETED enrolments can hold a certificate (CR-03). */
    status: string;
    user: { name: string };
    cohort: {
      courseId: string | null;
      programmeId: string | null;
      course: PendingIssuanceAwardRow | null;
      programme: PendingIssuanceAwardRow | null;
    };
  };
};

/** The narrow read surface `listPendingIssuance` needs — structural, so a
 *  test fake satisfies it without a `@prisma/client` import. */
export type PendingIssuanceStore = {
  completionRecord: {
    findMany(args: {
      where: Record<string, unknown>;
      include?: Record<string, unknown>;
    }): Promise<PendingIssuanceCompletionRecordRow[]>;
  };
  certificate: {
    findMany(args: {
      where: Record<string, unknown>;
    }): Promise<Array<{ enrolmentId: string; scope: "COURSE" | "PROGRAMME" }>>;
  };
};

export type PendingIssuanceRow = {
  enrolmentId: string;
  learnerName: string;
  awardTitle: string;
  /** Plain text per UI-SPEC §7.1 — no icon precedent exists for this distinction. */
  awardType: "Course" | "Programme";
  eligibleSince: Date;
  scope: "COURSE" | "PROGRAMME";
};

// ---------------------------------------------------------------------------
// Errors — same style as `grade-override-service.ts`'s
// `OverrideReasonRequiredError`/`GradeChangedError`.
// ---------------------------------------------------------------------------

export class NoCompletionRecordError extends Error {
  constructor() {
    super(
      "This enrolment has no unsuperseded completion record for that scope — staff can sign off an earned credential, not conjure one.",
    );
    this.name = "NoCompletionRecordError";
  }
}

export class RevocationReasonRequiredError extends Error {
  constructor() {
    super("Explain the correction using at least 10 characters.");
    this.name = "RevocationReasonRequiredError";
  }
}

export class CertificateChangedError extends Error {
  constructor() {
    super("This certificate changed during the correction. Reload it and try again.");
    this.name = "CertificateChangedError";
  }
}

// ---------------------------------------------------------------------------
// Transaction client — a structural superset of `CertificateIssuanceTxClient`
// (certificate-issuance-service.ts) so `revokeCertificate`/
// `reissueCertificate`'s `tx` is assignable straight into
// `issueCertificateForEnrolment` with no cast, while also carrying the two
// extra calls (`certificate.findUnique`, `certificate.updateMany`) this
// file's own compare-and-set mutations need.
// ---------------------------------------------------------------------------

export type CertificateServiceTxClient = CertificateIssuanceTxClient & {
  certificate: {
    findUnique(args: { where: { id: string } }): Promise<CertificateRow | null>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
};

// ---------------------------------------------------------------------------
// Service deps
// ---------------------------------------------------------------------------

/** The narrow read surface `getCertificateIssuer` needs (plan 11-15) — the
 *  `Certificate`'s own `targetType`/`targetId`-keyed issuance audit row,
 *  same "read a record's own history straight off `AuditEvent`" shape
 *  `roster-service.ts` already uses for `Enrolment`, gated by
 *  `certificates.view` rather than the GLOBAL-only `audit.view`. */
export type CertificateAuditStore = {
  auditEvent: {
    findFirst(args: {
      where: Record<string, unknown>;
      orderBy?: Record<string, unknown>;
      select?: Record<string, unknown>;
    }): Promise<{ actorId: string | null; actor: { name: string } | null } | null>;
    /** Batched form used by `listCertificateIssuanceSources` (plan 11-22). */
    findMany(args: {
      where: Record<string, unknown>;
      orderBy?: Record<string, unknown>;
      select?: Record<string, unknown>;
    }): Promise<
      Array<{
        targetId: string;
        actorId: string | null;
        action: string;
        actor: { name: string } | null;
      }>
    >;
  };
};

/** How a certificate came to exist, read from its issuance audit row (plan
 *  11-22, UAT test 8). Name only — never an actor id or email. */
export type IssuanceSource =
  | { kind: "automatic" }
  | { kind: "staff"; actorName: string | null }
  | { kind: "not-recorded" };

export type CertificateIssuerRow = { actorId: string | null; actorName: string | null } | null;

export type CertificateServiceDeps = {
  delegate: Delegate<CertificateRow>;
  withPermission: WithPermission;
  audit: (entry: ResourceAuditEntry) => Promise<void>;
  enrolmentScope: (enrolmentId: string) => Promise<ResourceScope>;
  pendingStore: PendingIssuanceStore;
  auditStore: CertificateAuditStore;
  runInTransaction: <R>(fn: (tx: CertificateServiceTxClient) => Promise<R>) => Promise<R>;
  issuanceDeps: IssueCertificateDeps;
  writeEvent: typeof writeDomainEvent;
  /**
   * CR-01(b), plan 11-31: the post-commit certificate-file step, given the very
   * transaction object issuance registered against. Omitted in production (the
   * live settle, a no-op for a transaction nothing registered against); tests
   * inject a spy or a rejecting fake.
   */
  settle?: (tx: object) => Promise<void>;
  now?: () => Date;
};

export function createCertificateService(deps: CertificateServiceDeps) {
  const now = deps.now ?? (() => new Date());

  /**
   * Runs an ISSUING transaction (manual issue, Reissue) and renders and stores
   * the issued certificate's PDF only after it has committed, in a step that can
   * never fail or roll back the staff action (CR-01b). Wraps the
   * `runInTransaction` this service received, so the live `prisma.$transaction`
   * binding at the bottom of the file needs no change. `revokeCertificate` never
   * issues and stays on plain `deps.runInTransaction`.
   */
  const runSettled = <R>(fn: (tx: CertificateServiceTxClient) => Promise<R>): Promise<R> =>
    runTransactionThenSettleCertificateFiles<CertificateServiceTxClient, R>(
      deps.runInTransaction,
      fn,
      deps.settle,
    );

  /**
   * Resolves a Certificate id to its enrolment's cohort scope — reused by
   * `list`/`get` (via the factory's `toScope`) AND by `revokeCertificate`/
   * `reissueCertificate`, so there is exactly one resolver, not two.
   */
  async function toScope(id: string): Promise<ResourceScope> {
    const row = await deps.delegate.findUnique({ where: { id } });
    if (!row) return {};
    return deps.enrolmentScope(row.enrolmentId);
  }

  // -------------------------------------------------------------------------
  // 1. list/get — built on the CRUD factory, only list/get exposed.
  // -------------------------------------------------------------------------

  const raw = createResourceService<CertificateRow>({
    name: "Certificate",
    delegate: deps.delegate,
    // `create`/`edit` are never exercised through this exported surface —
    // certificates are created only via issuance and mutated only via the
    // explicit revoke/reissue functions below, which carry guards the
    // factory does not provide. These two permissions are supplied only to
    // satisfy the factory's config shape.
    permissions: { view: "certificates.view", create: "certificates.issue", edit: "certificates.revoke" },
    toScope,
    withPermission: deps.withPermission,
    audit: deps.audit,
  });

  const certificateService = { list: raw.list, get: raw.get };

  // -------------------------------------------------------------------------
  // 2. listPendingIssuance — D-04, computed fresh, D-01 applied.
  // -------------------------------------------------------------------------

  async function computePendingIssuance(): Promise<PendingIssuanceRow[]> {
    const records = await deps.pendingStore.completionRecord.findMany({
      where: { supersededAt: null },
      include: {
        enrolment: {
          include: {
            user: { select: { name: true } },
            cohort: { include: { course: true, programme: true } },
          },
        },
      },
    });

    // CR-04 — an enrolment/scope that holds a live (ACTIVE) OR revoked
    // certificate is never queue-eligible: staff replace a revoked credential
    // through Reissue, not the queue. SUPERSEDED is deliberately absent — a
    // superseded row means a reissue happened and its replacement is ACTIVE or
    // REVOKED, which is what keeps the key in this set.
    const liveOrRevokedCertificates = await deps.pendingStore.certificate.findMany({
      where: { status: { in: ["ACTIVE", "REVOKED"] } },
    });
    const alreadyIssued = new Set(
      liveOrRevokedCertificates.map((c) => `${c.enrolmentId}:${c.scope}`),
    );

    const rows: PendingIssuanceRow[] = [];

    for (const record of records) {
      // CR-03 — an enrolment that cannot hold a certificate (WITHDRAWN,
      // PENDING_PAYMENT, TRANSFERRED, CANCELLED) is never queue-eligible:
      // Issue would always fail for it. Filtered in application code, not only
      // in the query, so the eligibility rule stays unit-testable.
      if (!CERTIFICATE_ELIGIBLE_ENROLMENT_STATUSES.includes(record.enrolment.status)) continue;

      const cohort = record.enrolment.cohort;
      const isProgrammeCohort = cohort.programmeId != null;

      if (isProgrammeCohort) {
        // D-01 — a Programme cohort yields at most the PROGRAMME-scope row,
        // never the internal per-member-course COURSE-scope records
        // completion-service.ts also creates.
        if (record.scope !== "PROGRAMME") continue;
        const programme = cohort.programme;
        if (!programme || !programme.certificateEnabled || programme.certificateIssuanceMode !== "MANUAL") {
          continue;
        }
        if (alreadyIssued.has(`${record.enrolmentId}:PROGRAMME`)) continue;
        rows.push({
          enrolmentId: record.enrolmentId,
          learnerName: record.enrolment.user.name,
          awardTitle: programme.title,
          awardType: "Programme",
          eligibleSince: record.completedAt,
          scope: "PROGRAMME",
        });
        continue;
      }

      if (record.scope !== "COURSE") continue;
      const course = cohort.course;
      if (!course || !course.certificateEnabled || course.certificateIssuanceMode !== "MANUAL") {
        continue;
      }
      if (alreadyIssued.has(`${record.enrolmentId}:COURSE`)) continue;
      rows.push({
        enrolmentId: record.enrolmentId,
        learnerName: record.enrolment.user.name,
        awardTitle: course.title,
        awardType: "Course",
        eligibleSince: record.completedAt,
        scope: "COURSE",
      });
    }

    return rows;
  }

  const rawListPendingIssuance = deps.withPermission<{ scope?: ResourceScope }>(
    "certificates.view",
    (input) => input.scope ?? {},
  )(async () => computePendingIssuance());

  function listPendingIssuance(input: { scope?: ResourceScope } = {}): Promise<PendingIssuanceRow[]> {
    return rawListPendingIssuance(input);
  }

  // -------------------------------------------------------------------------
  // 3. getOwnCertificateForDownload — learner ownership predicate.
  // -------------------------------------------------------------------------

  /**
   * Deliberately NOT wrapped in `withPermission` — same reasoning as
   * `lesson-resource-service.ts`'s `getDownloadableResourceForLearner`:
   * granting a learner `certificates.view` would hand them every other
   * certificate in the school, not just their own. Returns `null` — never
   * throws — for an unknown id, a non-owning actor (including a staff actor
   * without `certificates.view`), and a `REVOKED` certificate (UI-SPEC
   * §7.6 branch 5 — a revoked credential's download affordance is
   * withdrawn). A flagged-but-`ACTIVE` certificate still returns (branch 4
   * — a flag never withdraws already-earned access).
   */
  async function getOwnCertificateForDownload(
    actor: { userId: string },
    certificateId: string,
  ): Promise<CertificateRow | null> {
    const row = await deps.delegate.findUnique({ where: { id: certificateId } });
    if (!row) return null;
    if (row.userId !== actor.userId) return null;
    if (row.status === "REVOKED") return null;
    return row;
  }

  // -------------------------------------------------------------------------
  // 3b. getCertificateIssuer (plan 11-15) — resolves the "Issued by" fact
  //     from the issuance audit row rather than a new Certificate column.
  //     Gated by `certificates.view` at the same scope as `get`, mirroring
  //     `roster-service.ts`'s own-record `AuditEvent` read — never
  //     `audit.view` (GLOBAL-only, a different and much broader grant).
  //     Returns `null` when no issuance row is found; the caller falls back
  //     to "System (automatic issuance)" rather than fabricating a name.
  // -------------------------------------------------------------------------

  const getCertificateIssuer = deps.withPermission<string>(
    "certificates.view",
    (id) => toScope(id),
  )(async (id): Promise<CertificateIssuerRow> => {
    const row = await deps.auditStore.auditEvent.findFirst({
      where: {
        targetType: "Certificate",
        targetId: id,
        action: { in: ["certificate.issued", "certificate.issued_auto"] },
      },
      orderBy: { createdAt: "desc" },
      select: { actorId: true, actor: { select: { name: true } } },
    });
    if (!row) return null;
    return { actorId: row.actorId, actorName: row.actor?.name ?? null };
  });

  // -------------------------------------------------------------------------
  // 3c. listCertificateIssuanceSources (plan 11-22, UAT test 8) — one batched,
  //     authorized audit read so the issued list can show "Automatic" vs a
  //     staff name without N `getCertificateIssuer` calls. Same permission and
  //     the same unscoped (global) scope as `certificateService.list({})`, so
  //     exactly those who can see the list can see its sources. A certificate
  //     with no issuance audit row is `not-recorded`, never guessed as
  //     automatic. Only `{ kind, actorName }` crosses out — no actor id.
  // -------------------------------------------------------------------------

  const listCertificateIssuanceSources = deps.withPermission<{ certificateIds: string[] }>(
    "certificates.view",
    () => ({}),
  )(async (input): Promise<Record<string, IssuanceSource>> => {
    if (input.certificateIds.length === 0) return {};

    const rows = await deps.auditStore.auditEvent.findMany({
      where: {
        targetType: "Certificate",
        targetId: { in: input.certificateIds },
        action: { in: ["certificate.issued", "certificate.issued_auto"] },
      },
      orderBy: { createdAt: "desc" },
      select: {
        targetId: true,
        actorId: true,
        action: true,
        actor: { select: { name: true } },
      },
    });

    const result: Record<string, IssuanceSource> = {};
    for (const row of rows) {
      if (row.targetId in result) continue; // newest first — keep the first seen
      result[row.targetId] =
        row.action === "certificate.issued_auto"
          ? { kind: "automatic" }
          : { kind: "staff", actorName: row.actor?.name ?? null };
    }
    for (const id of input.certificateIds) {
      if (!(id in result)) result[id] = { kind: "not-recorded" };
    }
    return result;
  });

  // -------------------------------------------------------------------------
  // 4a. issueCertificateManually — D-04, no reason, delegates to the single
  //     issuance implementation.
  // -------------------------------------------------------------------------

  const issueCertificateManually = deps.withPermission<{
    enrolmentId: string;
    scope: "COURSE" | "PROGRAMME";
  }>("certificates.issue", (input) => deps.enrolmentScope(input.enrolmentId))(
    async (input, ctx) => {
      return runSettled(async (tx) => {
        // Re-checks eligibility server-side — staff sign off on an earned
        // credential, they cannot conjure one (T-11-46).
        const record = await tx.completionRecord.findFirst({
          where: { enrolmentId: input.enrolmentId, scope: input.scope, supersededAt: null },
        });
        if (!record) throw new NoCompletionRecordError();

        return issueCertificateForEnrolment(
          tx,
          {
            enrolmentId: input.enrolmentId,
            scope: input.scope,
            now: now(),
            actor: { userId: ctx.actor.userId },
          },
          deps.issuanceDeps,
        );
      });
    },
  );

  // -------------------------------------------------------------------------
  // 4b. revokeCertificate — mandatory reason, compare-and-set, D-06 reversal.
  // -------------------------------------------------------------------------

  const revokeCertificate = deps.withPermission<{ certificateId: string; reason: string }>(
    "certificates.revoke",
    (input) => toScope(input.certificateId),
  )(async (input, ctx) => {
    const reason = input.reason.trim();
    if (reason.length < 10) throw new RevocationReasonRequiredError();

    const stamp = now();

    const result = await deps.runInTransaction(async (tx) => {
      const before = await tx.certificate.findUnique({ where: { id: input.certificateId } });
      if (!before) throw new Error("Certificate not found.");

      // Compare-and-set: two simultaneous revocations cannot both claim to
      // have revoked, and an already-revoked certificate is never
      // silently re-revoked (T-11-48).
      const update = await tx.certificate.updateMany({
        where: { id: before.id, status: "ACTIVE" },
        data: {
          status: "REVOKED",
          revokedAt: stamp,
          revokedById: ctx.actor.userId,
          revocationReason: reason,
        },
      });
      if (update.count !== 1) throw new CertificateChangedError();

      const after: CertificateRow = {
        ...before,
        status: "REVOKED",
        revokedAt: stamp,
        revokedById: ctx.actor.userId,
        revocationReason: reason,
      };

      // D-06 — a COMPLETED enrolment reverts to ACTIVE through the state
      // machine, never a bare update. A no-op if the enrolment is not
      // currently COMPLETED (e.g. already reverted by a CRD-06 flag).
      const enrolment = await tx.enrolment.findUnique({ where: { id: before.enrolmentId } });
      if (enrolment && (enrolment.status as EnrolmentStatusValue) === "COMPLETED") {
        assertTransition("COMPLETED", "ACTIVE", before.enrolmentId);
        await tx.enrolment.update({ where: { id: before.enrolmentId }, data: { status: "ACTIVE" } });
      }

      // T-11-50 — ids and verificationRef only, never revocationReason.
      await deps.writeEvent(tx, {
        type: "certificate.revoked",
        payload: {
          certificateId: before.id,
          enrolmentId: before.enrolmentId,
          verificationRef: before.verificationRef,
        },
        occurredAt: stamp,
      });

      return { before, after };
    });

    await deps.audit({
      action: "certificate.revoked",
      targetType: "Certificate",
      targetId: input.certificateId,
      actorId: ctx.actor.userId,
      outcome: "SUCCESS",
      reason,
      before: result.before,
      after: result.after,
    });

    return result.after;
  });

  // -------------------------------------------------------------------------
  // 4c. reissueCertificate — mandatory reason, ordered compare-and-set,
  //     delegates to the single issuance implementation, links via
  //     supersedesId.
  // -------------------------------------------------------------------------

  const reissueCertificate = deps.withPermission<{ certificateId: string; reason: string }>(
    "certificates.issue",
    (input) => toScope(input.certificateId),
  )(async (input, ctx) => {
    const reason = input.reason.trim();
    if (reason.length < 10) throw new RevocationReasonRequiredError();

    const stamp = now();

    const result = await runSettled(async (tx) => {
      const before = await tx.certificate.findUnique({ where: { id: input.certificateId } });
      if (!before) throw new Error("Certificate not found.");

      // STEP 1 — FIRST: move the old row out of ACTIVE/REVOKED into
      // SUPERSEDED. Ordering is load-bearing (T-11-52): the partial unique
      // index `certificate_one_active_per_enrolment_scope` must never see
      // two ACTIVE rows for the same (enrolmentId, scope) even
      // momentarily, so the old row must leave ACTIVE BEFORE the new row
      // is created in step 2.
      const supersede = await tx.certificate.updateMany({
        where: { id: before.id, status: { in: ["ACTIVE", "REVOKED"] } },
        data: { status: "SUPERSEDED" },
      });
      if (supersede.count !== 1) throw new CertificateChangedError();

      // STEP 1b (CR-04, T-11-140) — also supersede EVERY other REVOKED row for
      // this enrolment and scope. Issuance now refuses (`revoked-blocked`) when
      // ANY REVOKED row exists, and legacy data from the old CR-04 bug can hold
      // two (revoke A, automation issues B, revoke B); superseding only the
      // reissued row would leave Reissue dead-ended forever. Zero rows is the
      // normal case, so no count assertion. ACTIVE rows are deliberately not
      // touched: an ACTIVE row still yields `already-issued` and rolls back.
      await tx.certificate.updateMany({
        where: { enrolmentId: before.enrolmentId, scope: before.scope, status: "REVOKED" },
        data: { status: "SUPERSEDED" },
      });

      // STEP 2 — SECOND: issue the replacement through the single
      // issuance implementation — fresh verificationRef, freshly rendered
      // PDF, new storageKey. Never reuses the old file (D-07).
      const outcome = await issueCertificateForEnrolment(
        tx,
        {
          enrolmentId: before.enrolmentId,
          scope: before.scope,
          now: stamp,
          actor: { userId: ctx.actor.userId },
        },
        deps.issuanceDeps,
      );
      if (outcome.kind !== "issued") {
        throw new Error(`Reissue could not produce a new certificate (outcome: ${outcome.kind}).`);
      }

      // STEP 3 — link the new row back to the preserved old one.
      await tx.certificate.update({
        where: { id: outcome.certificateId },
        data: { supersedesId: before.id },
      });

      const after = await tx.certificate.findUnique({ where: { id: outcome.certificateId } });
      if (!after) throw new Error("Reissue could not read back the new certificate.");

      // STEP 4 — never a reason, only ids and both references.
      await deps.writeEvent(tx, {
        type: "certificate.reissued",
        payload: {
          oldCertificateId: before.id,
          newCertificateId: outcome.certificateId,
          oldVerificationRef: before.verificationRef,
          newVerificationRef: outcome.verificationRef,
        },
        occurredAt: stamp,
      });

      return { before, after };
    });

    await deps.audit({
      action: "certificate.reissued",
      targetType: "Certificate",
      targetId: result.after.id,
      actorId: ctx.actor.userId,
      outcome: "SUCCESS",
      reason,
      before: result.before,
      after: result.after,
    });

    return result.after;
  });

  return {
    certificateService,
    listPendingIssuance,
    getOwnCertificateForDownload,
    getCertificateIssuer,
    listCertificateIssuanceSources,
    issueCertificateManually,
    revokeCertificate,
    reissueCertificate,
  };
}

// ---------------------------------------------------------------------------
// Prisma-backed binding
// ---------------------------------------------------------------------------

const built = createCertificateService({
  delegate: prisma.certificate as unknown as Delegate<CertificateRow>,
  withPermission: liveWithPermission,
  audit: (entry) => recordAudit(entry),
  enrolmentScope: enrolmentCohortScope,
  pendingStore: {
    completionRecord: prisma.completionRecord as unknown as PendingIssuanceStore["completionRecord"],
    certificate: prisma.certificate as unknown as PendingIssuanceStore["certificate"],
  },
  auditStore: {
    auditEvent: prisma.auditEvent as unknown as CertificateAuditStore["auditEvent"],
  },
  runInTransaction: (fn) =>
    prisma.$transaction((tx: unknown) => fn(tx as CertificateServiceTxClient)),
  issuanceDeps: liveIssuanceDeps,
  writeEvent: writeDomainEvent,
});

export const certificateService = built.certificateService;
export const listPendingIssuance = built.listPendingIssuance;
export const getOwnCertificateForDownload = built.getOwnCertificateForDownload;
export const getCertificateIssuer = built.getCertificateIssuer;
export const listCertificateIssuanceSources = built.listCertificateIssuanceSources;
export const issueCertificateManually = built.issueCertificateManually;
export const revokeCertificate = built.revokeCertificate;
export const reissueCertificate = built.reissueCertificate;
