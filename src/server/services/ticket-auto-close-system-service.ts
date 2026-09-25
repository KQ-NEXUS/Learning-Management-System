/**
 * WORKER-ONLY ticket auto-close sweep - DELIBERATELY unauthorized.
 *
 * Same shape and rationale as `hold-release-system-service.ts`: the Netlify
 * scheduled runtime has no request, cookie or session, so the request-scoped
 * permission choke point cannot be used here, and a synthetic global-grant
 * actor would be a larger blast radius than a narrow, named, filter-less
 * surface. Controls:
 *   1. The exported operation is suffixed `AsSystem`.
 *   2. It takes NO caller-supplied filter or actor. The work set is the fixed
 *      predicate `status = RESOLVED AND resolvedAt <= now - 7 days`.
 *   3. Every close is a compare-and-swap on id + version + RESOLVED +
 *      resolvedAt cutoff. The conditional update count is the sole arbiter:
 *      a lost race (learner reopen/close, staff action) is counted as
 *      skipped and writes NO event, audit or outbox row. It is never retried,
 *      so a stale candidate can never close a reopened ticket.
 *   4. Success appends AUTO_CLOSED TicketEvent, a SYSTEM audit row and a
 *      minimal `ticket.closed` outbox event in the same transaction.
 *
 * This module MUST NOT import the permission choke point, the current-actor
 * getter, or anything under `next/`. `tests/boundary.test.ts` enforces it.
 */

import { prisma } from "@/server/db";
import { recordAuditInTransaction } from "@/server/services/audit-service";
import { writeDomainEvent } from "@/server/services/domain-event-service";
import { ticketReopenDeadline } from "@/server/services/ticket-lifecycle";

export const SYSTEM_ACTOR_TYPE = "SYSTEM";
export const DEFAULT_AUTO_CLOSE_BATCH_LIMIT = 50;

const GRACE_MS = ticketReopenDeadline(new Date(0)).getTime();

type CandidateRow = {
  id: string;
  reference: string;
  userId: string;
  status: string;
  version: number;
  resolvedAt: Date | null;
};

type AutoCloseTx = {
  ticket: {
    updateMany(args: {
      where: {
        id: string;
        version: number;
        status: "RESOLVED";
        resolvedAt: { lte: Date };
      };
      data: {
        status: "CLOSED";
        closedAt: Date;
        version: { increment: 1 };
      };
    }): Promise<{ count: number }>;
  };
  ticketEvent: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
  domainEvent: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
  auditEvent: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
};

export type CreateTicketAutoCloseSystemServiceDeps = {
  ticket: {
    findMany(args: {
      where: { status: "RESOLVED"; resolvedAt: { lte: Date } };
      orderBy: { resolvedAt: "asc" };
      take: number;
    }): Promise<CandidateRow[]>;
  };
  runInTransaction: <R>(fn: (tx: AutoCloseTx) => Promise<R>) => Promise<R>;
  now?: () => Date;
};

export type AutoCloseResult = { closed: number; skipped: number; failed: number };

export function createTicketAutoCloseSystemService(
  deps: CreateTicketAutoCloseSystemServiceDeps,
) {
  const now = deps.now ?? (() => new Date());

  async function closeResolvedTickets(
    batchLimit: number = DEFAULT_AUTO_CLOSE_BATCH_LIMIT,
  ): Promise<AutoCloseResult> {
    const closedAt = now();
    const cutoff = new Date(closedAt.getTime() - GRACE_MS);
    const take = Math.max(0, Math.min(Math.floor(batchLimit), DEFAULT_AUTO_CLOSE_BATCH_LIMIT));

    const candidates = await deps.ticket.findMany({
      where: { status: "RESOLVED", resolvedAt: { lte: cutoff } },
      orderBy: { resolvedAt: "asc" },
      take,
    });

    // Defensive re-check so a delegate that ignores the operators still
    // yields exactly the eligible set, oldest first, bounded.
    const work = candidates
      .filter(
        (row) =>
          row.status === "RESOLVED" &&
          row.resolvedAt !== null &&
          row.resolvedAt.getTime() <= cutoff.getTime(),
      )
      .sort((a, b) => a.resolvedAt!.getTime() - b.resolvedAt!.getTime())
      .slice(0, take);

    let closed = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of work) {
      try {
        const won = await deps.runInTransaction(async (tx) => {
          const result = await tx.ticket.updateMany({
            where: {
              id: row.id,
              version: row.version,
              status: "RESOLVED",
              resolvedAt: { lte: cutoff },
            },
            data: {
              status: "CLOSED",
              closedAt,
              version: { increment: 1 },
            },
          });
          if (result.count !== 1) return false;

          await tx.ticketEvent.create({
            data: {
              ticketId: row.id,
              actorId: null,
              actorType: SYSTEM_ACTOR_TYPE,
              type: "AUTO_CLOSED",
              statusBefore: "RESOLVED",
              statusAfter: "CLOSED",
            },
          });
          await writeDomainEvent(tx, {
            type: "ticket.closed",
            payload: {
              ticketId: row.id,
              reference: row.reference,
              requesterId: row.userId,
            },
            occurredAt: closedAt,
          });
          await recordAuditInTransaction(tx as never, {
            actorId: null,
            actorType: SYSTEM_ACTOR_TYPE,
            action: "ticket.auto_closed",
            targetType: "Ticket",
            targetId: row.id,
            outcome: "SUCCESS",
            after: { reference: row.reference, status: "CLOSED" },
          });
          return true;
        });
        if (won) closed += 1;
        else skipped += 1;
      } catch (err) {
        failed += 1;
        console.error(`[ticket-auto-close] failed to close ticket ${row.id}`, err);
      }
    }

    return { closed, skipped, failed };
  }

  return { closeResolvedTickets };
}

const built = createTicketAutoCloseSystemService({
  ticket: prisma.ticket as unknown as CreateTicketAutoCloseSystemServiceDeps["ticket"],
  runInTransaction: (fn) =>
    prisma.$transaction((tx) => fn(tx as unknown as AutoCloseTx)),
});

/**
 * Closes RESOLVED tickets whose seven-day grace period has elapsed. No actor,
 * no session - audits as SYSTEM. Worker/cron only.
 */
export function closeResolvedTicketsAsSystem(
  now?: Date,
  batchLimit?: number,
): Promise<AutoCloseResult> {
  if (!now) return built.closeResolvedTickets(batchLimit);
  return createTicketAutoCloseSystemService({
    ticket: prisma.ticket as unknown as CreateTicketAutoCloseSystemServiceDeps["ticket"],
    runInTransaction: (fn) =>
      prisma.$transaction((tx) => fn(tx as unknown as AutoCloseTx)),
    now: () => now,
  }).closeResolvedTickets(batchLimit);
}
