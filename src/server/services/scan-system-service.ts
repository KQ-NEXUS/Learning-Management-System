/**
 * WORKER-ONLY scan operations — DELIBERATELY unauthorized.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READ THIS BEFORE "FIXING" THE MISSING AUTHORIZATION CHECK.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The request-scoped permission choke point (`src/server/permissions/*`) binds
 * an actor-getter that reads the session cookie off the incoming request. The
 * scan worker (plan 04-10) is a standalone `tsx` process — no request, no
 * cookie jar, no Next.js runtime. Wrapping `markScanResult` in that choke point
 * makes it throw on the very first job. Every upload then sits at PENDING
 * forever, and a reconciliation cron wrapped the same way could not rescue them
 * either.
 *
 * Decision: a separate, explicitly unauthorized, worker-only module. The
 * alternative — a synthetic system actor holding a GLOBAL grant — means minting
 * an identity that can do anything, in a process whose whole job is handling
 * attacker-supplied bytes. A narrow, named, three-function surface is the smaller
 * blast radius.
 *
 * The controls that make it safe are structural:
 *   1. This file's three exported operations are suffixed `AsSystem` — the label
 *      is the warning.
 *   2. None takes a caller-supplied filter. The worker can resolve one resource
 *      id to its storage key, mark that id's result, or find PENDING rows older
 *      than a minute count. It cannot read or write anything else.
 *   3. They still audit — `actorId: null, actorType: "SYSTEM"`.
 *   4. A test asserts nothing under `src/app/**` imports this module.
 *
 * This module MUST NOT import the permission choke point, the request
 * actor-getter, or anything under `next/`. It has no reason to today. Plan
 * 04-10 adds the mirror-image test that no worker file reaches request-only
 * APIs, following the transitive import closure — `storage-service.ts` and
 * `queue.ts` sit on that path and carry the same constraint in their headers.
 */

import { prisma } from "@/server/db";
import { recordAudit } from "@/server/services/audit-service";
import type {
  LessonResourceRecord,
  ScanStatusValue,
} from "./lesson-resource-service";

export const SYSTEM_ACTOR_TYPE = "SYSTEM";

type ScanDelegate = {
  findUnique(args: { where: { id: string } }): Promise<LessonResourceRecord | null>;
  update(args: {
    where: { id: string };
    data: Record<string, unknown>;
  }): Promise<LessonResourceRecord>;
  findMany(args: { where?: unknown }): Promise<LessonResourceRecord[]>;
};

type ScanAuditEvent = {
  actorId: string | null;
  actorType?: string;
  action: string;
  targetType: string;
  targetId: string;
  outcome: string;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
};

export type CreateScanSystemServiceDeps = {
  delegate: ScanDelegate;
  audit: (event: ScanAuditEvent) => Promise<void>;
  now?: () => Date;
};

export function createScanSystemService(deps: CreateScanSystemServiceDeps) {
  const now = deps.now ?? (() => new Date());

  /**
   * Records a scan verdict. Writes `scanStatus`, `scannedAt` and `scanDetail`
   * and NEVER deletes the row — an INFECTED file is marked, not destroyed, so
   * staff keep seeing it (no hard deletes; D-28).
   */
  async function markScanResult(input: {
    id: string;
    status: ScanStatusValue;
    detail?: string | null;
  }): Promise<LessonResourceRecord> {
    const before = await deps.delegate.findUnique({ where: { id: input.id } });
    const after = await deps.delegate.update({
      where: { id: input.id },
      data: {
        scanStatus: input.status,
        scannedAt: now(),
        scanDetail: input.detail ?? null,
      },
    });

    await deps.audit({
      actorId: null,
      actorType: SYSTEM_ACTOR_TYPE,
      action: "lessonresource.scanned",
      targetType: "LessonResource",
      targetId: input.id,
      outcome: "SUCCESS",
      reason: input.status === "CLEAN" ? null : input.detail ?? input.status,
      before,
      after,
    });

    return after;
  }

  /**
   * The reconciliation query: PENDING rows created longer than
   * `olderThanMinutes` ago, whose scan job may have been lost between the row
   * commit and the enqueue (see `queue.ts`). Plan 04-10's cron re-enqueues
   * these.
   */
  async function findStuckPending(
    olderThanMinutes: number,
  ): Promise<LessonResourceRecord[]> {
    const cutoff = new Date(now().getTime() - olderThanMinutes * 60_000);
    const rows = await deps.delegate.findMany({
      where: { scanStatus: "PENDING", createdAt: { lt: cutoff } },
    });
    // Defensive re-filter so a delegate that ignores the `createdAt` operator
    // (a simple test fake) still returns the correct set.
    return rows.filter((r) => r.scanStatus === "PENDING" && r.createdAt < cutoff);
  }

  /** Resolve only the storage key needed by a scan job. */
  async function findScanTarget(
    id: string,
  ): Promise<{ storageKey: string } | null> {
    const row = await deps.delegate.findUnique({ where: { id } });
    return row ? { storageKey: row.storageKey } : null;
  }

  return { markScanResult, findStuckPending, findScanTarget };
}

const built = createScanSystemService({
  delegate: prisma.lessonResource as unknown as ScanDelegate,
  audit: (event) => recordAudit(event),
});

/**
 * Record a scan verdict from the worker. No actor, no session — audits as
 * `actorType: "SYSTEM"`.
 */
export function markScanResultAsSystem(input: {
  id: string;
  status: ScanStatusValue;
  detail?: string | null;
}): Promise<LessonResourceRecord> {
  return built.markScanResult(input);
}

/** Find PENDING resources whose scan job may have been lost. Worker/cron only. */
export function findStuckPendingAsSystem(
  olderThanMinutes: number,
): Promise<LessonResourceRecord[]> {
  return built.findStuckPending(olderThanMinutes);
}

/** Resolve the single storage key needed by a scan job. Worker only. */
export function findScanTargetAsSystem(
  id: string,
): Promise<{ storageKey: string } | null> {
  return built.findScanTarget(id);
}
