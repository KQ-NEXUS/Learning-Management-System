/**
 * The append-only transactional outbox.
 *
 * This is NOT an audit trail — `AuditEvent` (audit-service.ts) remains the
 * audit record and is never replaced by anything here. It is NOT a work-queue
 * API either: Phase 13 adds the drain job that turns unprocessed rows into
 * emails and notifications, and Phase 9/11 read the attendance component
 * straight out of a payload without recomputing it.
 *
 * Why the row is written inside the caller's own database transaction, next
 * to the mutation that produced it: an external enqueue after COMMIT can be
 * lost to a crash in the gap, leaving the state change durable but the
 * obligation it creates — send the mail, recompute completion — gone. Writing
 * an outbox row in the same transaction as the mutation makes the two atomic;
 * they commit or roll back together, and the Phase 13 drain turns the row into
 * its side effect exactly once.
 *
 * Redaction happens here, at the sink, through the same `redactForAudit`
 * rules the audit trail uses. A per-call-site rule would have to be
 * remembered by every future contributor; a sink-level rule cannot be
 * forgotten. A secret carried in a payload never lands in the outbox.
 */

import { redactForAudit } from "@/server/services/audit-service";

/**
 * The closed set of domain events any Phase-5+ mutation may append. A string
 * outside this union is a compile error by design — a later phase must not be
 * able to invent an event type that no drain job knows about.
 */
export type DomainEventType =
  | "enrolment.created"
  | "enrolment.approved"
  | "enrolment.transferred"
  | "enrolment.withdrawn"
  | "enrolment.cancelled"
  | "enrolment.hold_expired"
  | "attendance.changed"
  | "cohort.published"
  | "cohort.cancelled"
  | "session.created"
  | "session.updated"
  | "session.cancelled"
  | "order.created"
  | "order.paid"
  | "order.exception"
  // Distinct from "enrolment.approved": approved means a staff member
  // exercised enrolments.manage; activated means a verified Stripe payment
  // did it with no actor. Phase 8's reconciliation views and Phase 13's
  // email drain need to tell those apart from the outbox alone.
  | "enrolment.activated"
  // 07-07 — the idempotent actual-settlement sweep (payment-reconciliation-
  // service.ts). "reconciled" is the ordinary case (actual figures recorded,
  // no variance); "reconciliation_exception" is the same write PLUS a
  // variance beyond the schedule's rounding tolerance (D-14/D-18) — never a
  // second Order.status change, never an Enrolment write.
  | "payment.reconciled"
  | "payment.reconciliation_exception"
  // Phase 9 (LRN-07, DD-13) — emitted by completion-service.ts purely as
  // Phase 13 drain input. No Phase 9 code path reads any of these three
  // back as a trigger — DD-13 forbids a Phase-9 consumer of its own output,
  // which is exactly the duplicate/circular write RESEARCH Pitfall 4
  // describes. "lesson.completed" fires when a `LessonProgress` row is
  // CREATED (not on every completion recalculation); "course.completed"
  // and "programme.completed" fire only when a scope's verdict transitions
  // from unsatisfied to satisfied — never on a supersede, and never a
  // second time while the same CompletionRecord stays open.
  | "lesson.completed"
  | "course.completed"
  | "programme.completed"
  // Phase 10 (ASM-01..07) — Assessment/Attempt/Submission/Grade lifecycle.
  // "grade.released" covers BOTH D-01's automatic quiz release AND staff
  // single/batch release — one type, distinguished by payload, so Phase
  // 13's drain needs exactly one handler for both origins.
  // "grade.overridden" is ASM-06/D-07's audited correction of an
  // already-RELEASED grade.
  // "submission.created" fires only after the object store has confirmed
  // the upload (ASM-04) — never optimistically, before the bytes exist.
  // "attempt.submitted" fires when an Attempt transitions to SUBMITTED or
  // EXPIRED.
  | "attempt.submitted"
  | "submission.created"
  | "grade.released"
  | "grade.overridden"
  // Phase 11 (CRD-01, CRD-02, CRD-06) — certificate-issuance-service.ts.
  // "certificate.issued" fires once, inside the same transaction as the
  // Certificate row create, carrying only ids/scope/verificationRef — never
  // PDF bytes (T-11-32). "certificate.review_flagged" fires when a
  // previously-issued certificate is flagged for review, either by a
  // completion supersede (attendance/lesson correction) or a grade
  // correction (plan 11-10) — never on revoke/reissue, which are their own
  // distinct acts.
  | "certificate.issued"
  | "certificate.review_flagged"
  // Plan 11-11 — the staff-triggered revoke/reissue mutations
  // (certificate-service.ts). "certificate.revoked" carries ids and the
  // verificationRef only, never revocationReason (T-11-50 — staff-internal
  // text must not reach Phase 13's email templates or the public verify
  // page). "certificate.reissued" carries both the old and new certificate
  // ids/references, also never the reason text.
  | "certificate.revoked"
  | "certificate.reissued";

/**
 * Structural — exactly the one call this module makes. A Prisma transaction
 * client satisfies it and so does a test fake, so this file needs no
 * `@prisma/client` type import.
 */
export type DomainEventTxClient = {
  domainEvent: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
};

export type DomainEventInput = {
  type: DomainEventType;
  payload: Record<string, unknown>;
  occurredAt?: Date;
};

/**
 * Pure row shaping — mirrors `buildAuditRow`. Runs the payload through
 * `redactForAudit` so the sink-level redaction rule cannot be skipped by a
 * call site. `processedAt` is deliberately absent from the row: a fresh event
 * is unprocessed, the column is nullable, and the Phase-13 drain scans
 * `WHERE processedAt IS NULL`.
 */
export function buildDomainEventRow(
  event: DomainEventInput,
): Record<string, unknown> {
  return {
    type: event.type,
    payload: redactForAudit(event.payload) as Record<string, unknown>,
    occurredAt: event.occurredAt ?? new Date(),
  };
}

/**
 * Appends one outbox row using the caller's transaction client. Takes `tx` as
 * its first argument and never opens a transaction of its own — the whole
 * point is that the row commits atomically with the mutation that produced
 * it.
 */
export async function writeDomainEvent(
  tx: DomainEventTxClient,
  event: DomainEventInput,
): Promise<void> {
  await tx.domainEvent.create({ data: buildDomainEventRow(event) });
}
