import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import { withPermission } from "@/server/permissions";
import type { createWithPermission } from "@/server/permissions/with-permission";
import {
  getStaffTicketByReference,
  type TicketCategoryValue,
  type TicketQueueValue,
} from "@/server/services/ticket-service";
import { QUEUE_OPTIONS, QUEUE_TABS, type QueueTab } from "@/lib/support-queue";
import type { TicketPriorityValue, TicketStatusValue } from "@/server/services/ticket-lifecycle";

/**
 * Staff queue read model (SUP-03, D-06, D-10). Read-only: every mutation goes
 * through ticket-service commands. Tab/filter parsing is a pure function so
 * unrecognized URL values normalize safely and are unit-testable.
 */


const CATEGORIES: readonly TicketCategoryValue[] = [
  "ACCOUNT_ACCESS",
  "PAYMENT_ORDER",
  "COURSE_CONTENT",
  "ASSESSMENT_RESULT",
  "CERTIFICATE",
  "TECHNICAL_PROBLEM",
  "OTHER",
];
const PRIORITIES: readonly TicketPriorityValue[] = ["URGENT", "HIGH", "NORMAL", "LOW"];
const PRIORITY_RANK: Record<TicketPriorityValue, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
export const QUEUE_PAGE_SIZE = 20;
/** "Recently resolved" spans the learner reopen grace period. */
const RECENTLY_RESOLVED_MS = 7 * 24 * 60 * 60 * 1_000;

export type QueueParams = {
  tab: QueueTab;
  q: string;
  category: TicketCategoryValue | "";
  priority: TicketPriorityValue | "";
  queue: TicketQueueValue | "";
  /** "", "me", "unassigned" or a user id. */
  owner: string;
  page: number;
};

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export function parseQueueParams(raw: Record<string, string | string[] | undefined>): QueueParams {
  const tab = one(raw.tab);
  const category = one(raw.category);
  const priority = one(raw.priority).toUpperCase();
  const queue = one(raw.queue);
  const owner = one(raw.owner).slice(0, 64);
  const page = Number.parseInt(one(raw.page), 10);
  return {
    tab: (QUEUE_TABS as readonly string[]).includes(tab) ? (tab as QueueTab) : "my-work",
    q: one(raw.q).trim().slice(0, 100),
    category: (CATEGORIES as readonly string[]).includes(category) ? (category as TicketCategoryValue) : "",
    priority: (PRIORITIES as readonly string[]).includes(priority) ? (priority as TicketPriorityValue) : "",
    queue: QUEUE_OPTIONS.some((option) => option.value === queue) ? (queue as TicketQueueValue) : "",
    owner: /^[A-Za-z0-9_-]*$/.test(owner) ? owner : "",
    page: Number.isInteger(page) && page > 0 && page < 10_000 ? page : 1,
  };
}

export type QueueRow = {
  id: string;
  reference: string;
  subject: string;
  learnerName: string;
  learnerEmail: string;
  category: TicketCategoryValue;
  priority: TicketPriorityValue;
  status: TicketStatusValue;
  queue: TicketQueueValue;
  assigneeId: string | null;
  assigneeName: string | null;
  updatedAt: Date;
  resolvedAt: Date | null;
};

const isOpen = (row: Pick<QueueRow, "status">) => row.status !== "RESOLVED" && row.status !== "CLOSED";

export type QueueView = {
  params: QueueParams;
  rows: QueueRow[];
  total: number;
  pageCount: number;
  tabCounts: Record<QueueTab, number>;
  health: { open: number; unassigned: number; urgent: number; escalated: number };
  hasAnyTickets: boolean;
  asOf: Date;
};

function matchesTab(row: QueueRow, tab: QueueTab, actorId: string, now: Date): boolean {
  switch (tab) {
    case "my-work":
      return isOpen(row) && row.assigneeId === actorId;
    case "unassigned":
      return isOpen(row) && row.assigneeId === null;
    case "open":
      return isOpen(row);
    case "escalated":
      return row.status === "ESCALATED";
    case "resolved":
      return row.status === "RESOLVED" && row.resolvedAt !== null && now.getTime() - row.resolvedAt.getTime() <= RECENTLY_RESOLVED_MS;
  }
}

/** Urgent first, then oldest waiting activity, then reference as the stable tie-breaker. */
export function compareQueueRows(a: QueueRow, b: QueueRow): number {
  return (
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
    a.updatedAt.getTime() - b.updatedAt.getTime() ||
    a.reference.localeCompare(b.reference)
  );
}

