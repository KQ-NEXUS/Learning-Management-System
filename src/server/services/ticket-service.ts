import { prisma } from "@/server/db";
import { withPermission as liveWithPermission } from "@/server/permissions";
import type { Actor, createWithPermission } from "@/server/permissions/with-permission";
import type { BusinessAuditEvent } from "@/server/services/audit-service";
import { recordAuditInTransaction } from "@/server/services/audit-service";
import {
  writeDomainEvent,
  type DomainEventInput,
} from "@/server/services/domain-event-service";
import {
  assertAssignmentReason,
  assertEscalationReason,
  assertPriorityReason,
  assertReopenReason,
  assertTicketTransition,
  canLearnerClose,
  canLearnerReopen,
  statusAfterPublicReply,
  type TicketPriorityValue,
  type TicketStatusValue,
} from "@/server/services/ticket-lifecycle";
import { generateTicketReference } from "@/server/services/ticket-reference";

type WithPermission = ReturnType<typeof createWithPermission>;

export type TicketCategoryValue =
  | "ACCOUNT_ACCESS"
  | "PAYMENT_ORDER"
  | "COURSE_CONTENT"
  | "ASSESSMENT_RESULT"
  | "CERTIFICATE"
  | "TECHNICAL_PROBLEM"
  | "OTHER";

export type TicketQueueValue =
  | "GENERAL_SUPPORT"
  | "ACCOUNTS"
  | "FINANCE"
  | "LEARNING_ASSESSMENT"
  | "TECHNICAL";

export type TicketMessageKindValue = "INITIAL" | "REPLY" | "INTERNAL_NOTE";
export type MessageVisibilityValue = "PUBLIC" | "INTERNAL";
export type UploadStatusValue = "UPLOADING" | "READY" | "QUARANTINED" | "REJECTED";
export type TicketEventTypeValue =
  | "CREATED"
  | "CLAIMED"
  | "ASSIGNED"
  | "REASSIGNED"
  | "PRIORITY_CHANGED"
  | "ESCALATED"
  | "ESCALATION_ACCEPTED"
  | "RESOLVED"
  | "REOPENED"
  | "LEARNER_CLOSED"
  | "AUTO_CLOSED";

export type TicketRecord = {
  id: string;
  reference: string;
  userId: string;
  category: TicketCategoryValue;
  subject: string;
  priority: TicketPriorityValue;
  status: TicketStatusValue;
  queue: TicketQueueValue;
  version: number;
  assigneeId: string | null;
  cohortId: string | null;
  courseId: string | null;
  orderId: string | null;
  submissionId: string | null;
  certificateId: string | null;
  createdAt: Date;
  updatedAt: Date;
  firstRespondedAt: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  reopenedAt: Date | null;
  escalatedAt: Date | null;
};

export type TicketAttachmentRecord = {
  id: string;
  ticketId: string;
  messageId: string;
  uploadedById: string;
  storageKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: bigint | number;
  uploadStatus: UploadStatusValue;
  uploadedAt: Date;
  createdAt: Date;
};

export type TicketMessageRecord = {
  id: string;
  ticketId: string;
  authorId: string;
  kind: TicketMessageKindValue;
  visibility: MessageVisibilityValue;
  body: string;
  createdAt: Date;
  attachments: TicketAttachmentRecord[];
};

export type TicketEventRecord = {
  id: string;
  ticketId: string;
  actorId: string | null;
  actorType: string;
  type: TicketEventTypeValue;
  reason: string | null;
  statusBefore: TicketStatusValue | null;
  statusAfter: TicketStatusValue | null;
  priorityBefore: TicketPriorityValue | null;
  priorityAfter: TicketPriorityValue | null;
  queueBefore: TicketQueueValue | null;
  queueAfter: TicketQueueValue | null;
  assigneeBeforeId: string | null;
  assigneeAfterId: string | null;
  createdAt: Date;
};

export type TicketContextInput = Partial<{
  cohortId: string;
  courseId: string;
  orderId: string;
  submissionId: string;
  certificateId: string;
}>;

