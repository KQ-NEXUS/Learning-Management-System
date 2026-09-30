/**
 * The staff-facing mapper group (D-08, D-20): permission- and scope-resolved
 * alerts for new tickets, submissions and payment exceptions, plus the
 * assignee/escalation emails. Every audience is resolved with
 * `resolveStaffHolders` (never the request-scoped permission layer) so a
 * staff member is alerted about a record only if they could actually open it
 * (D-20, T-13-13).
 *
 * `order.exception` and `payment.reconciliation_exception` build their
 * `templateParams` from named fields only, mapping the coded reason through a
 * fixed allow-list — `exceptionNote`, free-text reason and provider detail
 * are never read (T-13-03).
 */

import {
  requireString,
  type EventMapper,
  type MapperGroup,
} from "@/server/services/event-intent-mappers";
import { buildCorrelationId } from "@/server/communications/contracts";
import { staffTicketPath, staffPaymentPath } from "@/server/communications/links";
import { createCohortScopeResolvers } from "@/server/services/cohort-scope";
import { resolveStaffHolders } from "@/server/services/staff-recipient-service";
import { QUEUE_OPTIONS } from "@/lib/support-queue";

const QUEUE_LABEL: Record<string, string> = Object.fromEntries(
  QUEUE_OPTIONS.map((option) => [option.value, option.label]),
);

function queueLabelFor(queue: unknown): string {
  return typeof queue === "string" ? (QUEUE_LABEL[queue] ?? queue) : "another queue";
}

// ---------------------------------------------------------------------------
// order.exception reason -> plain-language label allow-list (T-13-03)
// ---------------------------------------------------------------------------

const ORDER_EXCEPTION_REASON_LABELS: Record<string, string> = {
  amount_or_currency_mismatch: "Amount or currency mismatch",
  payment_attempt_not_found: "Payment attempt not found",
  illegal_payment_transition: "Payment already processed",
  illegal_transition: "Payment received after the seat hold expired",
  duplicate_active_enrolment: "Learner already enrolled",
  no_order: "Order not found",
  attempt_not_found: "Payment attempt not found",
};
const DEFAULT_ORDER_EXCEPTION_REASON_LABEL = "Payment needs review";

/** Maps a coded `order.exception` reason to its fixed plain-language label.
 * Any code outside the allow-list — including a genuinely unknown one —
 * renders the generic label rather than exposing the raw code (edge case). */
function orderExceptionReasonLabel(reason: unknown): string {
  if (typeof reason === "string" && reason in ORDER_EXCEPTION_REASON_LABELS) {
    return ORDER_EXCEPTION_REASON_LABELS[reason];
  }
  return DEFAULT_ORDER_EXCEPTION_REASON_LABEL;
}

// ---------------------------------------------------------------------------
// ticket.created — staff (D-08)
// ---------------------------------------------------------------------------

/**
 * `ticket.created` alerts every GLOBAL `tickets.manage` holder except the
 * requester, in-product only (no email, D-08). Resolved with an EMPTY
 * `ResourceScope` since tickets are authorised globally in the existing
 * staff services (mirrors `listTicketAssignees`'s own GLOBAL-only precedent).
 */
const ticketCreatedStaffAlert: EventMapper = async (event, ctx) => {
  requireString(event.payload, "ticketId");
  const reference = requireString(event.payload, "reference");
  const requesterId = requireString(event.payload, "requesterId");

  const holderIds = await resolveStaffHolders(ctx.tx, {
    permission: "tickets.manage",
    scope: {},
  });

  return holderIds
    .filter((holderId) => holderId !== requesterId)
    .map((holderId) => ({
      recipientUserId: holderId,
      notification: {
        type: "staff.ticket_new" as const,
        targetType: "STAFF_TICKET" as const,
        targetId: reference,
        params: { reference },
      },
    }));
};

// ---------------------------------------------------------------------------
// ticket.assigned / ticket.escalated — staff (D-08, A-03)
// ---------------------------------------------------------------------------

