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
import {
  ticketSafeContextReference,
  type TicketContextKind,
} from "@/server/services/ticket-context-service";
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
  audit(event: BusinessAuditEvent): Promise<void>;
  writeDomainEvent(event: DomainEventInput): Promise<void>;
};

export type TicketServiceDeps = {
  repository: TicketRepository;
  getActor: () => Promise<Actor | null>;
  withPermission: WithPermission;
  generateReference?: () => string;
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
  const context =
    ticket.cohortId ? { kind: "COHORT" as TicketContextKind, id: ticket.cohortId }
    : ticket.courseId ? { kind: "COURSE" as TicketContextKind, id: ticket.courseId }
    : ticket.orderId ? { kind: "ORDER" as TicketContextKind, id: ticket.orderId }
    : ticket.submissionId ? { kind: "SUBMISSION" as TicketContextKind, id: ticket.submissionId }
    : ticket.certificateId ? { kind: "CERTIFICATE" as TicketContextKind, id: ticket.certificateId }
    : null;
  if (!context) return null;
  return {
    kind: context.kind,
    safeReference: ticketSafeContextReference(context.kind, context.id),
    href: null,
    locked: true,
  };
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

function learnerSummaryDto(ticket: TicketRecord) {
  return {
    id: ticket.id,
    reference: ticket.reference,
    subject: ticket.subject,
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    queue: ticket.queue,
    version: ticket.version,
    context: contextDto(ticket),
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    firstRespondedAt: ticket.firstRespondedAt,
    resolvedAt: ticket.resolvedAt,
    closedAt: ticket.closedAt,
  };
}

function staffSummaryDto(ticket: TicketRecord) {
  return {
    ...learnerSummaryDto(ticket),
    assigneeId: ticket.assigneeId,
  };
}

function ticketSummaryDto(ticket: TicketRecord) {
  return staffSummaryDto(ticket);
}

function learnerDetailDto(ticket: TicketRecord, messages: TicketMessageRecord[]) {
  return {
    ...learnerSummaryDto(ticket),
    messages: messages.map((message) => ({
      id: message.id,
      kind: message.kind,
      body: message.body,
      createdAt: message.createdAt,
      attachments: message.attachments.map(attachmentDto),
    })),
  };
}

function staffMessageDto(message: TicketMessageRecord) {
  return {
    id: message.id,
    ticketId: message.ticketId,
    authorId: message.authorId,
    kind: message.kind,
    visibility: message.visibility,
    body: message.body,
    createdAt: message.createdAt,
    attachments: message.attachments.map(attachmentDto),
  };
}

function isUniqueReferenceCollision(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002" &&
    (!("meta" in error) || JSON.stringify(error.meta).includes("reference"))
  );
}

