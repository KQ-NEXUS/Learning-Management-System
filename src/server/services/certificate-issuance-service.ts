/**
 * The reactive heart of Phase 11 (CRD-01, CRD-02, CRD-06 — attendance/lesson
 * half): turns a satisfied `CompletionRecord` into an issued, downloadable
 * certificate, and reacts when a completion is later superseded.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ORDERING — WHY CREATE-THEN-RENDER, NEVER RENDER-THEN-CREATE.
 * ─────────────────────────────────────────────────────────────────────────────
 * `issueCertificateForEnrolment` creates the `Certificate` row FIRST, before
 * any PDF rendering or object-store write happens. The partial unique index
 * `certificate_one_active_per_enrolment_scope` (`ON ("enrolmentId","scope")
 * WHERE status = 'ACTIVE'`, plan 11-01) is what actually arbitrates a race
 * between two simultaneous completion triggers (RESEARCH Pitfall 4) — create
 * first, so that race resolves BEFORE any rendering work is spent on a
 * request that is about to lose it. Do NOT "optimize" this later by
 * rendering first and creating the row only once a PDF exists: that would
 * let two concurrent triggers both pay for a full render before either
 * discovers the unique index was already won by the other, and risks two
 * different `storageKey`s both pointing at generated objects for what must
 * be one certificate. (Before the create, the function also refuses — CR-03 —
 * an ineligible enrolment and — CR-04 — an enrolment/scope that already holds
 * a REVOKED certificate; both are typed outcomes, never writes.) The create is an
 * `INSERT ... ON CONFLICT DO NOTHING` (`createMany` + `skipDuplicates`); a
 * zero-row insert is treated as `{ kind: "already-issued" }` — a lost race
 * is a correct outcome, not a failure to propagate, and (unlike catching a
 * `P2002`) it leaves the caller's Postgres transaction usable.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE DOES NOT WIDEN `CompletionServiceTxClient`.
 * ─────────────────────────────────────────────────────────────────────────────
 * `completion-service.ts`'s DD-6 deliberately omits `enrolment.update` from
 * `CompletionServiceTxClient` so that module structurally cannot touch
 * `Enrolment.status`, even by accident. That omission is the point, not an
 * oversight — Phase 11 owns the `COMPLETED` transition (D-05) and the
 * reversal that makes a terminal status safe (D-06). This module declares
 * its OWN, wider `CertificateIssuanceTxClient` below rather than extending
 * `completion-service.ts`'s type, and never imports
 * `CompletionServiceTxClient` for anything but the outer wrapper's public
 * signature (`recalculateCompletionAndIssue`), which narrows to it via a
 * structural cast — the same "cast via unknown" idiom
 * `enrolment-transitions.ts`'s `applyEnrolmentActivation` uses for its own
 * tx-client narrowing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY NOTHING HERE IS REACHABLE FROM A ROUTE HANDLER WITH A CALLER-SUPPLIED
 * ENROLMENT ID (RESEARCH Pattern 3).
 * ─────────────────────────────────────────────────────────────────────────────
 * `issueCertificateForEnrolment` and `reactToCompletionResults` are consumed
 * only by `recalculateCompletionAndIssue` (installed at the
 * lesson-progress/attendance composition roots, plan 11-10) and by
 * `certificate-service.ts`'s staff-triggered manual-issue path (plan 11-11),
 * which applies its own
 * `withPermission` gate. Automatic issuance runs inside a transaction already
 * opened by an authenticated actor's permitted write (a learner completing
 * their own lesson, staff marking attendance); the certificate itself is a
 * system-derived consequence of that write, not an independently
 * permission-gated act. This is deliberately not a second unauthorized
 * surface — see `checkout-webhook-system-service.ts`'s `SYSTEM_ACTOR_TYPE`
 * convention, reused below for the actor stamp on every automatically-
 * triggered write.
 */

