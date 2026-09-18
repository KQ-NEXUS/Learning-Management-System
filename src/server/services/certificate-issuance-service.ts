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
 * be one certificate. A `P2002` on the create is caught with
 * `isUniqueConstraintViolation` (the same duck-typed check
 * `resource-service.ts`/`checkout-webhook-system-service.ts` already use)
 * and treated as `{ kind: "already-issued" }` — a lost race is a correct
 * outcome, not a failure to propagate.
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
 * `completion-service.ts`'s type. Plan 11-07 Task 2 adds the
 * `recalculateCompletionAndIssue` wrapper that narrows a
 * `CompletionServiceTxClient` into this wider type via a structural cast —
 * the same "cast via unknown" idiom `enrolment-transitions.ts`'s
 * `applyEnrolmentActivation` uses for its own tx-client narrowing — never by
 * widening `CompletionServiceTxClient` itself.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY NOTHING HERE IS REACHABLE FROM A ROUTE HANDLER WITH A CALLER-SUPPLIED
 * ENROLMENT ID (RESEARCH Pattern 3).
 * ─────────────────────────────────────────────────────────────────────────────
 * `issueCertificateForEnrolment` is consumed only by `reactToCompletionResults`
 * (Task 2, installed at the lesson-progress/attendance composition roots via
 * `recalculateCompletionAndIssue`, plan 11-10) and by `certificate-service.ts`'s
 * staff-triggered manual-issue path (plan 11-11), which applies its own
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
  assertTransition,
  type EnrolmentStatusValue,
} from "@/server/services/enrolment-transitions";
import { SYSTEM_ACTOR_TYPE } from "@/server/services/checkout-webhook-system-service";
import type { BusinessAuditEvent } from "@/server/services/audit-service";
import {
  renderCertificatePdf,
  type CertificateAssetResolver,
} from "@/server/services/certificate-pdf-renderer";
import { parseCertificateTemplateLayout } from "@/server/services/certificate-template-layout";

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
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
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
// isUniqueConstraintViolation — the same duck-typed P2002 check
// resource-service.ts / checkout-webhook-system-service.ts already use,
// copied rather than imported so this file carries no cross-module coupling
// on an internal helper (both source files keep their own private copy too).
// ---------------------------------------------------------------------------

function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

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

export type IssueCertificateOutcome =
  | { kind: "issued"; certificateId: string; verificationRef: string }
  | { kind: "already-issued"; certificateId: string }
  | { kind: "not-enabled" }
  | { kind: "no-template" };

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
  let certificateId: string;
  try {
    const created = await tx.certificate.create({
      data: {
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
    });
    certificateId = created.id;
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      // Lost the race on certificate_one_active_per_enrolment_scope — a
      // correct outcome, not a failure. The index guarantees a winning
      // ACTIVE row now exists for this (enrolmentId, scope).
      const winner = await tx.certificate.findFirst({
        where: { enrolmentId, scope, status: "ACTIVE" },
      });
      if (!winner) {
        throw new Error(
          `Certificate issuance lost a unique-constraint race for enrolment ${enrolmentId}/${scope} but found no winning ACTIVE row.`,
        );
      }
      return { kind: "already-issued", certificateId: winner.id };
    }
    throw err;
  }

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
  // machine, never a bare update.
  assertTransition(enrolment.status as EnrolmentStatusValue, "COMPLETED", enrolmentId);
  await tx.enrolment.update({ where: { id: enrolmentId }, data: { status: "COMPLETED" } });

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