export type TicketRepository = {
  createTicket(data: {
    reference: string;
    userId: string;
    category: TicketCategoryValue;
    subject: string;
    context?: TicketContextInput;
  }): Promise<TicketRecord>;
  createMessage(data: {
    ticketId: string;
    authorId: string;
    kind: TicketMessageKindValue;
    visibility: MessageVisibilityValue;
    body: string;
  }): Promise<TicketMessageRecord>;
  createEvent(data: Partial<TicketEventRecord> & {
    ticketId: string;
    actorId: string | null;
    type: TicketEventTypeValue;
  }): Promise<TicketEventRecord>;
  findOwnByReference(userId: string, reference: string): Promise<TicketRecord | null>;
  listOwn(userId: string): Promise<TicketRecord[]>;
  findStaffByReference(reference: string): Promise<TicketRecord | null>;
  listStaff(): Promise<TicketRecord[]>;
  listPublicMessages(ticketId: string): Promise<TicketMessageRecord[]>;
  listAllMessages(ticketId: string): Promise<TicketMessageRecord[]>;
  listEvents(ticketId: string): Promise<TicketEventRecord[]>;
  updateVersioned(
    reference: string,
    expectedVersion: number,
    mutate: (ticket: TicketRecord) => void | Promise<void>,
  ): Promise<TicketRecord | null>;
  runInTransaction<R>(fn: (tx: TicketRepository) => Promise<R>): Promise<R>;
};

export type TicketServiceDeps = {
  repository: TicketRepository;
  getActor: () => Promise<Actor | null>;
  withPermission: WithPermission;
  generateReference?: () => string;
  audit: (event: BusinessAuditEvent) => Promise<void>;
  writeEvent: (tx: TicketRepository, event: DomainEventInput) => Promise<void>;
  now?: () => Date;
};

export class TicketNotFoundError extends Error {
  constructor() {
    super("Ticket not found.");
    this.name = "TicketNotFoundError";
  }
}

export class StaleTicketVersionError extends Error {
  constructor() {
    super("The ticket changed while you were working. Refresh and try again.");
    this.name = "StaleTicketVersionError";
  }
}

function requireActor(actor: Actor | null): Actor {
  if (!actor) throw new Error("Sign in to continue.");
  return actor;
}

function trimBounded(value: string, field: string, min: number, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new TypeError(`${field} must be between ${min} and ${max} characters.`);
  }
  return trimmed;
}

function normalizeContext(context: TicketContextInput | undefined): TicketContextInput | undefined {
  if (!context) return undefined;
  const entries = Object.entries(context).filter(([, value]) => typeof value === "string" && value.trim());
  if (entries.length > 1) throw new TypeError("A support ticket can reference at most one contextual record.");
  if (entries.length === 0) return undefined;
  const [key, value] = entries[0] as [keyof TicketContextInput, string];
  return { [key]: value.trim() };
}

function contextDto(ticket: TicketRecord) {
  if (ticket.cohortId) return { kind: "COHORT" as const, id: ticket.cohortId };
  if (ticket.courseId) return { kind: "COURSE" as const, id: ticket.courseId };
  if (ticket.orderId) return { kind: "ORDER" as const, id: ticket.orderId };
  if (ticket.submissionId) return { kind: "SUBMISSION" as const, id: ticket.submissionId };
  if (ticket.certificateId) return { kind: "CERTIFICATE" as const, id: ticket.certificateId };
  return null;
}

function attachmentDto(attachment: TicketAttachmentRecord) {
  return {
    id: attachment.id,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    sizeBytes: Number(attachment.sizeBytes),
    uploadStatus: attachment.uploadStatus,
    uploadedAt: attachment.uploadedAt,
  };
}

function ticketSummaryDto(ticket: TicketRecord) {
  return {
    id: ticket.id,
    reference: ticket.reference,
    subject: ticket.subject,
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    queue: ticket.queue,
    version: ticket.version,
    assigneeId: ticket.assigneeId,
    context: contextDto(ticket),
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    firstRespondedAt: ticket.firstRespondedAt,
    resolvedAt: ticket.resolvedAt,
    closedAt: ticket.closedAt,
  };
}

function learnerDetailDto(ticket: TicketRecord, messages: TicketMessageRecord[]) {
  return {
    ...ticketSummaryDto(ticket),
    messages: messages.map((message) => ({
      id: message.id,
      kind: message.kind,
      authorId: message.authorId,
      body: message.body,
      createdAt: message.createdAt,
      attachments: message.attachments.map(attachmentDto),
    })),
  };
}