import {
  writeDomainEvent,
  type DomainEventTxClient,
} from "@/server/services/domain-event-service";
import {
  recalculateCompletion,
  type CompletionServiceTxClient,
  type CompletionRecalculationResult,
  type CompletionScopeResult,
} from "@/server/services/completion-service";
import {
  assertTransition,
  type EnrolmentStatusValue,
} from "@/server/services/enrolment-transitions";
import { SYSTEM_ACTOR_TYPE } from "@/server/services/checkout-webhook-system-service";
import { recordAudit, type BusinessAuditEvent } from "@/server/services/audit-service";
import { generateVerificationRef } from "@/server/services/certificate-reference";
import {
  renderCertificatePdf,
  type CertificateAssetResolver,
} from "@/server/services/certificate-pdf-renderer";
import { parseCertificateTemplateLayout } from "@/server/services/certificate-template-layout";
import {
  buildCertificateStorageKey,
  putGeneratedCertificateObject,
  getObjectBytes,
} from "@/server/services/storage-service";
import { prisma } from "@/server/db";

// ---------------------------------------------------------------------------
// Row shapes — the narrow structural slice this module needs, mirroring the
// `CompletionServiceTxClient`/`EnrolmentActivationTxClient` discipline so a
// test fake satisfies the type without a `@prisma/client` import.
// ---------------------------------------------------------------------------

export type CertificateEnrolmentRow = {
  id: string;
  userId: string;
  cohortId: string;
  status: string;
};

export type CertificateCohortRow = {
  id: string;
  courseId: string | null;
  programmeId: string | null;
};

/** The structural shape shared by `Course` and `Programme` for this module's purposes. */
export type CertificateAwardRow = {
  id: string;
  title: string;
  certificateEnabled: boolean;
  certificateIssuanceMode: "AUTOMATIC" | "MANUAL";
  certificateTemplateId: string | null;
};

export type CertificateTemplateRow = {
  id: string;
  layout: unknown;
};

export type CertificateUserRow = {
  id: string;
  name: string;
};

export type CertificateRow = {
  id: string;
  status: "ACTIVE" | "REVOKED" | "SUPERSEDED";
  reviewFlaggedAt: Date | null;
};

/**
 * Structural — exactly the delegates this module touches, plus
 * `DomainEventTxClient`'s `domainEvent.create`. A WIDER, SEPARATE type from
 * `CompletionServiceTxClient` (see header) — it declares `enrolment.update`,
 * which that type deliberately omits.
 */
export type CertificateIssuanceTxClient = DomainEventTxClient & {
  certificate: {
    findFirst(args: {
      where: Record<string, unknown>;
    }): Promise<CertificateRow | null>;
    createMany(args: {
      data: Record<string, unknown>[];
      skipDuplicates: boolean;
    }): Promise<{ count: number }>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<unknown>;
  };
  enrolment: {
    findUnique(args: { where: { id: string } }): Promise<CertificateEnrolmentRow | null>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<unknown>;
  };
  cohort: {
    findUnique(args: { where: { id: string } }): Promise<CertificateCohortRow | null>;
  };
  course: {
    findUnique(args: { where: { id: string } }): Promise<CertificateAwardRow | null>;
  };
  programme: {
    findUnique(args: { where: { id: string } }): Promise<CertificateAwardRow | null>;
  };
  certificateTemplate: {
    findUnique(args: { where: { id: string } }): Promise<CertificateTemplateRow | null>;
    findFirst(args: {
      where: Record<string, unknown>;
    }): Promise<CertificateTemplateRow | null>;
  };
  /**
   * Declared for structural completeness against the module's full real
   * delegate surface — not read by this file's own logic (this module never
   * re-derives a verdict; see the header's DD-6 note). Kept narrow
   * (`findFirst` only) rather than omitted so a future caller sharing this
   * tx-client type (e.g. plan 11-10's grade-correction hook) does not need a
   * second, near-identical type.
   */
  completionRecord: {
    findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string } | null>;
  };
  user: {
    findUnique(args: { where: { id: string } }): Promise<CertificateUserRow | null>;
  };
};

// ---------------------------------------------------------------------------
// issueCertificateForEnrolment
// ---------------------------------------------------------------------------

export type IssueCertificateActor = { userId: string } | null;

export type IssueCertificateInput = {
  enrolmentId: string;
  scope: "COURSE" | "PROGRAMME";
  now: Date;
  /** `null` for a system-triggered (automatic) issuance; a staff actor otherwise. */
  actor: IssueCertificateActor;
};

