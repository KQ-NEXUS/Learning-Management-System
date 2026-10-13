/**
 * The support-ticket mapper group (D-07). `ticket.public_reply_added` was
 * wired in Plan 07 (the tracer slice); Plan 10 adds the remaining
 * learner-facing events — `ticket.created`, `ticket.resolved`,
 * `ticket.reopened` and `ticket.closed`. `ticket.assigned` and
 * `ticket.escalated` are staff-facing and remain later plans' work.
 *
 * Every mapper here builds its params from `reference` (and a fresh
 * `learnerTicketPath(reference)`) only — never a message body, staff note or
 * attachment filename (T-13-03). `ticket.reopened` is the one exception that
 * must load the Ticket row: its payload's `ownerId` is the ASSIGNEE, which
 * may be null (a learner can reopen an unassigned ticket, A-04), so the
 * requester is resolved from the Ticket row's own `userId` instead.
 */

import {
  requireString,
  type EventMapper,
  type MapperGroup,
} from "@/server/services/event-intent-mappers";
import { learnerTicketPath } from "@/server/communications/links";
import { buildCorrelationId } from "@/server/communications/contracts";

/**
 * A ticket's requester gets one mail (template `ticket-reply`, allow-listed
 * to `reference` and a fresh `ticketPath`) and one `ticket.reply` in-product
 * notification. `ticketId` is validated (a malformed row without it is a
 * mapping failure) but never copied into a persisted row — only `reference`
 * ever reaches `templateParams`/`Notification.params` (D-17, T-13-03).
 */
const ticketPublicReplyAdded: EventMapper = async (event) => {
  // Validated for shape, deliberately unused beyond that: the mail and the
  // notification are both keyed on `reference`, never the internal ticket id.
  requireString(event.payload, "ticketId");
  const reference = requireString(event.payload, "reference");
  const recipientId = requireString(event.payload, "recipientId");

  return [
    {
      recipientUserId: recipientId,
      email: {
        template: "ticket-reply",
        params: { reference, ticketPath: learnerTicketPath(reference) },
        correlationId: buildCorrelationId(event.id),
      },
      notification: {
        type: "ticket.reply",
        targetType: "LEARNER_TICKET",
        targetId: reference,
        params: { reference },
      },
    },
  ];
};

/**
 * `ticket.created` mails the requester the ticket-created confirmation
 * (always sent — TEMPLATE_CATEGORY marks it ALWAYS) and creates the matching
 * in-product notification, the confirmation record for the requester.
 */
const ticketCreatedMail: EventMapper = async (event) => {
  // Validated for shape, deliberately unused beyond that — see the
  // `ticket.public_reply_added` mapper above for the same convention.
  requireString(event.payload, "ticketId");
  const reference = requireString(event.payload, "reference");
  const requesterId = requireString(event.payload, "requesterId");

  return [
    {
      recipientUserId: requesterId,
      email: {
        template: "ticket-created",
        params: { reference, ticketPath: learnerTicketPath(reference) },
        correlationId: buildCorrelationId(event.id),
      },
      notification: {
        type: "ticket.created",
        targetType: "LEARNER_TICKET",
        targetId: reference,
        params: { reference },
      },
    },
  ];
};

/** `ticket.resolved` mails the requester the ticket-resolved template
 * (TICKET_UPDATES — mutable) and the matching notification. */
const ticketResolvedMail: EventMapper = async (event) => {
  requireString(event.payload, "ticketId");
  const reference = requireString(event.payload, "reference");
  const requesterId = requireString(event.payload, "requesterId");

  return [
    {
      recipientUserId: requesterId,
      email: {
        template: "ticket-resolved",
        params: { reference, ticketPath: learnerTicketPath(reference) },
        correlationId: buildCorrelationId(event.id),
      },
      notification: {
        type: "ticket.resolved",
        targetType: "LEARNER_TICKET",
        targetId: reference,
        params: { reference },
      },
    },
  ];
};

/** `ticket.closed` mails the requester the ticket-closed template
 * (TICKET_UPDATES — mutable) and the matching notification, whether a staff
 * member or the auto-close job closed the ticket (the payload does not
 * distinguish them). */
const ticketClosedMail: EventMapper = async (event) => {
  requireString(event.payload, "ticketId");
  const reference = requireString(event.payload, "reference");
  const requesterId = requireString(event.payload, "requesterId");

  return [
    {
      recipientUserId: requesterId,
      email: {
        template: "ticket-closed",
        params: { reference, ticketPath: learnerTicketPath(reference) },
        correlationId: buildCorrelationId(event.id),
      },
      notification: {
        type: "ticket.closed",
        targetType: "LEARNER_TICKET",
        targetId: reference,
        params: { reference },
      },
    },
  ];
};

/**
 * `ticket.reopened` is a learner action (A-04) — the requester receives the
 * mail and notification, and no assignee alert is added. The payload's
 * `ownerId` (the assignee) may be null, so the requester and reference are
 * resolved from the Ticket row's own `userId`/`reference` rather than trusted
 * off the payload. A missing ticket row returns no intents.
 */
const ticketReopenedMail: EventMapper = async (event, ctx) => {
  const ticketId = requireString(event.payload, "ticketId");

  const ticket = await ctx.tx.ticket.findUnique({
    where: { id: ticketId },
    select: { userId: true, reference: true },
  });
  if (!ticket) return [];

  return [
    {
      recipientUserId: ticket.userId,
      email: {
        template: "ticket-reopened",
        params: { reference: ticket.reference, ticketPath: learnerTicketPath(ticket.reference) },
        correlationId: buildCorrelationId(event.id),
      },
      notification: {
        type: "ticket.reopened",
        targetType: "LEARNER_TICKET",
        targetId: ticket.reference,
        params: { reference: ticket.reference },
      },
    },
  ];
};

export function createSupportMappers(): MapperGroup {
  return {
    "ticket.public_reply_added": ticketPublicReplyAdded,
    "ticket.created": ticketCreatedMail,
    "ticket.resolved": ticketResolvedMail,
    "ticket.reopened": ticketReopenedMail,
    "ticket.closed": ticketClosedMail,
  };
}
