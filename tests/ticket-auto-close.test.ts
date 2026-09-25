import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({ prisma: { ticket: {}, $transaction: vi.fn() } }));

import {
  createTicketAutoCloseSystemService,
} from "@/server/services/ticket-auto-close-system-service";
import { createCloseResolvedTicketsTask } from "@/server/scheduled/close-resolved-tickets-task";
import { config, createCloseResolvedTicketsHandler } from "../netlify/functions/close-resolved-tickets";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-25T12:00:00.000Z");

type Row = { id: string; reference: string; userId: string; status: string; version: number; resolvedAt: Date | null };

function row(id: string, resolvedAt: Date | null, extra: Partial<Row> = {}): Row {
  return { id, reference: `T-${id}`, userId: "u1", status: "RESOLVED", version: 3, resolvedAt, ...extra };
}

function harness(rows: Row[], opts: { counts?: Record<string, number>; throwOn?: string } = {}) {
  const writes = { ticketEvent: [] as any[], domainEvent: [] as any[], auditEvent: [] as any[], updates: [] as any[] };
  let findArgs: any;
  const service = createTicketAutoCloseSystemService({
    now: () => NOW,
    ticket: {
      findMany: async (args) => {
        findArgs = args;
        return rows;
      },
    },
    runInTransaction: async (fn) =>
      fn({
        ticket: {
          updateMany: async (args: any) => {
            if (opts.throwOn === args.where.id) throw new Error("boom");
            writes.updates.push(args);
            return { count: opts.counts?.[args.where.id] ?? 1 };
          },
        },
        ticketEvent: { create: async (a: any) => void writes.ticketEvent.push(a.data) },
        domainEvent: { create: async (a: any) => void writes.domainEvent.push(a.data) },
        auditEvent: { create: async (a: any) => void writes.auditEvent.push(a.data) },
      } as never),
  });
  return { service, writes, findArgs: () => findArgs };
}

describe("ticket auto-close system service", () => {
  it("closes at the exact deadline but not one millisecond before", async () => {
    const exact = row("a", new Date(NOW.getTime() - 7 * DAY));
    const early = row("b", new Date(NOW.getTime() - 7 * DAY + 1));
    const { service, writes } = harness([exact, early]);
    const result = await service.closeResolvedTickets();
    expect(result).toEqual({ closed: 1, skipped: 0, failed: 0 });
    expect(writes.updates.map((u) => u.where.id)).toEqual(["a"]);
  });

  it("limits the batch to 50 and processes oldest first", async () => {
    const rows = Array.from({ length: 60 }, (_, i) => row(`t${i}`, new Date(NOW.getTime() - 8 * DAY - i * 1000)));
    const { service, writes, findArgs } = harness(rows);
    const result = await service.closeResolvedTickets(500);
    expect(findArgs().take).toBe(50);
    expect(findArgs().orderBy).toEqual({ resolvedAt: "asc" });
    expect(result.closed).toBe(50);
    expect(writes.updates[0].where.id).toBe("t59");
  });

  it("uses id + version + RESOLVED + cutoff as the CAS predicate", async () => {
    const { service, writes } = harness([row("a", new Date(NOW.getTime() - 8 * DAY))]);
    await service.closeResolvedTickets();
    expect(writes.updates[0].where).toEqual({
      id: "a",
      version: 3,
      status: "RESOLVED",
      resolvedAt: { lte: new Date(NOW.getTime() - 7 * DAY) },
    });
    expect(writes.updates[0].data.version).toEqual({ increment: 1 });
  });

  it("counts a lost CAS as skipped and writes no event, audit or outbox row", async () => {
    const { service, writes } = harness([row("a", new Date(NOW.getTime() - 8 * DAY))], { counts: { a: 0 } });
    const result = await service.closeResolvedTickets();
    expect(result).toEqual({ closed: 0, skipped: 1, failed: 0 });
    expect(writes.ticketEvent).toHaveLength(0);
    expect(writes.auditEvent).toHaveLength(0);
    expect(writes.domainEvent).toHaveLength(0);
  });

  it("records SYSTEM attribution and a minimal outbox payload on success", async () => {
    const { service, writes } = harness([row("a", new Date(NOW.getTime() - 8 * DAY))]);
    await service.closeResolvedTickets();
    expect(writes.ticketEvent[0]).toMatchObject({ actorId: null, actorType: "SYSTEM", type: "AUTO_CLOSED", statusBefore: "RESOLVED", statusAfter: "CLOSED" });
    expect(writes.auditEvent[0]).toMatchObject({ actorId: null, actorType: "SYSTEM", targetId: "a" });
    expect(writes.domainEvent[0].type).toBe("ticket.closed");
    expect(Object.keys(writes.domainEvent[0].payload as object).sort()).toEqual(["reference", "requesterId", "ticketId"]);
  });

  it("isolates a failing candidate and keeps processing", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { service } = harness(
      [row("a", new Date(NOW.getTime() - 9 * DAY)), row("b", new Date(NOW.getTime() - 8 * DAY))],
      { throwOn: "a" },
    );
    const result = await service.closeResolvedTickets();
    expect(result).toEqual({ closed: 1, skipped: 0, failed: 1 });
    spy.mockRestore();
  });
});

describe("scheduled task and netlify function", () => {
  it("logs closed, skipped and failed counts and passes batch 50", async () => {
    const close = vi.fn().mockResolvedValue({ closed: 2, skipped: 1, failed: 3 });
    const log = vi.fn();
    await createCloseResolvedTicketsTask({ close, now: () => NOW, log })();
    expect(close).toHaveBeenCalledWith(NOW, 50);
    expect(log.mock.calls[0][0]).toMatch(/2 resolved.*1 skipped.*3 failed/);
  });

  it("exports an hourly cron and invokes exactly one task", async () => {
    expect(config.schedule).toBe("15 * * * *");
    const run = vi.fn().mockResolvedValue(undefined);
    await createCloseResolvedTicketsHandler(run)();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
