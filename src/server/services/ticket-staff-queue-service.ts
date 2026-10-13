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

/*
 * SQL translation of buildQueueView (NFR-02, folded todo 2026-09-25). The
 * pure buildQueueView above stays the oracle: the differential test
 * (tests/ticket-staff-queue-sql.integration.test.ts) proves the SQL path
 * returns the same QueueView for every tab, filter, search and page.
 */
const CLOSED_STATUSES: TicketStatusValue[] = ["RESOLVED", "CLOSED"];

function tabWhere(tab: QueueTab, actorId: string, now: Date): Prisma.TicketWhereInput {
  switch (tab) {
    case "my-work":
      return { status: { notIn: CLOSED_STATUSES }, assigneeId: actorId };
    case "unassigned":
      return { status: { notIn: CLOSED_STATUSES }, assigneeId: null };
    case "open":
      return { status: { notIn: CLOSED_STATUSES } };
    case "escalated":
      return { status: "ESCALATED" };
    case "resolved":
      return { status: "RESOLVED", resolvedAt: { gte: new Date(now.getTime() - RECENTLY_RESOLVED_MS) } };
  }
}

/** Tab plus every filter and the text search, as one parameterised where (T-15-09-02). */
export function queueWhere(params: QueueParams, actorId: string, now: Date): Prisma.TicketWhereInput {
  const and: Prisma.TicketWhereInput[] = [tabWhere(params.tab, actorId, now)];
  if (params.category) and.push({ category: params.category });
  if (params.priority) and.push({ priority: params.priority });
  if (params.queue) and.push({ queue: params.queue });
  if (params.owner) {
    and.push({
      assigneeId: params.owner === "me" ? actorId : params.owner === "unassigned" ? null : params.owner,
    });
  }
  if (params.q) {
    // Prisma passes contains to ILIKE without escaping, so "_" and "%" would
    // act as wildcards. Escape them (and the escape character itself) so the
    // search is a literal substring match, as in buildQueueView.
    const literal = params.q.replace(/[\\%_]/g, (char) => `\\${char}`);
    const contains = { contains: literal, mode: "insensitive" as const };
    and.push({
      OR: [{ reference: contains }, { subject: contains }, { user: { name: contains } }, { user: { email: contains } }],
    });
  }
  return { AND: and };
}

/**
 * compareQueueRows in SQL. TicketPriority is declared LOW, NORMAL, HIGH,
 * URGENT and Postgres orders enum values by declaration, so "desc" gives
 * URGENT first, matching PRIORITY_RANK. References share one uppercase
 * format, so byte order equals localeCompare.
 */
export const QUEUE_ORDER_BY: Prisma.TicketOrderByWithRelationInput[] = [
  { priority: "desc" },
  { updatedAt: "asc" },
  { reference: "asc" },
];

const QUEUE_ROW_SELECT = {
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
} satisfies Prisma.TicketSelect;

/** The ticket delegate surface the queue read needs (a spy can stand in for it). */
export type QueueTicketClient = {
  ticket: Pick<PrismaClient["ticket"], "findMany" | "count" | "groupBy">;
};

export async function loadQueueView(client: QueueTicketClient, params: QueueParams, actorId: string, at: Date): Promise<QueueView> {
  const where = queueWhere(params, actorId, at);
  const findPage = (page: number) =>
    client.ticket.findMany({
      where,
      orderBy: QUEUE_ORDER_BY,
      skip: (page - 1) * QUEUE_PAGE_SIZE,
      take: QUEUE_PAGE_SIZE,
      select: QUEUE_ROW_SELECT,
    });
  const [groups, recentlyResolved, total, firstPage] = await Promise.all([
    // Bounded: at most statuses x priorities x (assignees + 1) groups.
    client.ticket.groupBy({ by: ["status", "priority", "assigneeId"], _count: { _all: true } }),
    client.ticket.count({ where: tabWhere("resolved", actorId, at) }),
    client.ticket.count({ where }),
    // Page 1 never needs clamping, so it can run alongside the counts.
    params.page === 1 ? findPage(1) : Promise.resolve(null),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / QUEUE_PAGE_SIZE));
  const page = Math.min(params.page, pageCount);
  const records = firstPage ?? (await findPage(page));

  let all = 0;
  let open = 0;
  let myWork = 0;
  let unassigned = 0;
  let urgent = 0;
  let escalated = 0;
  for (const group of groups) {
    const n = group._count._all;
    all += n;
    if (group.status === "ESCALATED") escalated += n;
    if (CLOSED_STATUSES.includes(group.status as TicketStatusValue)) continue;
    open += n;
    if (group.assigneeId === null) unassigned += n;
    if (group.assigneeId === actorId) myWork += n;
    if (group.priority === "URGENT") urgent += n;
  }

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

  return {
    params: { ...params, page },
    rows,
    total,
    pageCount,
    tabCounts: { "my-work": myWork, unassigned, open, escalated, resolved: recentlyResolved },
    health: { open, unassigned, urgent, escalated },
    hasAnyTickets: all > 0,
    asOf: at,
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

  // One page plus a few counts per load; never the whole ticket table (NFR-02).
  const getStaffQueue = deps.withPermission<QueueParams>("tickets.view", () => ({}))(async (params, ctx) =>
    loadQueueView(client, params, ctx.actor.userId, now()),
  );

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
