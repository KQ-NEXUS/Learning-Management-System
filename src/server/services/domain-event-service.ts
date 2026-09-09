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
 * to the mutation that produced it: a pg-boss enqueue is not transactional on
 * Prisma 6.19.3 (`src/server/jobs/queue.ts` lines 11-18 — the `fromPrisma`
 * adapter needs Prisma v7 plus `@prisma/adapter-pg`). A bare `boss.send(...)`
 * after commit means a crash between COMMIT and the enqueue loses the event:
 * the state change is durable but the obligation it creates — send the mail,
 * recompute completion — is gone. Writing an outbox row in the same
 * transaction as the mutation makes the two atomic; they commit or roll back
 * together, and the Phase 13 drain turns the row into its side effect exactly
 * once.
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
  | "enrolment.activated";

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