/**
 * The ONE definition of which enrolments can hold a certificate (CR-03, plan
 * 11-25). WITHDRAWN, PENDING_PAYMENT, TRANSFERRED and CANCELLED learners
 * cannot. `COMPLETED` is included only because staff Reissue delegates to
 * `issueCertificateForEnrolment` for an enrolment that never left COMPLETED
 * (the idempotent "already COMPLETED" branch below); `ACTIVE` is the only
 * status that can legally move to COMPLETED (`VALID_TRANSITIONS`). Shared with
 * `certificate-service.ts`'s pending-issuance queue so eligibility has a single
 * definition.
 */
export const CERTIFICATE_ELIGIBLE_ENROLMENT_STATUSES: readonly string[] = ["ACTIVE", "COMPLETED"];

export type IssueCertificateOutcome =
  | { kind: "issued"; certificateId: string; verificationRef: string }
  | { kind: "already-issued"; certificateId: string }
  | { kind: "not-enabled" }
  | { kind: "no-template" }
  /** The enrolment's status cannot hold a certificate (CR-03). Nothing was written. */
  | { kind: "not-eligible" }
  /**
   * A REVOKED certificate exists for this enrolment and scope (CR-04, CRD-05).
   * Nothing was written; only staff Reissue may replace a revoked credential.
   */
  | { kind: "revoked-blocked" };

/**
 * Every I/O boundary `issueCertificateForEnrolment`/`reactToCompletionResults`
 * (Task 2) touch beyond the injected `tx`, so the behavior list in this plan
 * is testable without a real PDF library, object store, or audit sink.
 */
export type IssueCertificateDeps = {
  renderPdf: typeof renderCertificatePdf;
  putObject: (input: {
    key: string;
    body: Uint8Array;
    contentType: string;
  }) => Promise<void>;
  buildKey: (input: { certificateId: string }) => string;
  generateRef: () => string;
  audit: (event: BusinessAuditEvent) => Promise<void>;
  writeEvent: typeof writeDomainEvent;
  resolveTemplateAsset: CertificateAssetResolver;
};

/**
 * Resolves the Course/Programme template for issuance: the award's own
 * `certificateTemplateId` when set (regardless of that template's own
 * archived state — RESEARCH Pitfall 5: an archived template still renders
 * correctly for issuance already pointed at it; the UI is what keeps it out
 * of the *pickable* list going forward), else the library's `isDefault`
 * template (D-10). Returns `null` when neither resolves.
 */
async function resolveTemplate(
  tx: CertificateIssuanceTxClient,
  award: CertificateAwardRow,
): Promise<CertificateTemplateRow | null> {
  if (award.certificateTemplateId) {
    return tx.certificateTemplate.findUnique({ where: { id: award.certificateTemplateId } });
  }
  return tx.certificateTemplate.findFirst({ where: { isDefault: true } });
}

/**
 * Issues exactly one certificate for one enrolment/scope, renders and stores
 * its PDF, and moves the enrolment to `COMPLETED` (D-05) through
 * `enrolment-transitions.ts`'s state machine — never a bare `update`.
 *
 * Ineligible enrolments (anything but ACTIVE/COMPLETED, see
 * `CERTIFICATE_ELIGIBLE_ENROLMENT_STATUSES`) return `{ kind: "not-eligible" }`
 * before any read of the award or any write — a typed non-error outcome, so
 * a caller's own write is never failed by them (CR-03).
 *
 * A REVOKED certificate for the same enrolment and scope returns
 * `{ kind: "revoked-blocked" }` for every actor (CR-04, CRD-05): only staff
 * Reissue (which supersedes the revoked rows first) can replace it.
 *
 * Resolution rules (D-01):
 * - `scope: "COURSE"` reads the enrolment's cohort; the award is the
 *   cohort's Course. If the cohort's `programmeId` is non-null, this refuses
 *   with `{ kind: "not-enabled" }` — Course certificates are structurally
 *   exclusive to Course cohorts, and this guard is that enforcement, not a
 *   comment.
 * - `scope: "PROGRAMME"` reads the cohort's Programme.
 *
 * `awardTitle` snapshots the Course/Programme title; `learnerName` snapshots
 * the enrolled `User`'s name at issuance time — both frozen onto the
 * `Certificate` row so a later rename/retitle never changes what an
 * already-issued credential says.
 */
