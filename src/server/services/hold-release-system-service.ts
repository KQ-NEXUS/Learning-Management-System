/**
 * WORKER-ONLY hold-release sweep — DELIBERATELY unauthorized.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READ THIS BEFORE "FIXING" THE MISSING AUTHORIZATION CHECK.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The request-scoped permission choke point (`src/server/permissions/*`) binds
 * an actor-getter that reads the session cookie off the incoming request. The
 * hold-release worker (plan 05-09) is a standalone `tsx` process — no
 * request, no cookie jar, no Next.js runtime. Wrapping `releaseExpiredHolds`
 * in that choke point makes it throw on the very first scheduled run, and an
 * abandoned checkout's `PENDING_PAYMENT` hold would then never expire: the
 * seat it occupies (D-01) is held forever, the cohort falsely reads full, and
 * nothing recovers it.
 *
 * Decision: a separate, explicitly unauthorized, worker-only module — the
 * same shape as `scan-system-service.ts` (plan 04-10). The alternative — a
 * synthetic system actor holding a GLOBAL grant — means minting an identity
 * that can perform ANY permission-gated write, in a process nobody watches
 * interactively. A narrow, named, filter-less surface is the smaller blast
 * radius.
 *
 * The controls that make it safe are structural:
 *   1. The exported operation is suffixed `AsSystem` — the label is the
 *      warning.
 *   2. It takes NO caller-supplied filter — no cohort id, no enrolment id, no
 *      status. It resolves its own work set from `status = 'PENDING_PAYMENT'`
 *      AND `holdExpiresAt` in the past, and defensively re-filters what it
 *      reads back, exactly like `scan-system-service.ts`'s
 *      `findStuckPending`. It cannot read or write anything else.
 *   3. It still audits — `actorId: null, actorType: "SYSTEM"` — under a
 *      distinct action name (`enrolment.hold_expired`), so a system release
 *      is never indistinguishable from a staff cancellation in the trail.
 *   4. `tests/boundary.test.ts` asserts nothing under `src/app/**` reaches
 *      this module and that the worker runtime import closure stays free of
 *      request-only APIs.
 *
 * Idempotency is by convergence (D-03), not a dedupe key: a row already
 * flipped out of PENDING_PAYMENT by a previous sweep run, or by the learner
 * completing checkout in the meantime, simply is not in the next work set.
 * Do NOT add a job-level dedupe key here — a convergent, re-read work set
 * already makes a re-run a no-op, and a dedupe key would only add a place for
 * staleness to hide.
 *
 * This module MUST NOT import the permission choke point, the request
 * actor-getter, `cohort-scope.ts`, or anything under `next/`. It imports only
 * the database client, `seat-accounting.ts`, `domain-event-service.ts` and
 * `audit-service.ts` — exactly the transitive closure `tests/boundary.test.ts`
 * checks.
 */

import { prisma } from "@/server/db";
import { recordAudit } from "@/server/services/audit-service";
import {
  releaseSeat,
  StaleEnrolmentError,
  type SeatTxClient,
} from "@/server/services/seat-accounting";
import {
  writeDomainEvent,
  type DomainEventTxClient,
} from "@/server/services/domain-event-service";

export const SYSTEM_ACTOR_TYPE = "SYSTEM";

/** A default batch bound so a large backlog drains across scheduled runs
 * rather than being processed in one long-running transaction. */
const DEFAULT_BATCH_LIMIT = 200;

type ExpiredHoldRow = {
  id: string;
  cohortId: string;
  userId: string;
  status: string;
  holdExpiresAt: Date | null;
};

/** The transaction client one release needs — structural, so this file
 * carries no `@prisma/client` type import. */
type ReleaseTxClient = SeatTxClient & DomainEventTxClient;

type EnrolmentDelegate = {
  findMany(args: {
    where: {
      status: "PENDING_PAYMENT";
      holdExpiresAt: { not: null; lt: Date };
    };
    orderBy: { holdExpiresAt: "asc" };
    take: number;
  }): Promise<ExpiredHoldRow[]>;
};