export function buildQueueView(rows: readonly QueueRow[], params: QueueParams, actorId: string, now: Date): QueueView {
  const tabCounts = Object.fromEntries(
    QUEUE_TABS.map((tab) => [tab, rows.filter((row) => matchesTab(row, tab, actorId, now)).length]),
  ) as Record<QueueTab, number>;
  const needle = params.q.toLowerCase();
  const filtered = rows
    .filter((row) => matchesTab(row, params.tab, actorId, now))
    .filter((row) => !params.category || row.category === params.category)
    .filter((row) => !params.priority || row.priority === params.priority)
    .filter((row) => !params.queue || row.queue === params.queue)
    .filter((row) =>
      !params.owner ? true
      : params.owner === "me" ? row.assigneeId === actorId
      : params.owner === "unassigned" ? row.assigneeId === null
      : row.assigneeId === params.owner,
    )
    .filter((row) =>
      !needle ||
      [row.reference, row.subject, row.learnerName, row.learnerEmail].some((value) => value.toLowerCase().includes(needle)),
    )
    .sort(compareQueueRows);
  const pageCount = Math.max(1, Math.ceil(filtered.length / QUEUE_PAGE_SIZE));
  const page = Math.min(params.page, pageCount);
  const open = rows.filter(isOpen);
  return {
    params: { ...params, page },
    rows: filtered.slice((page - 1) * QUEUE_PAGE_SIZE, page * QUEUE_PAGE_SIZE),
    total: filtered.length,
    pageCount,
    tabCounts,
    health: {
      open: open.length,
      unassigned: open.filter((row) => row.assigneeId === null).length,
      urgent: open.filter((row) => row.priority === "URGENT").length,
      escalated: rows.filter((row) => row.status === "ESCALATED").length,
    },
    hasAnyTickets: rows.length > 0,
    asOf: now,
  };
}

export type TicketAssigneeOption = { id: string; name: string };

type WithPermission = ReturnType<typeof createWithPermission>;

export type TicketStaffQueueDeps = {
  client: PrismaClient;
  withPermission: WithPermission;
  getStaffTicketByReference: (reference: string) => Promise<StaffTicketDetail>;
  now?: () => Date;
};

export function createTicketStaffQueueService(deps: TicketStaffQueueDeps) {
  const { client } = deps;
  const now = deps.now ?? (() => new Date());
  const viewTickets = deps.withPermission<void>("tickets.view", () => ({}));

  const getStaffQueue = deps.withPermission<QueueParams>("tickets.view", () => ({}))(async (params, ctx) => {
    const records = await client.ticket.findMany({
      select: {
        id: true,
        reference: true,
        subject: true,
        category: true,
        priority: true,
        status: true,
        queue: true,
        assigneeId: true,
        updatedAt: true,
        resolvedAt: true,
        user: { select: { name: true, email: true } },
        assignee: { select: { name: true } },
      },
    });
    const rows: QueueRow[] = records.map((record) => ({
      id: record.id,
      reference: record.reference,
      subject: record.subject,
      learnerName: record.user.name,
      learnerEmail: record.user.email,
      category: record.category as TicketCategoryValue,
      priority: record.priority as TicketPriorityValue,
      status: record.status as TicketStatusValue,
      queue: record.queue as TicketQueueValue,
      assigneeId: record.assigneeId,
      assigneeName: record.assignee?.name ?? null,
      updatedAt: record.updatedAt,
      resolvedAt: record.resolvedAt,
    }));
    return buildQueueView(rows, params, ctx.actor.userId, now());
  });

  /** Active staff whose role currently grants tickets.manage globally. */
  const listTicketAssignees = viewTickets(async (): Promise<TicketAssigneeOption[]> => {
    const at = now();
    return client.$queryRaw<TicketAssigneeOption[]>(Prisma.sql`
      SELECT DISTINCT u.id, u.name
      FROM "User" u
      JOIN "Assignment" a ON a."userId" = u.id
      JOIN "Role" r ON r.id = a."roleId"
      WHERE u."isStaff" = TRUE
        AND u.status = 'ACTIVE'
        AND a.active = TRUE AND a."revokedAt" IS NULL
        AND (a."startsAt" IS NULL OR a."startsAt" <= ${at})
        AND (a."endsAt" IS NULL OR a."endsAt" > ${at})
        AND a."scopeType" = 'GLOBAL'
        AND r.active = TRUE
        AND 'tickets.manage' = ANY(r.permissions)
      ORDER BY u.name, u.id
    `);
  });

  /** Staff detail: full chronology plus resolved display names for every actor. */
  const getStaffTicketWorkspace = deps.withPermission<string>("tickets.view", () => ({}))(async (reference) => {
    const detail = await deps.getStaffTicketByReference(reference);
    const ids = new Set<string>();
    const learner = await client.ticket.findUnique({
      where: { reference },
      select: { user: { select: { id: true, name: true, email: true } } },
    });
    if (detail.assigneeId) ids.add(detail.assigneeId);
    for (const entry of detail.timeline) {
      if (entry.kind === "MESSAGE") ids.add(entry.message.authorId);
      else {
        if (entry.event.actorId) ids.add(entry.event.actorId);
        if (entry.event.assigneeAfterId) ids.add(entry.event.assigneeAfterId);
        if (entry.event.assigneeBeforeId) ids.add(entry.event.assigneeBeforeId);
      }
    }
    const users = await client.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } });
    const names: Record<string, string> = Object.fromEntries(users.map((user) => [user.id, user.name]));
    return { ...detail, learner: learner?.user ?? null, names };
  });

  return { getStaffQueue, listTicketAssignees, getStaffTicketWorkspace };
}

type StaffTicketDetail = Awaited<ReturnType<typeof getStaffTicketByReference>>;

const live = createTicketStaffQueueService({
  client: prisma,
  withPermission,
  getStaffTicketByReference,
});

export const getStaffQueue = live.getStaffQueue;
export const listTicketAssignees = live.listTicketAssignees;
export const getStaffTicketWorkspace = live.getStaffTicketWorkspace;
export type StaffTicketWorkspace = Awaited<ReturnType<typeof getStaffTicketWorkspace>>;
