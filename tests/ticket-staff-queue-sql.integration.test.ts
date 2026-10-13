/**
 * Differential proof for the SQL-backed staff support queue (plan 15-09,
 * NFR-02, folded todo 2026-09-25, threat T-15-09-02).
 *
 * getStaffQueue now pushes the tab, category, priority, queue, owner and text
 * filters, the ordering and the 20-row page into Prisma where / orderBy /
 * skip / take, and computes the tab counts and the health strip with groupBy
 * and count. The pure buildQueueView is kept as the oracle: for every tab,
 * single filter, combined filter, search and page over a seeded set of 90
 * tickets, the SQL QueueView must deep-equal buildQueueView over all rows.
 * Many tickets share an updatedAt, so the reference tie-breaker is exercised.
 *
 * A spy-client case proves the service never calls ticket.findMany without
 * take (the unbounded read this plan removes).
 *
 * PREREQUISITE: Docker must be running. If it is not, `beforeAll` fails with
 * a container-start error and every case reports BLOCKED — the expected
 * failure mode, never a silent pass or a weakened mock.
 */

import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createWithPermission } from "@/server/permissions/with-permission";
import {
  buildQueueView,
  createTicketStaffQueueService,
  loadQueueView,
  parseQueueParams,
  QUEUE_PAGE_SIZE,
  type QueueRow,
  type QueueTicketClient,
} from "@/server/services/ticket-staff-queue-service";
import type { TicketCategoryValue, TicketQueueValue } from "@/server/services/ticket-service";
import type { TicketPriorityValue, TicketStatusValue } from "@/server/services/ticket-lifecycle";
import { QUEUE_TABS } from "@/lib/support-queue";
import { createTestWithPermission, grant } from "./support/harness";
import { startTestDatabase, TEST_DB_TIMEOUT_MS, type TestDatabase } from "./support/pg";

const NOW = new Date("2026-10-07T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1_000;
const STATUSES: TicketStatusValue[] = ["NEW", "OPEN", "ASSIGNED", "ESCALATED", "RESOLVED", "CLOSED"];
const PRIORITIES: TicketPriorityValue[] = ["LOW", "NORMAL", "HIGH", "URGENT"];
const CATEGORIES: TicketCategoryValue[] = [
  "ACCOUNT_ACCESS",
  "PAYMENT_ORDER",
  "COURSE_CONTENT",
  "ASSESSMENT_RESULT",
  "CERTIFICATE",
  "TECHNICAL_PROBLEM",
  "OTHER",
];
const QUEUES: TicketQueueValue[] = ["GENERAL_SUPPORT", "ACCOUNTS", "FINANCE", "LEARNING_ASSESSMENT", "TECHNICAL"];
const SUBJECTS = [
  "Refund for order",
  "Cannot login",
  "Certificate missing",
  "Quiz score wrong",
  "file_upload broken",
  "100% stuck on video",
  "Payment declined",
  "Lesson will not load",
];
const LEARNERS = [
  ["Ada Lovelace", "ada.lovelace@example.test"],
  ["Grace Hopper", "Grace.Hopper@Example.test"],
  ["Alan Turing", "alan.turing@example.test"],
  ["Katherine Johnson", "kjohnson@example.test"],
  ["Chinua Achebe", "chinua@example.test"],
  ["Ngozi Okonjo", "NGOZI.OKONJO@example.test"],
] as const;
const REF_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

let database: TestDatabase;
let actorId: string;
let kimId: string;
const references: string[] = [];

/** Deterministic PRNG (mulberry32) so a failure reproduces. */
function prng(seed: number) {
  let state = seed >>> 0;
  return (n: number) => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4_294_967_296 * n) | 0;
  };
}

async function makeUser(name: string, email: string, isStaff: boolean) {
  return database.prisma.user.create({ data: { email, name, passwordHash: "hash", isStaff, status: "ACTIVE" } });
}

