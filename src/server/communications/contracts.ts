/**
 * Shared vocabulary for the transactional communications spine (Phase 13).
 *
 * Every persisted string here (statuses, template ids, notification types,
 * target types, categories, skip reasons) is read by several later plans and
 * stored in rows, so it is defined once. This module is pure: it imports only
 * a type, never the Prisma client or a Next.js request API, so mappers,
 * templates, resolvers and UI can all depend on it without pulling in server
 * runtime.
 */

import type { DomainEventType } from "@/server/services/domain-event-service";

// ---------------------------------------------------------------------------
// Email dispatch status (mirrors the EmailDispatch_status_check constraint)
// ---------------------------------------------------------------------------

export const EMAIL_STATUS = {
  QUEUED: "QUEUED",
  SENDING: "SENDING",
  SENT: "SENT",
  FAILED: "FAILED",
  SKIPPED: "SKIPPED",
} as const;
export type EmailStatus = (typeof EMAIL_STATUS)[keyof typeof EMAIL_STATUS];

// ---------------------------------------------------------------------------
// Categories (D-16)
// ---------------------------------------------------------------------------

export const EMAIL_CATEGORY = {
  AUTH: "AUTH",
  ALWAYS: "ALWAYS",
  TICKET_UPDATES: "TICKET_UPDATES",
  RESULT_NOTICES: "RESULT_NOTICES",
  SESSION_CHANGES: "SESSION_CHANGES",
  ENROLMENT_STATUS: "ENROLMENT_STATUS",
  STAFF: "STAFF",
} as const;
export type EmailCategory = (typeof EMAIL_CATEGORY)[keyof typeof EMAIL_CATEGORY];

