/**
 * Pure title/meta rendering and DTO shaping for in-product notifications
 * (D-17, T-13-03).
 *
 * `renderNotificationText` builds display text from a notification's
 * `type` plus an allow-listed subset of its stored `params` — never the
 * raw params object. Any key not on `ALLOWED_PARAM_KEYS` (a stray
 * `reason`, `body`, `filename`, or anything else a future event payload
 * might carry) is silently dropped before it ever reaches a title or meta
 * string, so a notification can never surface a staff reason, a message
 * body, or a filename (D-17).
 *
 * `NOTIFICATION_TEXT_BUILDERS` is a total `Record<NotificationType, ...>` —
 * the same exhaustiveness convention `TEMPLATE_REGISTRY` established in
 * Plan 13-02 — so adding a `NotificationType` without adding its text is a
 * compile error, not a silent runtime fallback.
 *
 * PURE MODULE. No database, no Next.js request API — safe to import from
 * the drain, route handlers, or a future client-safe layer alike.
 */

import { utcToWallParts } from "@/lib/timezone";
import type { NotificationType } from "./contracts";

/**
 * D-22/UI-SPEC — the single timezone the drawer's Today/Earlier grouping is
 * computed against. Matches the fixed zone every other staff-facing display
 * in this codebase already pins to (see `export-service.ts`,
 * `report-query-service.ts`).
 */
const APP_TIMEZONE = "Africa/Lagos";

const ALLOWED_PARAM_KEYS = [
  "reference",
  "orderReference",
  "cohortTitle",
  "sessionTitle",
  "assessmentTitle",
  "template",
  "dispatchRef",
  "queueLabel",
] as const;
type AllowedParamKey = (typeof ALLOWED_PARAM_KEYS)[number];
type SafeParams = Partial<Record<AllowedParamKey, string>>;

function pickSafeParams(
  params: Record<string, unknown> | null | undefined,
): SafeParams {
  const safe: SafeParams = {};
  if (!params) return safe;
  for (const key of ALLOWED_PARAM_KEYS) {
    const value = params[key];
    if (typeof value === "string" && value.trim().length > 0) {
      safe[key] = value;
    }
  }
  return safe;
}

export type NotificationText = { title: string; meta: string | null };

type TextBuilder = (params: SafeParams) => NotificationText;

/**
 * One builder per `NotificationType`. Every title degrades to a safe,
 * generic form when its param is absent — never a literal "undefined" or a
 * half-filled sentence.
 */