async function loadAllRows(): Promise<QueueRow[]> {
  const records = await database.prisma.ticket.findMany({
    include: { user: { select: { name: true, email: true } }, assignee: { select: { name: true } } },
  });
  return records.map((record) => ({
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
}

beforeAll(async () => {
  database = await startTestDatabase();
  const rand = prng(1509);
  const learners = [];
  for (const [name, email] of LEARNERS) learners.push(await makeUser(name, email, false));
  const sam = await makeUser("Sam Agent", "sam@staff.test", true);
  const kim = await makeUser("Kim Manager", "kim@staff.test", true);
  const val = await makeUser("Val Viewer", "val@staff.test", true);
  actorId = sam.id;
  kimId = kim.id;
  const owners = [sam.id, kim.id, val.id, null, null];
  const resolvedAts = [
    new Date(NOW.getTime() - DAY),
    new Date(NOW.getTime() - 7 * DAY), // exactly at the reopen-grace edge: still "recently resolved"
    new Date(NOW.getTime() - 7 * DAY - 1), // one millisecond past it
    new Date(NOW.getTime() - 10 * DAY),
    null,
  ];

  for (let i = 0; i < 90; i += 1) {
    const status = STATUSES[rand(STATUSES.length)];
    const suffix = Array.from({ length: 8 }, () => REF_CHARS[rand(REF_CHARS.length)]).join("");
    const reference = `KQT-2026100${1 + rand(3)}-${suffix}`;
    references.push(reference);
    await database.prisma.ticket.create({
      data: {
        reference,
        userId: learners[rand(learners.length)].id,
        subject: SUBJECTS[rand(SUBJECTS.length)],
        category: CATEGORIES[rand(CATEGORIES.length)],
        priority: PRIORITIES[rand(PRIORITIES.length)],
        status,
        queue: QUEUES[rand(QUEUES.length)],
        assigneeId: owners[rand(owners.length)],
        // Only six distinct timestamps, so priority and updatedAt ties are common.
        updatedAt: new Date(NOW.getTime() - 3 * DAY + rand(6) * 60 * 60 * 1_000),
        resolvedAt:
          status === "RESOLVED" ? resolvedAts[rand(resolvedAts.length)]
          : status === "CLOSED" ? new Date(NOW.getTime() - 20 * DAY)
          : null,
      },
    });
  }
}, TEST_DB_TIMEOUT_MS);

afterAll(async () => {
  await database?.stop();
}, TEST_DB_TIMEOUT_MS);

function buildQueue() {
  const withPermission = createWithPermission({
    getActor: async () => ({ userId: actorId, isStaff: true }),
    loadGrants: async () => [grant("tickets.view")],
    audit: async () => undefined,
  });
  return createTicketStaffQueueService({
    client: database.prisma,
    withPermission,
    getStaffTicketByReference: async () => {
      throw new Error("not used");
    },
    now: () => NOW,
  });
}

describe("SQL-backed staff queue equals the buildQueueView oracle", () => {
  it("matches for every tab, filter, combined filter, search and page", async () => {
    const queue = buildQueue();
    const rows = await loadAllRows();
    expect(rows.length).toBeGreaterThanOrEqual(60);

    const filterSets: Array<Record<string, string>> = [
      {},
      { category: "PAYMENT_ORDER" },
      { category: "TECHNICAL_PROBLEM" },
      { category: "OTHER" },
      ...PRIORITIES.map((priority) => ({ priority })),
      { priority: "urgent" }, // parseQueueParams upper-cases
      { queue: "FINANCE" },
      { queue: "GENERAL_SUPPORT" },
      { queue: "TECHNICAL" },
      { owner: "me" },
      { owner: "unassigned" },
      { owner: kimId },
      { owner: "nobody-with-this-id" },
      { priority: "URGENT", queue: "FINANCE" },
      { category: "PAYMENT_ORDER", owner: "me" },
      { owner: "unassigned", priority: "HIGH" },
      // Text search: reference, subject, requester name and email, case-insensitive.
      { q: references[5].slice(-5).toLowerCase() },
      { q: "kqt-20261002" },
      { q: "REFUND" },
      { q: "login" },
      { q: "hopper" },
      { q: "OKONJO@" },
      { q: "example.TEST" },
      { q: "_" },
      { q: "%" },
      { q: "zzz-no-match" },
      { q: "example", priority: "HIGH" },
    ];

    let comparisons = 0;
    let deepPages = 0;
    for (const tab of QUEUE_TABS) {
      for (const filters of filterSets) {
        for (const page of ["1", "2", "3"]) {
          const params = parseQueueParams({ tab, page, ...filters });
          const sql = await queue.getStaffQueue(params);
          const oracle = buildQueueView(rows, params, actorId, NOW);
          expect(sql, JSON.stringify({ tab, page, ...filters })).toEqual(oracle);
          comparisons += 1;
          if (page === "3" && sql.rows.length > 0) deepPages += 1;
        }
      }
    }
    expect(comparisons).toBe(QUEUE_TABS.length * filterSets.length * 3);
    // The seed is large enough that page 3 really holds rows for some views.
    expect(deepPages).toBeGreaterThan(0);
  }, 180_000); // about 500 comparisons, four queries each

  it("clamps a page beyond the last exactly like the oracle", async () => {
    const queue = buildQueue();
    const rows = await loadAllRows();
    for (const tab of QUEUE_TABS) {
      const params = parseQueueParams({ tab, page: "99" });
      expect(await queue.getStaffQueue(params)).toEqual(buildQueueView(rows, params, actorId, NOW));
    }
  });

  it("orders exactly like compareQueueRows, including updatedAt and reference tie-breaks", async () => {
    const queue = buildQueue();
    const rows = await loadAllRows();
    const params = parseQueueParams({ tab: "open" });
    const oracle = buildQueueView(rows, params, actorId, NOW);
    const ties = oracle.rows.filter(
      (row, index) =>
        index > 0 &&
        row.priority === oracle.rows[index - 1].priority &&
        row.updatedAt.getTime() === oracle.rows[index - 1].updatedAt.getTime(),
    );
    expect(ties.length).toBeGreaterThan(0);
    const sql = await queue.getStaffQueue(params);
    expect(sql.rows.map((row) => row.reference)).toEqual(oracle.rows.map((row) => row.reference));
  });

  it("never calls ticket.findMany without take (spy client)", async () => {
    const findMany = vi.fn(async () => []);
    const spy = {
      ticket: {
        findMany,
        count: vi.fn(async () => 75),
        groupBy: vi.fn(async () => []),
      },
    } as unknown as QueueTicketClient;
    for (const page of ["1", "2", "4", "9999"]) {
      await loadQueueView(spy, parseQueueParams({ tab: "open", page, q: "x" }), "staff-1", NOW);
    }
    const { withPermission } = createTestWithPermission([grant("tickets.view")], { userId: "staff-1" });
    const service = createTicketStaffQueueService({
      client: spy as unknown as PrismaClient,
      withPermission,
      getStaffTicketByReference: async () => {
        throw new Error("not used");
      },
      now: () => NOW,
    });
    await service.getStaffQueue(parseQueueParams({}));

    expect(findMany.mock.calls.length).toBeGreaterThanOrEqual(5);
    for (const [args] of findMany.mock.calls as unknown as Array<[{ take?: number; skip?: number; orderBy?: unknown }]>) {
      expect(args.take).toBe(QUEUE_PAGE_SIZE);
      expect(args.orderBy).toBeDefined();
      expect(args.skip).toBeLessThanOrEqual(3 * QUEUE_PAGE_SIZE);
    }
  });
});