/**
 * `ticket.assigned` mails and notifies the assignee named on the payload
 * itself (the assignment just happened, so the payload's `assigneeId` is
 * trustworthy — it is the value the staff action just wrote).
 */
const ticketAssignedStaffMail: EventMapper = async (event) => {
  const reference = requireString(event.payload, "reference");
  const assigneeId = requireString(event.payload, "assigneeId");

  return [
    {
      recipientUserId: assigneeId,
      email: {
        template: "staff-ticket-assigned",
        params: { reference, ticketPath: staffTicketPath(reference) },
        correlationId: buildCorrelationId(event.id, assigneeId),
      },
      notification: {
        type: "staff.ticket_assigned",
        targetType: "STAFF_TICKET",
        targetId: reference,
        params: { reference },
      },
    },
  ];
};

/**
 * `ticket.escalated`'s payload carries only `queue` — the optional assignee
 * `escalateTicket` may set lives on the Ticket row itself, not the payload
 * (A-03), so this mapper loads the Ticket fresh. With an assignee set, only
 * that assignee is mailed and notified; with none, every GLOBAL
 * `tickets.manage` holder gets a notification only (no email fan-out, D-08).
 * A missing ticket row returns no intents.
 */
const ticketEscalatedStaffAlert: EventMapper = async (event, ctx) => {
  const ticketId = requireString(event.payload, "ticketId");
  const reference = requireString(event.payload, "reference");
  const queueLabel = queueLabelFor(event.payload.queue);

  const ticket = await ctx.tx.ticket.findUnique({
    where: { id: ticketId },
    select: { assigneeId: true },
  });
  if (!ticket) return [];

  if (ticket.assigneeId) {
    const assigneeId = ticket.assigneeId;
    return [
      {
        recipientUserId: assigneeId,
        email: {
          template: "staff-ticket-escalated",
          params: { reference, queueLabel, ticketPath: staffTicketPath(reference) },
          correlationId: buildCorrelationId(event.id, assigneeId),
        },
        notification: {
          type: "staff.ticket_escalated",
          targetType: "STAFF_TICKET",
          targetId: reference,
          params: { reference },
        },
      },
    ];
  }

  const holderIds = await resolveStaffHolders(ctx.tx, {
    permission: "tickets.manage",
    scope: {},
  });

  return holderIds.map((holderId) => ({
    recipientUserId: holderId,
    notification: {
      type: "staff.ticket_escalated" as const,
      targetType: "STAFF_TICKET" as const,
      targetId: reference,
      params: { reference },
    },
  }));
};

// ---------------------------------------------------------------------------
// order.exception / payment.reconciliation_exception — staff (D-08, T-13-03)
// ---------------------------------------------------------------------------

/**
 * `order.exception` mails and notifies every `payments.view` holder whose
 * scope reaches the order's cohort, for EVERY reason code (unlike Plan 08's
 * learner-facing mapper, which fires only for `illegal_transition`). The
 * cohort-scope resolver is built over the SAME transaction client so the
 * lookup commits atomically with everything else in this drain pass.
 */
const orderExceptionStaffMail: EventMapper = async (event, ctx) => {
  const orderId = requireString(event.payload, "orderId");
  const reasonLabel = orderExceptionReasonLabel(event.payload.reason);

  const order = await ctx.tx.order.findUnique({
    where: { id: orderId },
    select: { reference: true, cohortId: true },
  });
  if (!order) return [];

  const { cohortResourceScope } = createCohortScopeResolvers({
    cohort: ctx.tx.cohort,
    session: ctx.tx.scheduledSession,
    enrolment: ctx.tx.enrolment,
    order: ctx.tx.order,
  });
  const scope = await cohortResourceScope(order.cohortId);

  const holderIds = await resolveStaffHolders(ctx.tx, {
    permission: "payments.view",
    scope,
  });

  const paymentPath = staffPaymentPath(orderId);

  return holderIds.map((holderId) => ({
    recipientUserId: holderId,
    email: {
      template: "staff-order-exception" as const,
      params: { orderReference: order.reference, reasonLabel, paymentPath },
      correlationId: buildCorrelationId(event.id, holderId),
    },
    notification: {
      type: "staff.order_exception" as const,
      targetType: "STAFF_PAYMENT" as const,
      targetId: orderId,
      params: { orderReference: order.reference },
    },
  }));
};