const NOTIFICATION_TEXT_BUILDERS: Record<NotificationType, TextBuilder> = {
  "enrolment.confirmed": () => ({
    title: "Your enrolment is confirmed",
    meta: null,
  }),
  "enrolment.withdrawn": (p) => ({
    title: "Your enrolment was withdrawn",
    meta: p.cohortTitle ?? null,
  }),
  "enrolment.cancelled": (p) => ({
    title: "Your enrolment was cancelled",
    meta: p.cohortTitle ?? null,
  }),
  "cohort.cancelled": (p) => ({
    title: p.cohortTitle ? `Cohort cancelled: ${p.cohortTitle}` : "Your cohort was cancelled",
    meta: null,
  }),
  "enrolment.transferred": (p) => ({
    title: "Your enrolment was transferred",
    meta: p.cohortTitle ?? null,
  }),
  "payment.failed": (p) => ({
    title: p.orderReference
      ? `Payment failed for order ${p.orderReference}`
      : "Payment failed for your order",
    meta: null,
  }),
  "payment.refunded": (p) => ({
    title: p.orderReference
      ? `Payment refunded for order ${p.orderReference}`
      : "Payment refunded",
    meta: null,
  }),
  "order.payment_exception": (p) => ({
    title: p.orderReference
      ? `Payment exception on order ${p.orderReference}`
      : "Payment exception on your order",
    meta: null,
  }),
  "session.updated": (p) => ({
    title: p.cohortTitle ? `Session updated: ${p.cohortTitle}` : "Session updated",
    meta: p.sessionTitle ?? null,
  }),
  "session.cancelled": (p) => ({
    title: p.cohortTitle ? `Session cancelled: ${p.cohortTitle}` : "A session was cancelled",
    meta: p.sessionTitle ?? null,
  }),
  "grade.released": (p) => ({
    title: p.assessmentTitle ? `Results released for ${p.assessmentTitle}` : "Results released",
    meta: null,
  }),
  "grade.overridden": (p) => ({
    title: p.assessmentTitle
      ? `Your result for ${p.assessmentTitle} was corrected`
      : "Your result was corrected",
    meta: null,
  }),
  "certificate.issued": () => ({ title: "Certificate issued", meta: null }),
  "certificate.revoked": () => ({ title: "Certificate revoked", meta: null }),
  "certificate.reissued": () => ({ title: "Certificate reissued", meta: null }),
  "ticket.created": (p) => ({
    title: p.reference ? `Your ticket ${p.reference} was created` : "Your ticket was created",
    meta: null,
  }),
  "ticket.reply": (p) => ({
    title: p.reference ? `Support ticket ${p.reference} has a reply` : "Support ticket has a reply",
    meta: null,
  }),
  "ticket.resolved": (p) => ({
    title: p.reference ? `Ticket ${p.reference} resolved` : "Your ticket was resolved",
    meta: null,
  }),
  "ticket.reopened": (p) => ({
    title: p.reference ? `Ticket ${p.reference} reopened` : "Your ticket was reopened",
    meta: null,
  }),
  "ticket.closed": (p) => ({
    title: p.reference ? `Ticket ${p.reference} closed` : "Your ticket was closed",
    meta: null,
  }),
  "staff.ticket_new": (p) => ({
    title: p.reference ? `New ticket ${p.reference}` : "New ticket",
    meta: p.queueLabel ?? null,
  }),
  "staff.ticket_assigned": (p) => ({
    title: p.reference ? `Ticket ${p.reference} assigned to you` : "A ticket was assigned to you",
    meta: null,
  }),
  "staff.ticket_escalated": (p) => ({
    title: p.reference
      ? `Ticket ${p.reference} escalated to you`
      : "A ticket was escalated to you",
    meta: null,
  }),
  "staff.submission_new": (p) => ({
    title: p.cohortTitle ? `New submission in ${p.cohortTitle}` : "New submission to grade",
    meta: null,
  }),
  "staff.order_exception": (p) => ({
    title: p.orderReference ? `Order exception: ${p.orderReference}` : "Order exception",
    meta: null,
  }),
  "staff.reconciliation_exception": (p) => ({
    title: p.reference ? `Reconciliation exception: ${p.reference}` : "Reconciliation exception",
    meta: null,
  }),
  // No address or body detail — matches the always-safe D-17 shape (T-13-03).
  "staff.email_failed": (p) => ({
    title: p.dispatchRef
      ? `An email to ${p.dispatchRef} could not be delivered.`
      : "An email could not be delivered.",
    meta: p.template ?? null,
  }),
};

function isNotificationType(type: string): type is NotificationType {
  return Object.prototype.hasOwnProperty.call(NOTIFICATION_TEXT_BUILDERS, type);
}

/**
 * Renders a notification's title and optional one-line meta from its
 * `type` plus an allow-listed subset of `params`. Any key outside the
 * allow-list — `reason`, `body`, `filename`, or anything else — never
 * reaches the returned strings (D-17). An unrecognised `type` (defensive
 * only; every persisted row's type is one this module's own vocabulary
 * generated) renders a safe generic title rather than throwing.
 */
export function renderNotificationText(
  type: string,
  params: Record<string, unknown> | null | undefined,
): NotificationText {
  const safe = pickSafeParams(params);
  if (!isNotificationType(type)) {
    return { title: "You have a new notification", meta: null };
  }
  return NOTIFICATION_TEXT_BUILDERS[type](safe);
}

export type NotificationDtoSourceRow = {
  id: string;
  type: string;
  params: unknown;
  readAt: Date | null;
  createdAt: Date;
};

export type NotificationDto = {
  id: string;
  title: string;
  meta: string | null;
  read: boolean;
  createdAt: string;
  group: "today" | "earlier";
};

/**
 * Shapes a stored notification row into the JSON the drawer renders,
 * including the server-computed Today/Earlier `group` so the client does
 * no timezone maths of its own.
 */
export function toNotificationDto(row: NotificationDtoSourceRow, now: Date): NotificationDto {
  const { title, meta } = renderNotificationText(
    row.type,
    row.params as Record<string, unknown> | null | undefined,
  );
  const rowDay = utcToWallParts(row.createdAt, APP_TIMEZONE);
  const nowDay = utcToWallParts(now, APP_TIMEZONE);
  const group: "today" | "earlier" =
    rowDay.year === nowDay.year && rowDay.month === nowDay.month && rowDay.day === nowDay.day
      ? "today"
      : "earlier";

  return {
    id: row.id,
    title,
    meta,
    read: row.readAt !== null,
    createdAt: row.createdAt.toISOString(),
    group,
  };
}