export async function issueCertificateForEnrolment(
  tx: CertificateIssuanceTxClient,
  input: IssueCertificateInput,
  deps: IssueCertificateDeps,
): Promise<IssueCertificateOutcome> {
  const { enrolmentId, scope, now, actor } = input;

  const enrolment = await tx.enrolment.findUnique({ where: { id: enrolmentId } });
  if (!enrolment) {
    throw new Error(`Certificate issuance found no Enrolment for id ${enrolmentId}.`);
  }

  // CR-03 — the eligibility gate runs BEFORE every other check and every write.
  // An ineligible enrolment (WITHDRAWN, PENDING_PAYMENT, TRANSFERRED, CANCELLED)
  // is a typed non-error outcome: this function is called inside a caller's own
  // transaction (a staff attendance write), and an `IllegalTransitionError`
  // from the D-05 block below would fail that unrelated write.
  if (!CERTIFICATE_ELIGIBLE_ENROLMENT_STATUSES.includes(enrolment.status)) {
    return { kind: "not-eligible" };
  }

  const cohort = await tx.cohort.findUnique({ where: { id: enrolment.cohortId } });
  if (!cohort) {
    throw new Error(`Certificate issuance found no Cohort for enrolment ${enrolmentId}.`);
  }

  // D-01 structural guard: a Programme cohort's member-course completion
  // must never issue a Course certificate, even though completion-service.ts
  // creates the internal COURSE-scope CompletionRecord for it.
  if (scope === "COURSE" && cohort.programmeId != null) {
    return { kind: "not-enabled" };
  }

  let award: CertificateAwardRow | null;
  let courseId: string | null;
  let programmeId: string | null;

  if (scope === "COURSE") {
    if (!cohort.courseId) {
      throw new Error(`Certificate issuance scope COURSE requires a Course cohort (enrolment ${enrolmentId}).`);
    }
    award = await tx.course.findUnique({ where: { id: cohort.courseId } });
    courseId = cohort.courseId;
    programmeId = null;
  } else {
    if (!cohort.programmeId) {
      throw new Error(`Certificate issuance scope PROGRAMME requires a Programme cohort (enrolment ${enrolmentId}).`);
    }
    award = await tx.programme.findUnique({ where: { id: cohort.programmeId } });
    courseId = null;
    programmeId = cohort.programmeId;
  }

  if (!award) {
    throw new Error(
      `Certificate issuance found no ${scope === "COURSE" ? "Course" : "Programme"} for enrolment ${enrolmentId}.`,
    );
  }

  // CRD-01's "and issuance is enabled" — a no-op returning a typed outcome,
  // never a row, never a status change.
  if (!award.certificateEnabled) {
    return { kind: "not-enabled" };
  }

  // Idempotency pre-check — a second issue call for the same
  // enrolment/scope short-circuits here in the ordinary (non-racing) case.
  // The partial unique index below is what closes the CONCURRENT case.
  const existing = await tx.certificate.findFirst({
    where: { enrolmentId, scope, status: "ACTIVE" },
  });
  if (existing) {
    return { kind: "already-issued", certificateId: existing.id };
  }

  // CR-04 / CRD-05 — a revocation (possibly for misconduct) must never be
  // undone by automation, including a learner undoing and redoing a lesson,
  // and never by a stale manual-queue click. This applies to EVERY actor: the
  // only legitimate path to a replacement is staff Reissue, and
  // `reissueCertificate` moves every REVOKED row for this enrolment/scope to
  // SUPERSEDED BEFORE calling this function, so nothing REVOKED remains then.
  // Evaluated after the ACTIVE pre-check so legacy ACTIVE+REVOKED data still
  // reads as already-issued. No new audit row: the revocation is already
  // audited and the outcome is returned to the caller.
  const revoked = await tx.certificate.findFirst({
    where: { enrolmentId, scope, status: "REVOKED" },
  });
  if (revoked) {
    return { kind: "revoked-blocked" };
  }

  const template = await resolveTemplate(tx, award);
  if (!template) {
    return { kind: "no-template" };
  }
  const layout = parseCertificateTemplateLayout(template.layout);

  const user = await tx.user.findUnique({ where: { id: enrolment.userId } });
  if (!user) {
    throw new Error(`Certificate issuance found no User for enrolment ${enrolmentId}.`);
  }

  const verificationRef = deps.generateRef();

  // Create FIRST — see header. `storageKey` starts null and is filled in
  // after the render below.
  //
  // `createMany({ skipDuplicates: true })` — i.e. `INSERT ... ON CONFLICT DO
  // NOTHING` — and NOT `create` inside a try/catch(P2002). A plain INSERT
  // that violates `certificate_one_active_per_enrolment_scope` ABORTS the
  // surrounding Postgres transaction (SQLSTATE 25P02: "current transaction
  // is aborted, commands ignored until end of transaction block"), so a
  // catch-and-re-query on the same `tx` can never work — and this function
  // runs INSIDE the caller's transaction (the learner's lesson-progress
  // write, staff attendance marking), which must survive a lost race intact.
  // ON CONFLICT DO NOTHING blocks on the winner's uncommitted index entry,
  // then inserts nothing once the winner commits, leaving the transaction
  // healthy. The real-Postgres proof of this is
  // tests/certificate-concurrency.integration.test.ts — the earlier
  // create+catch(P2002) shape passed every fake-backed unit test and failed
  // there with 25P02.
  const inserted = await tx.certificate.createMany({
    data: [
      {
        enrolmentId,
        userId: enrolment.userId,
        scope,
        courseId,
        programmeId,
        awardTitle: award.title,
        learnerName: user.name,
        issuedAt: now,
        status: "ACTIVE",
        verificationRef,
        storageKey: null,
      },
    ],
    skipDuplicates: true,
  });

  if (inserted.count === 0) {
    // Lost the race on certificate_one_active_per_enrolment_scope — a
    // correct outcome, not a failure. The index guarantees a winning
    // ACTIVE row now exists for this (enrolmentId, scope).
    const winner = await tx.certificate.findFirst({
      where: { enrolmentId, scope, status: "ACTIVE" },
    });
    if (!winner) {
      throw new Error(
        `Certificate issuance inserted nothing for enrolment ${enrolmentId}/${scope} but found no winning ACTIVE row.`,
      );
    }
    return { kind: "already-issued", certificateId: winner.id };
  }

  // `createMany` returns a count, not the row — `verificationRef` is unique
  // and was minted just above, so it identifies exactly the row this call
  // inserted.
  const created = await tx.certificate.findFirst({ where: { verificationRef } });
  if (!created) {
    throw new Error(
      `Certificate issuance inserted a row for enrolment ${enrolmentId}/${scope} but could not read it back.`,
    );
  }
  const certificateId = created.id;

  // Render, then store — if this throws, the CALLER's transaction (the
  // lesson-progress/attendance write, or recalculateCompletionAndIssue's own
  // caller — Task 2) rolls back as a whole, undoing the create above along
  // with everything else in the same transaction. Postgres transactional
  // atomicity is what keeps "no Certificate row without a stored PDF" true
  // here — this function does not (and cannot, mid-transaction) compensate
  // for a partial object-store write by hand.
  const pdfBytes = await deps.renderPdf({
    layout,
    fields: {
      learnerName: user.name,
      awardTitle: award.title,
      issuedAt: now,
      verificationRef,
    },
    resolveAsset: deps.resolveTemplateAsset,
  });

  const storageKey = deps.buildKey({ certificateId });
  await deps.putObject({ key: storageKey, body: pdfBytes, contentType: "application/pdf" });
  await tx.certificate.update({ where: { id: certificateId }, data: { storageKey } });

  // D-05 — the COMPLETED transition fires ON ISSUANCE, through the state
  // machine, never a bare update. Idempotent when the enrolment is ALREADY
  // COMPLETED (plan 11-11's reissue path: reissuing a certificate whose
  // enrolment never left COMPLETED — e.g. reissuing directly from an ACTIVE
  // certificate, or a second reissue in the same chain — must not re-assert
  // a COMPLETED -> COMPLETED "transition", which `VALID_TRANSITIONS` has no
  // entry for and would throw `IllegalTransitionError` on what is actually a
  // no-op, not an illegal move).
  if ((enrolment.status as EnrolmentStatusValue) !== "COMPLETED") {
    assertTransition(enrolment.status as EnrolmentStatusValue, "COMPLETED", enrolmentId);
    await tx.enrolment.update({ where: { id: enrolmentId }, data: { status: "COMPLETED" } });
  }

  const isSystem = actor === null;
  await deps.audit({
    actorId: actor?.userId ?? null,
    actorType: isSystem ? SYSTEM_ACTOR_TYPE : undefined,
    action: isSystem ? "certificate.issued_auto" : "certificate.issued",
    targetType: "Certificate",
    targetId: certificateId,
    outcome: "SUCCESS",
  });

  // T-11-32 — ids/scope/verificationRef only, never PDF bytes.
  await deps.writeEvent(tx, {
    type: "certificate.issued",
    payload: { certificateId, enrolmentId, scope, verificationRef },
    occurredAt: now,
  });

  return { kind: "issued", certificateId, verificationRef };
}

