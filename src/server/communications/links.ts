/**
 * Pure, validated builders for every internal notification and email link
 * path (T-13-10, D-19, D-21).
 *
 * This module imports no Prisma client, no request API and nothing else
 * server-runtime — every function here is a total, synchronous string
 * builder over already-known ids. Every path segment is validated against
 * letters, digits, underscore and hyphen before it is interpolated, so a
 * stored id containing a slash, a `..` traversal, a scheme separator or
 * whitespace can never become part of a link: the builder throws instead of
 * silently producing a malformed or hostile path.
 *
 * `notificationHref` is the single place a `Notification` row's
 * `(targetType, targetId, params)` triple is turned into a relative href —
 * it is called fresh at open time (never read from storage), so a link can
 * never point somewhere the stored data does not still describe.
 */

import type { NotificationTargetType } from "@/server/communications/contracts";

const SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;

function assertSegment(value: unknown, field: string): string {
  if (typeof value !== "string" || !SEGMENT_PATTERN.test(value)) {
    throw new Error(
      `Invalid path segment for "${field}": expected letters, digits, underscore or hyphen only.`,
    );
  }
  return value;
}

export const DASHBOARD_PATH = "/dashboard";
export const EMAIL_LOG_PATH = "/staff/email-log";
export const LICENCE_PATH = "/staff/licence";

export function orderPath(reference: string): string {
  return `/orders/${assertSegment(reference, "reference")}`;
}

export function enrolmentPath(enrolmentId: string): string {
  return `/learn/${assertSegment(enrolmentId, "enrolmentId")}`;
}

export function resultsPath(enrolmentId: string): string {
  return `${enrolmentPath(enrolmentId)}/results`;
}

export function sessionsPath(enrolmentId: string): string {
  return `${enrolmentPath(enrolmentId)}/sessions`;
}

export function learnerTicketPath(reference: string): string {
  return `/support/${assertSegment(reference, "reference")}`;
}

export function staffTicketPath(reference: string): string {
  return `/staff/support/${assertSegment(reference, "reference")}`;
}

export function staffPaymentPath(orderId: string): string {
  return `/staff/payments/${assertSegment(orderId, "orderId")}`;
}

export function staffSubmissionPath(
  cohortId: string,
  assessmentId: string,
  submissionId: string,
): string {
  return `/staff/cohorts/${assertSegment(cohortId, "cohortId")}/grading/${assertSegment(
    assessmentId,
    "assessmentId",
  )}/${assertSegment(submissionId, "submissionId")}`;
}

/**
 * Maps a `Notification` row's `(targetType, targetId, params)` to the exact
 * relative path its destination page lives at. `targetId` is the id the
 * `Notification` row stores for that target (an order reference, an
 * enrolment id, a ticket reference, a submission id, ...); `params` is the
 * row's allow-listed JSON blob, read only for the two fields the
 * STAFF_SUBMISSION target needs beyond its own targetId.
 *
 * Every branch delegates to a validating builder above, so a hostile or
 * malformed stored id throws here rather than producing a bad link.
 */
export function notificationHref(
  targetType: NotificationTargetType,
  targetId: string,
  params: Record<string, unknown> = {},
): string {
  switch (targetType) {
    case "LEARNER_DASHBOARD":
      return DASHBOARD_PATH;
    case "LEARNER_ORDER":
      return orderPath(targetId);
    case "LEARNER_ENROLMENT":
      return enrolmentPath(targetId);
    case "LEARNER_RESULTS":
      return resultsPath(targetId);
    case "LEARNER_SESSIONS":
      return sessionsPath(targetId);
    case "LEARNER_TICKET":
      return learnerTicketPath(targetId);
    case "STAFF_TICKET":
      return staffTicketPath(targetId);
    case "STAFF_PAYMENT":
      return staffPaymentPath(targetId);
    case "STAFF_SUBMISSION":
      return staffSubmissionPath(
        assertSegment(params.cohortId, "params.cohortId"),
        assertSegment(params.assessmentId, "params.assessmentId"),
        targetId,
      );
    case "STAFF_EMAIL_LOG":
      return EMAIL_LOG_PATH;
    case "STAFF_LICENCE":
      return LICENCE_PATH;
    default: {
      const exhaustive: never = targetType;
      throw new Error(`Unhandled notification target type: ${String(exhaustive)}`);
    }
  }
}