/**
 * `payment.reconciliation_exception` mails and notifies the same
 * `payments.view` audience as `order.exception`. `exceptionNote` on the
 * payload is never read — the template carries only the order reference and
 * a link (T-13-03).
 */
const reconciliationExceptionStaffMail: EventMapper = async (event, ctx) => {
  const orderId = requireString(event.payload, "orderId");

  const order = await ctx.tx.order.findUnique({
    where: { id: orderId },
    select: { reference: true, cohortId: true },
  });
  if (!order) return [];

  const { cohortResourceScope } = createCohortScopeResolvers({
    cohort: ctx.tx.cohort,
    session: ctx.tx.scheduledSession,
    enrolment: ctx.tx.enrolment,
    order: ctx.tx.order,
  });
  const scope = await cohortResourceScope(order.cohortId);

  const holderIds = await resolveStaffHolders(ctx.tx, {
    permission: "payments.view",
    scope,
  });

  const paymentPath = staffPaymentPath(orderId);

  return holderIds.map((holderId) => ({
    recipientUserId: holderId,
    email: {
      template: "staff-reconciliation-exception" as const,
      params: { orderReference: order.reference, paymentPath },
      correlationId: buildCorrelationId(event.id, holderId),
    },
    notification: {
      type: "staff.reconciliation_exception" as const,
      targetType: "STAFF_PAYMENT" as const,
      targetId: orderId,
      params: { orderReference: order.reference },
    },
  }));
};

// ---------------------------------------------------------------------------
// submission.created — staff (D-08, D-20)
// ---------------------------------------------------------------------------

/**
 * `submission.created` alerts every `submissions.view` holder whose scope
 * reaches the submission's own enrolment's cohort, in-product only (no
 * email, D-08). A missing submission or enrolment row returns no intents.
 */
const submissionCreatedStaffAlert: EventMapper = async (event, ctx) => {
  const submissionId = requireString(event.payload, "submissionId");
  const assessmentId = requireString(event.payload, "assessmentId");
  const enrolmentId = requireString(event.payload, "enrolmentId");

  const enrolment = await ctx.tx.enrolment.findUnique({
    where: { id: enrolmentId },
    select: { cohortId: true },
  });
  if (!enrolment) return [];

  const { cohortResourceScope } = createCohortScopeResolvers({
    cohort: ctx.tx.cohort,
    session: ctx.tx.scheduledSession,
    enrolment: ctx.tx.enrolment,
    order: ctx.tx.order,
  });
  const scope = await cohortResourceScope(enrolment.cohortId);

  const holderIds = await resolveStaffHolders(ctx.tx, {
    permission: "submissions.view",
    scope,
  });

  return holderIds.map((holderId) => ({
    recipientUserId: holderId,
    notification: {
      type: "staff.submission_new" as const,
      targetType: "STAFF_SUBMISSION" as const,
      targetId: submissionId,
      params: { cohortId: enrolment.cohortId, assessmentId },
    },
  }));
};

export function createStaffMappers(): MapperGroup {
  return {
    "ticket.created": ticketCreatedStaffAlert,
    "ticket.assigned": ticketAssignedStaffMail,
    "ticket.escalated": ticketEscalatedStaffAlert,
    "order.exception": orderExceptionStaffMail,
    "payment.reconciliation_exception": reconciliationExceptionStaffMail,
    "submission.created": submissionCreatedStaffAlert,
  };
}