/** The only categories a recipient may mute. AUTH, ALWAYS and STAFF never are. */
export const MUTABLE_EMAIL_CATEGORIES = [
  "TICKET_UPDATES",
  "RESULT_NOTICES",
  "SESSION_CHANGES",
  "ENROLMENT_STATUS",
] as const;
export type MutableEmailCategory = (typeof MUTABLE_EMAIL_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// Template ids (29). The legacy `order-confirmation` id exists only on
// historical EmailDispatch rows and is deliberately absent.
// ---------------------------------------------------------------------------

export const TEMPLATE_IDS = [
  // Auth
  "email-verification",
  "password-reset",
  "email-change-confirmation",
  // F-14c — security notice to the address being replaced (no link).
  "email-changed-notice",
  // Always-sent learner mail
  "enrolment-confirmed",
  "payment-failed",
  "payment-refunded",
  "order-payment-exception",
  "session-cancelled",
  "cohort-cancelled",
  "certificate-issued",
  "certificate-revoked",
  "certificate-reissued",
  "ticket-created",
  // Mutable learner mail
  "enrolment-withdrawn",
  "enrolment-cancelled",
  "enrolment-transferred",
  "session-updated",
  "grade-released",
  "grade-overridden",
  "ticket-reply",
  "ticket-resolved",
  "ticket-reopened",
  "ticket-closed",
  // Staff
  "staff-ticket-assigned",
  "staff-ticket-escalated",
  "staff-order-exception",
  "staff-reconciliation-exception",
  // Phase 14 (D-15) — licence notice to Global licence.view holders.
  "staff-licence-notice",
] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export const TEMPLATE_CATEGORY: Record<TemplateId, EmailCategory> = {
  "email-verification": "AUTH",
  "password-reset": "AUTH",
  "email-change-confirmation": "AUTH",
  "email-changed-notice": "AUTH",
  "enrolment-confirmed": "ALWAYS",
  "payment-failed": "ALWAYS",
  "payment-refunded": "ALWAYS",
  "order-payment-exception": "ALWAYS",
  "session-cancelled": "ALWAYS",
  "cohort-cancelled": "ALWAYS",
  "certificate-issued": "ALWAYS",
  "certificate-revoked": "ALWAYS",
  "certificate-reissued": "ALWAYS",
  "ticket-created": "ALWAYS",
  "enrolment-withdrawn": "ENROLMENT_STATUS",
  "enrolment-cancelled": "ENROLMENT_STATUS",
  "enrolment-transferred": "ENROLMENT_STATUS",
  "session-updated": "SESSION_CHANGES",
  "grade-released": "RESULT_NOTICES",
  "grade-overridden": "RESULT_NOTICES",
  "ticket-reply": "TICKET_UPDATES",
  "ticket-resolved": "TICKET_UPDATES",
  "ticket-reopened": "TICKET_UPDATES",
  "ticket-closed": "TICKET_UPDATES",
  "staff-ticket-assigned": "STAFF",
  "staff-ticket-escalated": "STAFF",
  "staff-order-exception": "STAFF",
  "staff-reconciliation-exception": "STAFF",
  "staff-licence-notice": "STAFF",
};

// ---------------------------------------------------------------------------
// Notifications (D-17)
// ---------------------------------------------------------------------------

export const NOTIFICATION_TARGET_TYPES = [
  "LEARNER_DASHBOARD",
  "LEARNER_ORDER",
  "LEARNER_ENROLMENT",
  "LEARNER_RESULTS",
  "LEARNER_SESSIONS",
  "LEARNER_TICKET",
  "STAFF_TICKET",
  "STAFF_PAYMENT",
  "STAFF_SUBMISSION",
  "STAFF_EMAIL_LOG",
  "STAFF_LICENCE",
] as const;
export type NotificationTargetType = (typeof NOTIFICATION_TARGET_TYPES)[number];

export const NOTIFICATION_TYPES = [
  "enrolment.confirmed",
  "enrolment.withdrawn",
  "enrolment.cancelled",
  "cohort.cancelled",
  "enrolment.transferred",
  "payment.failed",
  "payment.refunded",
  "order.payment_exception",
  "session.updated",
  "session.cancelled",
  "grade.released",
  "grade.overridden",
  "certificate.issued",
  "certificate.revoked",
  "certificate.reissued",
  "ticket.created",
  "ticket.reply",
  "ticket.resolved",
  "ticket.reopened",
  "ticket.closed",
  "staff.ticket_new",
  "staff.ticket_assigned",
  "staff.ticket_escalated",
  "staff.ticket_reopened",
  "staff.submission_new",
  "staff.order_exception",
  "staff.reconciliation_exception",
  "staff.email_failed",
  "staff.licence_notice",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_TYPE_TARGET: Record<
  NotificationType,
  NotificationTargetType
> = {
  "enrolment.confirmed": "LEARNER_ENROLMENT",
  "enrolment.withdrawn": "LEARNER_DASHBOARD",
  "enrolment.cancelled": "LEARNER_DASHBOARD",
  "cohort.cancelled": "LEARNER_DASHBOARD",
  "enrolment.transferred": "LEARNER_ENROLMENT",
  "payment.failed": "LEARNER_ORDER",
  "payment.refunded": "LEARNER_ORDER",
  "order.payment_exception": "LEARNER_ORDER",
  "session.updated": "LEARNER_SESSIONS",
  "session.cancelled": "LEARNER_SESSIONS",
  "grade.released": "LEARNER_RESULTS",
  "grade.overridden": "LEARNER_RESULTS",
  "certificate.issued": "LEARNER_DASHBOARD",
  "certificate.revoked": "LEARNER_DASHBOARD",
  "certificate.reissued": "LEARNER_DASHBOARD",
  "ticket.created": "LEARNER_TICKET",
  "ticket.reply": "LEARNER_TICKET",
  "ticket.resolved": "LEARNER_TICKET",
  "ticket.reopened": "LEARNER_TICKET",
  "ticket.closed": "LEARNER_TICKET",
  "staff.ticket_new": "STAFF_TICKET",
  "staff.ticket_assigned": "STAFF_TICKET",
  "staff.ticket_escalated": "STAFF_TICKET",
  "staff.ticket_reopened": "STAFF_TICKET",
  "staff.submission_new": "STAFF_SUBMISSION",
  "staff.order_exception": "STAFF_PAYMENT",
  "staff.reconciliation_exception": "STAFF_PAYMENT",
  "staff.email_failed": "STAFF_EMAIL_LOG",
  "staff.licence_notice": "STAFF_LICENCE",
};

// ---------------------------------------------------------------------------
// Skip reasons, retry policy
// ---------------------------------------------------------------------------

export const SKIP_REASONS = [
  "recipient_deactivated",
  "email_unverified",
  "muted_by_recipient",
  "superseded_by_cohort_cancellation",
  "superseded_by_session_cancellation",
  "coalesced_into_later_update",
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

/** Delay before the next send attempt after the 1st..4th failure (A-19). */
export const RETRY_BACKOFF_MS = [
  60_000, // 1 minute
  300_000, // 5 minutes
  1_800_000, // 30 minutes
  7_200_000, // 2 hours
] as const;
/** FAILED follows the fifth failed send attempt. */
export const MAX_SEND_ATTEMPTS = 5;
/** A DomainEvent that throws this many times is marked processed-with-error. */
export const MAX_EVENT_ATTEMPTS = 3;
/** A SENDING row older than this is treated as a crashed send and reclaimed. */
export const STALE_SENDING_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Domain events
// ---------------------------------------------------------------------------

const DOMAIN_EVENT_TYPE_SET: Record<DomainEventType, true> = {
  "enrolment.created": true,
  "enrolment.approved": true,
  "enrolment.transferred": true,
  "enrolment.withdrawn": true,
  "enrolment.cancelled": true,
  "enrolment.hold_expired": true,
  "attendance.changed": true,
  "cohort.published": true,
  "cohort.cancelled": true,
  "session.created": true,
  "session.updated": true,
  "session.cancelled": true,
  "order.created": true,
  "order.paid": true,
  "order.exception": true,
  "enrolment.activated": true,
  "payment.reconciled": true,
  "payment.reconciliation_exception": true,
  "lesson.completed": true,
  "course.completed": true,
  "programme.completed": true,
  "attempt.submitted": true,
  "submission.created": true,
  "grade.released": true,
  "grade.overridden": true,
  "certificate.issued": true,
  "certificate.review_flagged": true,
  "certificate.revoked": true,
  "certificate.reissued": true,
  "ticket.created": true,
  "ticket.public_reply_added": true,
  "ticket.assigned": true,
  "ticket.escalated": true,
  "ticket.resolved": true,
  "ticket.reopened": true,
  "ticket.closed": true,
  "payment.failed": true,
  "payment.refunded": true,
  "licence.notice": true,
};

/** Every DomainEventType member exactly once; a missing member is a type error. */
export const DOMAIN_EVENT_TYPE_LIST = Object.keys(
  DOMAIN_EVENT_TYPE_SET,
) as DomainEventType[];

/**
 * D-05 — the dedupe key half of EmailDispatch's (template, correlationId)
 * unique. The event id alone for a single-recipient event; suffixed with the
 * recipient when one event fans out to several people.
 */
export function buildCorrelationId(
  eventId: string,
  recipientUserId?: string,
): string {
  return recipientUserId ? `${eventId}:${recipientUserId}` : eventId;
}