// ---------------------------------------------------------------------------
// flagCertificateForReview — the shared CRD-06 flag-write, reused by both
// this file's own superseded branch and plan 11-10's grade-correction hook
// (`flagCertificatesForGradeCorrection`), per that plan's explicit
// "share, do not duplicate" instruction.
// ---------------------------------------------------------------------------

export type FlagCertificateForReviewArgs = {
  enrolmentId: string;
  now: Date;
  reason: string;
  actorId: string | null;
  actorType?: string;
  /**
   * Extra fields folded into the audit row's `after` and the domain event's
   * payload — e.g. grade-correction's `{ assessmentId, passedChanged }`
   * (plan 11-10). Context only: never used to gate the flag write itself.
   */
  context?: Record<string, unknown>;
};

/**
 * Looks up the ONE `ACTIVE` certificate for `enrolmentId` (no scope
 * disambiguation — D-01 guarantees at most one certificate type is ever
 * certificate-eligible per enrolment, per RESEARCH's Open Question 1), sets
 * `reviewFlaggedAt` only, and — if the enrolment is currently `COMPLETED` —
 * reverts it to `ACTIVE` through `assertTransition` (D-06). Never touches
 * `status`, `verificationRef`, `issuedAt`, or `storageKey`: CRD-06 flags for
 * review, it never silently alters or destroys the credential. A no-op, not
 * an error, when there is no `ACTIVE` certificate to flag.
 */