function ticketAudit(
  ticket: TicketRecord,
  action: string,
  actorId: string | null,
  after: Record<string, unknown> = {},
): BusinessAuditEvent {
  return {
    actorId,
    action,
    targetType: "Ticket",
    targetId: ticket.id,
    outcome: "SUCCESS",
    after: { reference: ticket.reference, ...after },
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
      message: staffMessageDto(message),
    })),
    ...events.map((event) => ({
      kind: "EVENT" as const,
      id: event.id,
      createdAt: event.createdAt,
      event,
    })),
  ].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id));
  return { ...staffSummaryDto(ticket), timeline };
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
        try {
          const reference = generateReferenceValue();
          ticket = await tx.createTicket({ reference, userId: actor.userId, category: input.category, subject, context });
        } catch (error) {
          if (isUniqueReferenceCollision(error)) continue;
          throw error;
        }
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
      await tx.audit({
        actorId: actor.userId,
        action: "ticket.created",
        targetType: "Ticket",
        targetId: ticket.id,
        outcome: "SUCCESS",
        after: { reference: ticket.reference, category: ticket.category, context },
      });
      await tx.writeDomainEvent({
        type: "ticket.created",
        payload: { ticketId: ticket.id, reference: ticket.reference, requesterId: actor.userId },
        occurredAt: now(),
      });
      return learnerSummaryDto(ticket);
    });
  }

  async function listOwnTickets() {
    const actor = requireActor(await deps.getActor());
    return (await deps.repository.listOwn(actor.userId)).map(learnerSummaryDto);
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
        return staffSummaryDto(updated);
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
      return learnerSummaryDto(updated);
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
      await tx.audit(ticketAudit(ticket, "ticket.claimed", actor.userId, { assigneeId: actor.userId }));
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
      await tx.writeDomainEvent({
        type: "ticket.assigned",
        payload: { ticketId: ticket.id, reference: ticket.reference, assigneeId: input.assigneeId },
        occurredAt: now(),
      });
      await tx.audit(ticketAudit(ticket, "ticket.assigned", actor.userId, { assigneeId: input.assigneeId }));
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
      await tx.writeDomainEvent({
        type: "ticket.public_reply_added",
        payload: { ticketId: ticket.id, reference: ticket.reference, recipientId: ticket.userId },
        occurredAt: now(),
      });
      await tx.audit(ticketAudit(ticket, "ticket.public_reply_added", actor.userId));
    });
  }

  async function addInternalNote(input: { reference: string; expectedVersion: number; body: string }) {
    return mutateStaffTicket(input, async (ticket, tx, actor) => {
      const body = trimBounded(input.body, "Internal note", 1, 5_000);
      await tx.createMessage({ ticketId: ticket.id, authorId: actor.userId, kind: "INTERNAL_NOTE", visibility: "INTERNAL", body });
      await tx.audit(ticketAudit(ticket, "ticket.internal_note_added", actor.userId));
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
      await tx.audit(ticketAudit(ticket, "ticket.priority_changed", actor.userId, { priority: input.priority }));
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
      await tx.writeDomainEvent({
        type: "ticket.escalated",
        payload: { ticketId: ticket.id, reference: ticket.reference, queue: ticket.queue },
        occurredAt: now(),
      });
      await tx.audit(ticketAudit(ticket, "ticket.escalated", actor.userId, { queue: ticket.queue }));
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
      await tx.audit(ticketAudit(ticket, "ticket.escalation_accepted", actor.userId, { assigneeId: actor.userId }));
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
      await tx.writeDomainEvent({
        type: "ticket.resolved",
        payload: { ticketId: ticket.id, reference: ticket.reference, requesterId: ticket.userId },
        occurredAt: now(),
      });
      await tx.audit(ticketAudit(ticket, "ticket.resolved", actor.userId));
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
      await tx.writeDomainEvent({
        type: "ticket.reopened",
        payload: { ticketId: ticket.id, reference: ticket.reference, ownerId: ticket.assigneeId },
        occurredAt: now(),
      });
      await tx.audit(ticketAudit(ticket, "ticket.reopened", actor.userId));
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
      await tx.writeDomainEvent({
        type: "ticket.closed",
        payload: { ticketId: ticket.id, reference: ticket.reference, requesterId: ticket.userId },
        occurredAt: now(),
      });
      await tx.audit(ticketAudit(ticket, "ticket.closed", actor.userId));
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

type AnyPrisma = {
  ticket: any;
  ticketMessage: any;
  ticketEvent: any;
  $transaction: <R>(fn: (tx: any) => Promise<R>) => Promise<R>;
  [key: string]: any;
};

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
      select: {
        id: true,
        ticketId: true,
        authorId: true,
        kind: true,
        visibility: true,
        body: true,
        createdAt: true,
        attachments: {
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
    audit: (event) => recordAuditInTransaction(client as never, event),
    writeDomainEvent: (event) => writeDomainEvent(client as never, event),
  };
}

export function createPrismaBackedTicketService(
  client: AnyPrisma,
  options: {
    getActor: () => Promise<Actor | null>;
    withPermission: WithPermission;
    generateReference?: () => string;
    now?: () => Date;
  },
) {
  return createTicketService({
    repository: createPrismaTicketRepository(client),
    getActor: options.getActor,
    withPermission: options.withPermission,
    generateReference: options.generateReference,
    now: options.now,
  });
}

const liveService = createPrismaBackedTicketService(prisma as AnyPrisma, {
  getActor: async () => {
    const { getCurrentActor } = await import("@/server/auth/current-actor");
    return getCurrentActor();
  },
  withPermission: liveWithPermission,
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