function staffDetailDto(
  ticket: TicketRecord,
  messages: TicketMessageRecord[],
  events: TicketEventRecord[],
) {
  const timeline = [
    ...messages.map((message) => ({
      kind: "MESSAGE" as const,
      id: message.id,
      createdAt: message.createdAt,
      message,
    })),
    ...events.map((event) => ({
      kind: "EVENT" as const,
      id: event.id,
      createdAt: event.createdAt,
      event,
    })),
  ].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id));
  return { ...ticketSummaryDto(ticket), timeline };
}

export function createTicketService(deps: TicketServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const generateReferenceValue = deps.generateReference ?? generateTicketReference;

  async function createOwnTicket(input: {
    category: TicketCategoryValue;
    subject: string;
    body: string;
    context?: TicketContextInput;
  }) {
    const actor = requireActor(await deps.getActor());
    const subject = trimBounded(input.subject, "Subject", 3, 160);
    const body = trimBounded(input.body, "Message", 3, 5_000);
    const context = normalizeContext(input.context);

    return deps.repository.runInTransaction(async (tx) => {
      let ticket: TicketRecord | null = null;
      for (let attempt = 0; attempt < 3 && !ticket; attempt += 1) {
        const reference = generateReferenceValue();
        ticket = await tx.createTicket({ reference, userId: actor.userId, category: input.category, subject, context });
      }
      if (!ticket) throw new Error("Could not allocate a support ticket reference.");

      await tx.createMessage({
        ticketId: ticket.id,
        authorId: actor.userId,
        kind: "INITIAL",
        visibility: "PUBLIC",
        body,
      });
      await tx.createEvent({ ticketId: ticket.id, actorId: actor.userId, type: "CREATED" });
      await deps.audit({
        actorId: actor.userId,
        action: "ticket.created",
        targetType: "Ticket",
        targetId: ticket.id,
        outcome: "SUCCESS",
        after: { reference: ticket.reference, category: ticket.category, context },
      });
      await deps.writeEvent(tx, {
        type: "ticket.created",
        payload: { ticketId: ticket.id, reference: ticket.reference, requesterId: actor.userId },
        occurredAt: now(),
      });
      return ticketSummaryDto(ticket);
    });
  }

  async function listOwnTickets() {
    const actor = requireActor(await deps.getActor());
    return (await deps.repository.listOwn(actor.userId)).map(ticketSummaryDto);
  }

  async function getOwnTicketByReference(reference: string) {
    const actor = requireActor(await deps.getActor());
    const ticket = await deps.repository.findOwnByReference(actor.userId, reference);
    if (!ticket) throw new TicketNotFoundError();
    const messages = await deps.repository.listPublicMessages(ticket.id);
    return learnerDetailDto(ticket, messages);
  }

  const listStaffTickets = deps.withPermission("tickets.view", () => ({}))(async () =>
    (await deps.repository.listStaff()).map(ticketSummaryDto),
  );

  const getStaffTicketByReference = deps.withPermission<string>("tickets.view", () => ({}))(async (reference) => {
    const ticket = await deps.repository.findStaffByReference(reference);
    if (!ticket) throw new TicketNotFoundError();
    const [messages, events] = await Promise.all([
      deps.repository.listAllMessages(ticket.id),
      deps.repository.listEvents(ticket.id),
    ]);
    return staffDetailDto(ticket, messages, events);
  });

  async function mutateStaffTicket(
    input: { reference: string; expectedVersion: number },
    operation: (ticket: TicketRecord, tx: TicketRepository, actor: Actor) => Promise<void> | void,
  ) {
    return deps.withPermission<typeof input>("tickets.manage", () => ({}))(async (authorizedInput, ctx) =>
      deps.repository.runInTransaction(async (tx) => {
        const updated = await tx.updateVersioned(authorizedInput.reference, authorizedInput.expectedVersion, (ticket) =>
          operation(ticket, tx, ctx.actor),
        );
        if (!updated) throw new StaleTicketVersionError();
        return ticketSummaryDto(updated);
      }),
    )(input);
  }

  async function mutateOwnTicket(
    input: { reference: string; expectedVersion: number },
    operation: (ticket: TicketRecord, tx: TicketRepository, actor: Actor) => Promise<void> | void,
  ) {
    const actor = requireActor(await deps.getActor());
    const existing = await deps.repository.findOwnByReference(actor.userId, input.reference);
    if (!existing) throw new TicketNotFoundError();
    return deps.repository.runInTransaction(async (tx) => {
      const updated = await tx.updateVersioned(input.reference, input.expectedVersion, (ticket) =>
        operation(ticket, tx, actor),
      );
      if (!updated) throw new StaleTicketVersionError();
      return ticketSummaryDto(updated);
    });
  }

  async function claimTicket(input: { reference: string; expectedVersion: number }) {
    return mutateStaffTicket(input, async (ticket, tx, actor) => {
      const before = { status: ticket.status, assigneeId: ticket.assigneeId };
      const nextStatus: TicketStatusValue = "ASSIGNED";
      assertTicketTransition(ticket.status, nextStatus);
      ticket.status = nextStatus;
      ticket.assigneeId = actor.userId;
      await tx.createEvent({
        ticketId: ticket.id,
        actorId: actor.userId,
        type: before.assigneeId ? "REASSIGNED" : "CLAIMED",
        statusBefore: before.status,
        statusAfter: nextStatus,
        assigneeBeforeId: before.assigneeId,
        assigneeAfterId: actor.userId,
      });
    });
  }

  async function assignTicket(input: {
    reference: string;
    expectedVersion: number;
    assigneeId: string;
    reason?: string | null;
  }) {
    return mutateStaffTicket(input, async (ticket, tx, actor) => {
      assertAssignmentReason(ticket.assigneeId, input.assigneeId, input.reason);
      const before = { status: ticket.status, assigneeId: ticket.assigneeId };
      const nextStatus: TicketStatusValue = "ASSIGNED";
      if (ticket.status !== nextStatus) assertTicketTransition(ticket.status, nextStatus);
      ticket.status = nextStatus;
      ticket.assigneeId = input.assigneeId;
      await tx.createEvent({
        ticketId: ticket.id,
        actorId: actor.userId,
        type: before.assigneeId ? "REASSIGNED" : "ASSIGNED",
        reason: input.reason ?? null,
        statusBefore: before.status,
        statusAfter: nextStatus,
        assigneeBeforeId: before.assigneeId,
        assigneeAfterId: input.assigneeId,
      });
      await deps.writeEvent(tx, {
        type: "ticket.assigned",
        payload: { ticketId: ticket.id, reference: ticket.reference, assigneeId: input.assigneeId },
        occurredAt: now(),
      });
    });
  }

  async function addPublicReply(input: { reference: string; expectedVersion: number; body: string }) {
    return mutateStaffTicket(input, async (ticket, tx, actor) => {
      const body = trimBounded(input.body, "Reply", 1, 5_000);
      const before = ticket.status;
      const after = statusAfterPublicReply(ticket.status);
      if (before !== after) ticket.status = after;
      if (!ticket.firstRespondedAt) ticket.firstRespondedAt = now();
      await tx.createMessage({ ticketId: ticket.id, authorId: actor.userId, kind: "REPLY", visibility: "PUBLIC", body });
      await deps.writeEvent(tx, {
        type: "ticket.public_reply_added",
        payload: { ticketId: ticket.id, reference: ticket.reference, recipientId: ticket.userId },
        occurredAt: now(),
      });
    });
  }

  async function addInternalNote(input: { reference: string; expectedVersion: number; body: string }) {
    return mutateStaffTicket(input, async (ticket, tx, actor) => {
      const body = trimBounded(input.body, "Internal note", 1, 5_000);
      await tx.createMessage({ ticketId: ticket.id, authorId: actor.userId, kind: "INTERNAL_NOTE", visibility: "INTERNAL", body });
    });
  }

  async function changePriority(input: {
    reference: string;
    expectedVersion: number;
    priority: TicketPriorityValue;
    reason?: string | null;
  }) {
    return mutateStaffTicket(input, async (ticket, tx, actor) => {
      assertPriorityReason(input.priority, input.reason);
      const before = ticket.priority;
      ticket.priority = input.priority;
      await tx.createEvent({
        ticketId: ticket.id,
        actorId: actor.userId,
        type: "PRIORITY_CHANGED",
        reason: input.reason ?? null,
        priorityBefore: before,
        priorityAfter: input.priority,
      });
    });
  }

  async function escalateTicket(input: {
    reference: string;
    expectedVersion: number;
    queue?: TicketQueueValue;
    reason?: string | null;
  }) {
    return mutateStaffTicket(input, async (ticket, tx, actor) => {
      assertEscalationReason(input.reason);
      const before = { status: ticket.status, queue: ticket.queue };
      assertTicketTransition(ticket.status, "ESCALATED");
      ticket.status = "ESCALATED";
      ticket.queue = input.queue ?? ticket.queue;
      ticket.escalatedAt = now();
      await tx.createEvent({
        ticketId: ticket.id,
        actorId: actor.userId,
        type: "ESCALATED",
        reason: input.reason ?? null,
        statusBefore: before.status,
        statusAfter: "ESCALATED",
        queueBefore: before.queue,
        queueAfter: ticket.queue,
      });
      await deps.writeEvent(tx, {
        type: "ticket.escalated",
        payload: { ticketId: ticket.id, reference: ticket.reference, queue: ticket.queue },
        occurredAt: now(),
      });
    });
  }

  async function acceptEscalation(input: { reference: string; expectedVersion: number }) {
    return mutateStaffTicket(input, async (ticket, tx, actor) => {
      const before = { status: ticket.status, assigneeId: ticket.assigneeId };
      assertTicketTransition(ticket.status, "ASSIGNED");
      ticket.status = "ASSIGNED";
      ticket.assigneeId = actor.userId;
      await tx.createEvent({
        ticketId: ticket.id,
        actorId: actor.userId,
        type: "ESCALATION_ACCEPTED",
        statusBefore: before.status,
        statusAfter: "ASSIGNED",
        assigneeBeforeId: before.assigneeId,
        assigneeAfterId: actor.userId,
      });
    });
  }

  async function resolveTicket(input: { reference: string; expectedVersion: number; reason?: string | null }) {
    return mutateStaffTicket(input, async (ticket, tx, actor) => {
      const before = ticket.status;
      assertTicketTransition(before, "RESOLVED");
      ticket.status = "RESOLVED";
      ticket.resolvedAt = now();
      await tx.createEvent({
        ticketId: ticket.id,
        actorId: actor.userId,
        type: "RESOLVED",
        reason: input.reason ?? null,
        statusBefore: before,
        statusAfter: "RESOLVED",
      });
      await deps.writeEvent(tx, {
        type: "ticket.resolved",
        payload: { ticketId: ticket.id, reference: ticket.reference, requesterId: ticket.userId },
        occurredAt: now(),
      });
    });
  }

  async function reopenOwnTicket(input: { reference: string; expectedVersion: number; reason?: string | null }) {
    return mutateOwnTicket(input, async (ticket, tx, actor) => {
      assertReopenReason(input.reason);
      if (!canLearnerReopen(ticket.status, ticket.resolvedAt, now())) {
        throw new Error("This ticket can no longer be reopened.");
      }
      const before = ticket.status;
      const after: TicketStatusValue = ticket.assigneeId ? "ASSIGNED" : "OPEN";
      ticket.status = after;
      ticket.reopenedAt = now();
      await tx.createEvent({
        ticketId: ticket.id,
        actorId: actor.userId,
        type: "REOPENED",
        reason: input.reason ?? null,
        statusBefore: before,
        statusAfter: after,
      });
      await deps.writeEvent(tx, {
        type: "ticket.reopened",
        payload: { ticketId: ticket.id, reference: ticket.reference, ownerId: ticket.assigneeId },
        occurredAt: now(),
      });
    });
  }

  async function closeOwnTicket(input: { reference: string; expectedVersion: number }) {
    return mutateOwnTicket(input, async (ticket, tx, actor) => {
      if (!canLearnerClose(ticket.status)) {
        throw new Error("Only a resolved ticket can be closed.");
      }
      const before = ticket.status;
      ticket.status = "CLOSED";
      ticket.closedAt = now();
      await tx.createEvent({
        ticketId: ticket.id,
        actorId: actor.userId,
        type: "LEARNER_CLOSED",
        statusBefore: before,
        statusAfter: "CLOSED",
      });
      await deps.writeEvent(tx, {
        type: "ticket.closed",
        payload: { ticketId: ticket.id, reference: ticket.reference, requesterId: ticket.userId },
        occurredAt: now(),
      });
    });
  }

  return {
    createOwnTicket,
    listOwnTickets,
    getOwnTicketByReference,
    listStaffTickets,
    getStaffTicketByReference,
    claimTicket,
    assignTicket,
    addPublicReply,
    addInternalNote,
    changePriority,
    escalateTicket,
    acceptEscalation,
    resolveTicket,
    reopenOwnTicket,
    closeOwnTicket,
  };
}