export async function flagCertificateForReview(
  tx: CertificateIssuanceTxClient,
  args: FlagCertificateForReviewArgs,
  deps: IssueCertificateDeps,
): Promise<void> {
  const { enrolmentId, now, reason, actorId, actorType, context } = args;

  const certificate = await tx.certificate.findFirst({
    where: { enrolmentId, status: "ACTIVE" },
  });
  if (!certificate) return;

  await tx.certificate.update({
    where: { id: certificate.id },
    data: { reviewFlaggedAt: now },
  });

  const enrolment = await tx.enrolment.findUnique({ where: { id: enrolmentId } });
  if (enrolment && (enrolment.status as EnrolmentStatusValue) === "COMPLETED") {
    assertTransition("COMPLETED", "ACTIVE", enrolmentId);
    await tx.enrolment.update({ where: { id: enrolmentId }, data: { status: "ACTIVE" } });
  }

  await deps.audit({
    actorId,
    actorType,
    action: "certificate.review_flagged",
    targetType: "Certificate",
    targetId: certificate.id,
    outcome: "SUCCESS",
    reason,
    after: context,
  });

  await deps.writeEvent(tx, {
    type: "certificate.review_flagged",
    payload: { certificateId: certificate.id, enrolmentId, reason, ...(context ?? {}) },
    occurredAt: now,
  });
}

// ---------------------------------------------------------------------------
// flagCertificatesForGradeCorrection — CRD-06's grade half (plan 11-10).
// Grades never flow through `completionRule` v1 (`RECOGNISED_V1_KEYS` carries
// no assessment key), so there is no verdict to re-derive here — this only
// flags, reusing `flagCertificateForReview` above rather than a second
// flag-write implementation. Differs from the "completion superseded" branch
// only in actor (the overriding staff member, never SYSTEM — a human
// requested the correction) and reason ("grade corrected"). Flags regardless
// of `passedChanged`: CRD-06 says "re-evaluated after an authorized grade...
// correction", not "after a pass/fail flip" — a score change that does not
// cross the threshold can still be the evidence a reviewer needs.
// `assessmentId`/`passedChanged` ride along as audit/event context only,
// never as a gate on whether the flag is written.
// ---------------------------------------------------------------------------

export type FlagCertificatesForGradeCorrectionArgs = {
  enrolmentId: string;
  assessmentId: string;
  passedChanged: boolean;
  now: Date;
  actorId: string;
};

