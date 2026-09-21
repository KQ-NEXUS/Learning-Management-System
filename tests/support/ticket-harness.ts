import { vi } from "vitest";
import { createTestWithPermission } from "./harness";
import type {
  TicketAttachmentRecord,
  TicketEventRecord,
  TicketMessageRecord,
  TicketRecord,
  TicketRepository,
  TicketServiceDeps,
} from "@/server/services/ticket-service";

export function makeTicketHarness(opts: { actorId: string }) {
  const now = new Date("2026-09-21T12:00:00.000Z");
  let ticketSeq = 0;
  let messageSeq = 0;
  let eventSeq = 0;
  const tickets: TicketRecord[] = [];
  const messages: TicketMessageRecord[] = [];
  const events: TicketEventRecord[] = [];
  const audits: unknown[] = [];
  const domainEvents: unknown[] = [];
  const { withPermission } = createTestWithPermission([], { userId: opts.actorId });
  const harness = {
    get actorId() {
      return opts.actorId;
    },
    set actorId(value: string) {
      opts.actorId = value;
    },
    now,
    tickets,
    messages,
    events,
    audits,
    domainEvents: domainEvents as Array<{ type: string; payload: Record<string, unknown>; occurredAt: Date }>,
    deps: undefined as unknown as TicketServiceDeps,
  };

  const repo: TicketRepository = {
    createTicket: async (data) => {
      ticketSeq += 1;
      const ticket: TicketRecord = {
        id: `ticket-${ticketSeq}`,
        reference: data.reference,
        userId: data.userId,
        category: data.category,
        subject: data.subject,
        priority: "NORMAL",
        status: "NEW",
        queue: "GENERAL_SUPPORT",
        version: 1,
        assigneeId: null,
        cohortId: data.context?.cohortId ?? null,
        courseId: data.context?.courseId ?? null,
        orderId: data.context?.orderId ?? null,
        submissionId: data.context?.submissionId ?? null,
        certificateId: data.context?.certificateId ?? null,
        createdAt: now,
        updatedAt: now,
        firstRespondedAt: null,
        resolvedAt: null,
        closedAt: null,
        reopenedAt: null,
        escalatedAt: null,
      };
      tickets.push(ticket);
      return ticket;
    },
    createMessage: async (data) => {
      messageSeq += 1;
      const message: TicketMessageRecord = {
        id: `msg-${messageSeq}`,
        ticketId: data.ticketId,
        authorId: data.authorId,
        kind: data.kind,
        visibility: data.visibility,
        body: data.body,
        createdAt: now,
        attachments: [],
      };
      messages.push(message);
      return message;
    },
    createEvent: async (data) => {
      eventSeq += 1;
      const event: TicketEventRecord = {
        id: `evt-${eventSeq}`,
        ticketId: data.ticketId,
        actorId: data.actorId,
        actorType: "USER",
        type: data.type,
        reason: data.reason ?? null,
        statusBefore: data.statusBefore ?? null,
        statusAfter: data.statusAfter ?? null,
        priorityBefore: data.priorityBefore ?? null,
        priorityAfter: data.priorityAfter ?? null,
        queueBefore: data.queueBefore ?? null,
        queueAfter: data.queueAfter ?? null,
        assigneeBeforeId: data.assigneeBeforeId ?? null,
        assigneeAfterId: data.assigneeAfterId ?? null,
        createdAt: now,
      };
      events.push(event);
      return event;
    },
    findOwnByReference: async (userId, reference) =>
      tickets.find((ticket) => ticket.userId === userId && ticket.reference === reference) ?? null,
    listOwn: async (userId) => tickets.filter((ticket) => ticket.userId === userId),
    findStaffByReference: async (reference) => tickets.find((ticket) => ticket.reference === reference) ?? null,
    listStaff: async () => tickets,
    listPublicMessages: async (ticketId) =>
      messages.filter((message) => message.ticketId === ticketId && message.visibility === "PUBLIC"),
    listAllMessages: async (ticketId) => messages.filter((message) => message.ticketId === ticketId),
    listEvents: async (ticketId) => events.filter((event) => event.ticketId === ticketId),
    updateVersioned: async (reference, expectedVersion, mutate) => {
      const ticket = tickets.find((candidate) => candidate.reference === reference);
      if (!ticket || ticket.version !== expectedVersion) return null;
      mutate(ticket);
      ticket.version += 1;
      ticket.updatedAt = now;
      return ticket;
    },
    runInTransaction: async (fn) => fn(repo),
  };

  harness.deps = {
    repository: repo,
    getActor: async () => ({ userId: opts.actorId }),
    withPermission,
    generateReference: () => "KQT-20260921-ABCDEF12",
    audit: async (entry) => {
      audits.push(entry);
    },
    writeEvent: async (_tx, event) => {
      domainEvents.push(event);
    },
    now: () => now,
  };

  return harness;
}