export type CreateHoldReleaseSystemServiceDeps = {
  enrolment: EnrolmentDelegate;
  audit: (event: {
    actorId: string | null;
    actorType?: string;
    action: string;
    targetType: string;
    targetId: string;
    outcome: string;
    reason?: string | null;
    before?: unknown;
    after?: unknown;
  }) => Promise<void>;
  writeEvent: typeof writeDomainEvent;
  runInTransaction: <R>(fn: (tx: ReleaseTxClient) => Promise<R>) => Promise<R>;
  now?: () => Date;
};

export function createHoldReleaseSystemService(
  deps: CreateHoldReleaseSystemServiceDeps,
) {
  const now = deps.now ?? (() => new Date());

  /**
   * Finds and releases every `PENDING_PAYMENT` enrolment whose seat hold has
   * expired, up to `batchLimit` rows (oldest expiry first). Takes NO
   * caller-supplied filter — a worker cannot be steered at an arbitrary
   * enrolment.
   *
   * Each row is processed in its OWN transaction so one failure does not
   * abort the batch. A per-row failure is caught, logged and counted rather
   * than thrown, so a single poison row cannot stall the sweep.
   */
  async function releaseExpiredHolds(
    batchLimit: number = DEFAULT_BATCH_LIMIT,
  ): Promise<{ released: number; failed: number }> {
    const cutoff = now();
    const candidates = await deps.enrolment.findMany({
      where: {
        status: "PENDING_PAYMENT",
        holdExpiresAt: { not: null, lt: cutoff },
      },
      orderBy: { holdExpiresAt: "asc" },
      take: batchLimit,
    });

    // Defensive re-filter so a delegate that ignores the `lt`/`not null`
    // operators (a simple test fake) still yields exactly the correct set —
    // never an enrolment whose hold has not expired, nor one already outside
    // PENDING_PAYMENT (T-05-57).
    const work = candidates.filter(
      (row) =>
        row.status === "PENDING_PAYMENT" &&
        row.holdExpiresAt !== null &&
        row.holdExpiresAt < cutoff,
    );

    let released = 0;
    let failed = 0;

    for (const row of work) {
      try {
        await deps.runInTransaction(async (tx) => {
          await releaseSeat(tx, {
            cohortId: row.cohortId,
            enrolmentId: row.id,
            toStatus: "CANCELLED",
            reason: "hold expired",
            heldSeat: true,
            expected: { status: "PENDING_PAYMENT", holdExpiresAt: row.holdExpiresAt },
          });
          await deps.writeEvent(tx, {
            type: "enrolment.hold_expired",
            payload: {
              enrolmentId: row.id,
              cohortId: row.cohortId,
              userId: row.userId,
            },
          });
        });

        await deps.audit({
          actorId: null,
          actorType: SYSTEM_ACTOR_TYPE,
          action: "enrolment.hold_expired",
          targetType: "Enrolment",
          targetId: row.id,
          outcome: "SUCCESS",
          reason: "hold expired",
          before: { status: row.status, holdExpiresAt: row.holdExpiresAt },
          after: { status: "CANCELLED", holdExpiresAt: null },
        });

        released += 1;
      } catch (err) {
        // Approval, extension or another sweep won. No release/event was committed.
        if (err instanceof StaleEnrolmentError) continue;
        failed += 1;
        console.error(
          `[hold-release] failed to release enrolment ${row.id}`,
          err,
        );
      }
    }

    return { released, failed };
  }

  return { releaseExpiredHolds };
}

const built = createHoldReleaseSystemService({
  enrolment: prisma.enrolment as unknown as EnrolmentDelegate,
  audit: (event) => recordAudit(event),
  writeEvent: writeDomainEvent,
  runInTransaction: (fn) =>
    prisma.$transaction((tx) => fn(tx as unknown as ReleaseTxClient)),
});

/**
 * Sweeps expired `PENDING_PAYMENT` holds and releases their seats. No actor,
 * no session — audits as `actorType: "SYSTEM"`. Worker/cron only.
 */
export function releaseExpiredHoldsAsSystem(
  batchLimit?: number,
): Promise<{ released: number; failed: number }> {
  return built.releaseExpiredHolds(batchLimit);
}