export async function flagCertificatesForGradeCorrection(
  tx: CertificateIssuanceTxClient,
  args: FlagCertificatesForGradeCorrectionArgs,
  deps: IssueCertificateDeps,
): Promise<void> {
  const { enrolmentId, assessmentId, passedChanged, now, actorId } = args;
  await flagCertificateForReview(
    tx,
    {
      enrolmentId,
      now,
      reason: "grade corrected",
      actorId,
      context: { assessmentId, passedChanged },
    },
    deps,
  );
}

// ---------------------------------------------------------------------------
// reactToCompletionResults
// ---------------------------------------------------------------------------

export type ReactToCompletionResultsArgs = {
  enrolmentId: string;
  results: CompletionScopeResult[];
  now: Date;
  /**
   * The human whose action triggered the re-evaluation (e.g. the staff member
   * correcting attendance). Absent for triggers with no human actor (lesson
   * progress), in which case the review flag is attributed to SYSTEM.
   */
  actorId?: string | null;
};

/**
 * Iterates `recalculateCompletion`'s results array and applies the state
 * table below. Reads the enrolment's cohort exactly once, up front, and
 * derives `isProgrammeCohort` from whether it carries a `programmeId` — that
 * single boolean enforces D-01 across every `COURSE`-scope result in the
 * array, including the Programme-cohort case where `completion-service.ts`
 * emits one `COURSE`-scope entry per member course plus one `PROGRAMME`-
 * scope entry.
 *
 * | `action`      | condition                                             | effect                                    |
 * |---------------|--------------------------------------------------------|--------------------------------------------|
 * | `created`     | `COURSE` scope on a Programme cohort                    | skipped — D-01, zero issuance calls        |
 * | `created`     | award `certificateEnabled: false`                        | skipped                                    |
 * | `created`     | award `certificateIssuanceMode: "MANUAL"`                | skipped — eligible, not issued (D-04)      |
 * | `created`     | award `certificateEnabled: true`, mode `"AUTOMATIC"`      | `issueCertificateForEnrolment` (system)    |
 * | `unchanged`   | —                                                         | no write of any kind                       |
 * | `superseded`  | `COURSE` scope on a Programme cohort                      | skipped — D-01, member-course evidence never flags |
 * | `superseded`  | otherwise                                                 | `flagCertificateForReview` ("completion superseded"), at most once per call; actor is `args.actorId` (the triggering staff member) when known, else SYSTEM |
 */
export async function reactToCompletionResults(
  tx: CertificateIssuanceTxClient,
  args: ReactToCompletionResultsArgs,
  deps: IssueCertificateDeps,
): Promise<void> {
  const { enrolmentId, results, now } = args;

  const enrolment = await tx.enrolment.findUnique({ where: { id: enrolmentId } });
  if (!enrolment) return;

  const cohort = await tx.cohort.findUnique({ where: { id: enrolment.cohortId } });
  if (!cohort) return;

  const isProgrammeCohort = cohort.programmeId != null;
  let flagged = false;

  for (const result of results) {
    if (result.action === "unchanged") continue;

    if (result.action === "created") {
      // D-01 — a Programme cohort's member-course completion never triggers
      // Course-certificate issuance, even though the completion engine
      // creates the internal COURSE-scope record. Zero calls to the
      // issuance dependency for this branch, not merely "no row created."
      if (result.scope === "COURSE" && isProgrammeCohort) continue;

      const award =
        result.scope === "COURSE"
          ? cohort.courseId
            ? await tx.course.findUnique({ where: { id: cohort.courseId } })
            : null
          : cohort.programmeId
            ? await tx.programme.findUnique({ where: { id: cohort.programmeId } })
            : null;

      // Eligibility under MANUAL mode is a read-time fact (D-04) — no flag
      // column is written, and the issuance dependency is never called.
      if (!award || !award.certificateEnabled || award.certificateIssuanceMode !== "AUTOMATIC") {
        continue;
      }

      await issueCertificateForEnrolment(
        tx,
        { enrolmentId, scope: result.scope, now, actor: null },
        deps,
      );
      continue;
    }

    // action === "superseded"
    //
    // D-01 on the way down — a Programme cohort's member-course supersession
    // never drives certificate state. When the programme rule breaks the
    // PROGRAMME-scope record is superseded in the same evaluation and flags.
    if (result.scope === "COURSE" && isProgrammeCohort) continue;

    // The flag is keyed on the enrolment (the one ACTIVE certificate), not on
    // the result, so it is written at most once per re-evaluation.
    if (flagged) continue;
    flagged = true;

    const actorId =
      typeof args.actorId === "string" && args.actorId.length > 0 ? args.actorId : null;
    await flagCertificateForReview(
      tx,
      {
        enrolmentId,
        now,
        reason: "completion superseded",
        ...(actorId
          ? { actorId }
          : { actorId: null, actorType: SYSTEM_ACTOR_TYPE }),
      },
      deps,
    );
  }
}