type AnyPrisma = typeof prisma & { [key: string]: any };

function createPrismaTicketRepository(client: AnyPrisma): TicketRepository {
  const mapTicket = (ticket: any): TicketRecord => ticket as TicketRecord;
  const mapMessage = (message: any): TicketMessageRecord => ({
    ...message,
    attachments: message.attachments ?? [],
  });

  return {
    createTicket: (data) => client.ticket.create({ data }).then(mapTicket),
    createMessage: (data) => client.ticketMessage.create({ data }).then(mapMessage),
    createEvent: (data) => client.ticketEvent.create({ data }).then((event: any) => event as TicketEventRecord),
    findOwnByReference: (userId, reference) => client.ticket.findFirst({ where: { userId, reference } }).then((ticket: any) => ticket ? mapTicket(ticket) : null),
    listOwn: (userId) => client.ticket.findMany({ where: { userId }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }] }).then((rows: any[]) => rows.map(mapTicket)),
    findStaffByReference: (reference) => client.ticket.findUnique({ where: { reference } }).then((ticket: any) => ticket ? mapTicket(ticket) : null),
    listStaff: () => client.ticket.findMany({ orderBy: [{ updatedAt: "desc" }, { id: "asc" }] }).then((rows: any[]) => rows.map(mapTicket)),
    listPublicMessages: (ticketId) => client.ticketMessage.findMany({
      where: { ticketId, visibility: "PUBLIC" },
      select: {
        id: true,
        ticketId: true,
        authorId: true,
        kind: true,
        visibility: true,
        body: true,
        createdAt: true,
        attachments: {
          where: { uploadStatus: "READY" },
          select: {
            id: true,
            ticketId: true,
            messageId: true,
            uploadedById: true,
            filename: true,
            mimeType: true,
            sizeBytes: true,
            uploadStatus: true,
            uploadedAt: true,
            createdAt: true,
          },
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }).then((rows: any[]) => rows.map(mapMessage)),
    listAllMessages: (ticketId) => client.ticketMessage.findMany({
      where: { ticketId },
      include: { attachments: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }).then((rows: any[]) => rows.map(mapMessage)),
    listEvents: (ticketId) => client.ticketEvent.findMany({
      where: { ticketId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }).then((rows: any[]) => rows as TicketEventRecord[]),
    updateVersioned: async (reference, expectedVersion, mutate) => {
      const current = await client.ticket.findUnique({ where: { reference } });
      if (!current || current.version !== expectedVersion) return null;
      const copy = mapTicket({ ...current });
      await mutate(copy);
      const result = await client.ticket.updateMany({
        where: { id: copy.id, version: expectedVersion },
        data: {
          status: copy.status,
          priority: copy.priority,
          queue: copy.queue,
          assigneeId: copy.assigneeId,
          firstRespondedAt: copy.firstRespondedAt,
          resolvedAt: copy.resolvedAt,
          closedAt: copy.closedAt,
          reopenedAt: copy.reopenedAt,
          escalatedAt: copy.escalatedAt,
          version: { increment: 1 },
        },
      });
      if (result.count === 0) return null;
      return client.ticket.findUnique({ where: { id: copy.id } }).then(mapTicket);
    },
    runInTransaction: (fn) => client.$transaction((tx: AnyPrisma) => fn(createPrismaTicketRepository(tx))),
  };
}

const liveService = createTicketService({
  repository: createPrismaTicketRepository(prisma as AnyPrisma),
  getActor: async () => {
    const { getCurrentActor } = await import("@/server/auth/current-actor");
    return getCurrentActor();
  },
  withPermission: liveWithPermission,
  audit: async (event) => recordAuditInTransaction(prisma as never, event),
  writeEvent: async (_tx, event) => writeDomainEvent(prisma as never, event),
});

export const createOwnTicket = liveService.createOwnTicket;
export const listOwnTickets = liveService.listOwnTickets;
export const getOwnTicketByReference = liveService.getOwnTicketByReference;
export const listStaffTickets = liveService.listStaffTickets;
export const getStaffTicketByReference = liveService.getStaffTicketByReference;
export const claimTicket = liveService.claimTicket;
export const assignTicket = liveService.assignTicket;
export const addPublicTicketReply = liveService.addPublicReply;
export const addInternalTicketNote = liveService.addInternalNote;
export const changeTicketPriority = liveService.changePriority;
export const escalateTicket = liveService.escalateTicket;
export const acceptTicketEscalation = liveService.acceptEscalation;
export const resolveTicket = liveService.resolveTicket;
export const reopenOwnTicket = liveService.reopenOwnTicket;
export const closeOwnTicket = liveService.closeOwnTicket;