// ---------------------------------------------------------------------------
// recalculateCompletionAndIssue — the drop-in replacement for the bare
// `recalculateCompletion` dependency slot on lesson-progress-service.ts /
// attendance-service.ts (plan 11-10 installs it; zero lines of business
// logic change in either consumer).
// ---------------------------------------------------------------------------

/**
 * Exported so `grade-override-service.ts`'s composition root (plan 11-10) can
 * bind `flagCertificatesForGradeCorrection` to the same live audit/event
 * writers instead of constructing a second, independently-drifting copy.
 */
export const liveIssuanceDeps: IssueCertificateDeps = {
  renderPdf: renderCertificatePdf,
  putObject: putGeneratedCertificateObject,
  buildKey: buildCertificateStorageKey,
  generateRef: generateVerificationRef,
  audit: (event) => recordAudit(event),
  writeEvent: writeDomainEvent,
  resolveTemplateAsset: (assetKey) => getObjectBytes(assetKey),
};

/**
 * Calls `recalculateCompletion` unchanged, then — on `kind: "evaluated"` —
 * reacts to its results via `reactToCompletionResults`, and returns the
 * ORIGINAL result unchanged. Its signature is deliberately identical to
 * `recalculateCompletion`'s own
 * (`(tx: CompletionServiceTxClient, args) => Promise<CompletionRecalculationResult>`)
 * so it is assignable to `LessonProgressServiceDeps["recalculateCompletion"]`
 * and the equivalent slot on `AttendanceServiceDeps` with no other change at
 * either composition root (plan 11-10).
 *
 * `tx` is narrowed to `CertificateIssuanceTxClient` via a structural cast
 * through `unknown` — the same idiom `enrolment-transitions.ts`'s
 * `applyEnrolmentActivation` uses for `SeatTxClient` — never by widening
 * `CompletionServiceTxClient` itself (see header).
 */
export async function recalculateCompletionAndIssue(
  tx: CompletionServiceTxClient,
  args: { enrolmentId: string; now: Date; actorId?: string | null },
): Promise<CompletionRecalculationResult> {
  const result = await recalculateCompletion(tx, { enrolmentId: args.enrolmentId, now: args.now });

  if (result.kind === "evaluated") {
    await reactToCompletionResults(
      tx as unknown as CertificateIssuanceTxClient,
      {
        enrolmentId: args.enrolmentId,
        results: result.results,
        now: args.now,
        actorId: args.actorId,
      },
      liveIssuanceDeps,
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// Prisma-backed binding — exported for plan 11-11's staff-triggered manual
// issue path, which supplies its own actor and its own withPermission gate.
// ---------------------------------------------------------------------------

/** The live-bound `issueCertificateForEnrolment`, ready for a caller that already has an open `tx`. */
export function issueCertificateForEnrolmentLive(
  tx: CertificateIssuanceTxClient,
  input: IssueCertificateInput,
): Promise<IssueCertificateOutcome> {
  return issueCertificateForEnrolment(tx, input, liveIssuanceDeps);
}

/**
 * Exposed so `prisma`'s import stays confined to this file's bottom, matching
 * every other `*-system-service.ts` module's "Prisma-backed binding" section
 * — not currently called from this file itself (`recalculateCompletionAndIssue`
 * receives its `tx` from the caller's own transaction), kept for symmetry and
 * for a future composition root that wants to open its own transaction here.
 */
export function withCertificateIssuanceTransaction<R>(
  fn: (tx: CertificateIssuanceTxClient) => Promise<R>,
): Promise<R> {
  return prisma.$transaction((tx: unknown) => fn(tx as CertificateIssuanceTxClient));
}
