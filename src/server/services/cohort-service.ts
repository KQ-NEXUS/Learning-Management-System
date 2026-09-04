/**
 * Cohort operations (COH-01, COH-02, COH-04).
 *
 * Authorization, scoping and audit come from `createResourceService` — a
 * service that re-implements any of them is doing it wrong
 * (`course-service.ts:5-7`). What lives here on top of the factory is the two
 * things the factory has no concept of:
 *
 *   1. The D-30 offer-lock guard. Once any Enrolment row exists for a cohort —
 *      in ANY status, WITHDRAWN and CANCELLED included — its offer target
 *      (exactly one Course XOR one Programme) is frozen: changing it would
 *      silently rewrite what enrolled learners owe. `assertOfferMutable`
 *      counts enrolments with no status filter and `updateCohort` calls it
 *      before any write that changes `courseId`/`programmeId`. The guard is
 *      kept out of the factory deliberately so plan 05-12's action can map
 *      `OfferLockedError` to its specific UI-SPEC copy.
 *
 *   2. `publishCohort` (added in Task 2). Publish carries a readiness refusal,
 *      a catalogue pin and a stale-token check — see `publish-service.ts:1-4`
 *      ("the operation the factory does not have").
 *
 * `archiveData` returns `{ status: "CANCELLED" }`, which is what makes archive
 * a soft-cancel (D-31 — a Cohort is never hard-deleted). `runInTransaction`
 * is wired so plan 05-11's bulk-withdraw-on-cancel can be atomic with the
 * status write.
 */

import { prisma } from "@/server/db";
import { withPermission as liveWithPermission } from "@/server/permissions";
import type { ResourceScope } from "@/server/permissions/scope";
import type { createWithPermission } from "@/server/permissions/with-permission";
import { recordAudit } from "@/server/services/audit-service";
import {
  createResourceService,
  type Delegate,
  type ResourceAuditEntry,
} from "./resource-service";
import { cohortResourceScope } from "./cohort-scope";
import {
  blockingFailures,
  evaluateCohortReadiness,
  type ReadinessCohortInput,
  type ReadinessItem,
} from "./readiness-service";
import { StaleOrderError } from "./reorder-service";
import { writeDomainEvent } from "./domain-event-service";
import { CohortNotFoundError } from "./seat-accounting";

type WithPermission = ReturnType<typeof createWithPermission>;

/** The `CohortStatus` member a published cohort carries (`schema.prisma:53`). */
const PUBLISHED_STATUS = "PUBLISHED";

/** The Cohort columns the factory and the offer-lock wrapper touch. */
export type CohortRecord = {
  id: string;
  code: string;
  title: string;
  courseId: string | null;
  programmeId: string | null;
  deliveryMode: string;
  timezone: string;
  startsAt: Date;
  endsAt: Date;
  enrolmentOpensAt: Date;
  enrolmentClosesAt: Date;
  capacity: number;
  seatsTaken: number;
  priceMinor: number;
  currency: string;
  status: string;
  publishedAt: Date | null;
  attendanceThresholdPct: number | null;
  coursePublicationId: string | null;
  programmePublicationId: string | null;
  holdMinutes: number | null;
  updatedAt: Date;
};

// ---------------------------------------------------------------------------
// D-30 — the offer-lock guard
// ---------------------------------------------------------------------------

/**
 * Thrown when a cohort's offer target (Course/Programme) is changed after any
 * Enrolment row exists. Carries the cohort id and the enrolment count; its
 * message is the UI-SPEC copy plan 05-12's action renders verbatim.
 */
export class OfferLockedError extends Error {
  readonly cohortId: string;
  readonly enrolmentCount: number;

  constructor(cohortId: string, enrolmentCount: number) {
    super(
      "The course/programme this cohort delivers is locked because it has enrolments. " +
        "Changing it needs an approved migration.",
    );
    this.name = "OfferLockedError";
    this.cohortId = cohortId;
    this.enrolmentCount = enrolmentCount;
  }
}

/** The narrow `Enrolment` delegate slice the guard uses — injected so it is
 *  unit-testable without a real Postgres. */
export type CohortGuardEnrolmentDelegate = {
  count(args: { where: { cohortId: string } }): Promise<number>;
};

/**
 * D-30: the offer target is frozen the moment ANY enrolment exists. The count
 * has NO status filter on purpose — a WITHDRAWN, CANCELLED or TRANSFERRED row
 * still means a learner was once enrolled against this offer.
 */
export function createCohortGuards(deps: { enrolment: CohortGuardEnrolmentDelegate }) {
  async function assertOfferMutable(cohortId: string): Promise<void> {
    const enrolmentCount = await deps.enrolment.count({ where: { cohortId } });
    if (enrolmentCount > 0) {
      throw new OfferLockedError(cohortId, enrolmentCount);
    }
  }

  return { assertOfferMutable };
}

// ---------------------------------------------------------------------------
// Publish (COH-04 / D-27 / D-28 / D-29) — the operation the factory has no
// concept of: a named-failure readiness refusal, a catalogue pin, and a
// stale-token check.
// ---------------------------------------------------------------------------

/**
 * A publish was refused because one or more blocking readiness items still
 * FAIL. Carries the failing items so the caller can list them (plan 05-15).
 */
export class CohortReadinessRefusedError extends Error {
  readonly failures: ReadinessItem[];

  constructor(failures: ReadinessItem[]) {
    super(
      `This cohort has ${failures.length} check${failures.length === 1 ? "" : "s"} ` +
        `that must pass before it can be published: ${failures
          .map((item) => item.label)
          .join(", ")}.`,
    );
    this.name = "CohortReadinessRefusedError";
    this.failures = failures;
  }
}

/**
 * The Course or Programme this cohort delivers has no publication row to pin
 * to (D-29 — only a frozen publication can back a cohort).
 */
export class NoPublishedOfferError extends Error {
  readonly cohortId: string;
  readonly offerKind: "course" | "programme";

  constructor(cohortId: string, offerKind: "course" | "programme") {
    super(
      `This cohort's ${offerKind} has no published version to pin to. ` +
        `Publish the ${offerKind} first, then publish the cohort.`,
    );
    this.name = "NoPublishedOfferError";
    this.cohortId = cohortId;
    this.offerKind = offerKind;
  }
}

/** One frozen publication row — the id is the pin, the payload carries the
 *  completion rule the readiness evaluator reads. */
type CohortPublicationRow = { id: string; payload: unknown };

/**
 * The readiness-relevant slice of a cohort plus its offer target's latest
 * publication. `loadCohortReadinessAggregate` reads this and hands plain
 * values to the pure evaluator so no readiness rule leaves
 * `readiness-service.ts`.
 */
export type CohortAggregateRow = {
  status: string;
  deliveryMode: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  seatsTaken: number;
  priceMinor: number;
  currency: string | null;
  attendanceThresholdPct: number | null;
  courseId: string | null;
  programmeId: string | null;
  scheduledSessions: Array<{
    startsAt: Date;
    endsAt: Date;
    cancelledAt: Date | null;
  }>;
  _count: { instructors: number };
  course: { status: string; publications: CohortPublicationRow[] } | null;
  programme: { status: string; publications: CohortPublicationRow[] } | null;
};

/** Injected so the transform is unit-testable without a real Postgres. */
export type CohortAggregateDelegate = {
  findUnique(args: {
    where: { id: string };
    select: Record<string, unknown>;
  }): Promise<CohortAggregateRow | null>;
};

/** The Prisma select the production binding passes to `cohort.findUnique`. */
const AGGREGATE_SELECT = {
  status: true,
  deliveryMode: true,
  startsAt: true,
  endsAt: true,
  capacity: true,
  seatsTaken: true,
  priceMinor: true,
  currency: true,
  attendanceThresholdPct: true,
  courseId: true,
  programmeId: true,
  scheduledSessions: {
    select: { startsAt: true, endsAt: true, cancelledAt: true },
  },
  _count: { select: { instructors: true } },
  course: {
    select: {
      status: true,
      publications: {
        orderBy: { version: "desc" },
        take: 1,
        select: { id: true, payload: true },
      },
    },
  },
  programme: {
    select: {
      status: true,
      publications: {
        orderBy: { version: "desc" },
        take: 1,
        select: { id: true, payload: true },
      },
    },
  },
} as const;

/** Reads `completionRule` off the frozen publication payload — never off the
 *  live Course/Programme, which is exactly what the pin protects against. */
function extractCompletionRule(payload: unknown): unknown {
  if (payload != null && typeof payload === "object" && "completionRule" in payload) {
    return (payload as { completionRule: unknown }).completionRule ?? null;
  }
  return null;
}

function toReadinessInput(row: CohortAggregateRow): ReadinessCohortInput {
  const kind: "course" | "programme" = row.courseId ? "course" : "programme";
  const target = kind === "course" ? row.course : row.programme;
  const latestPublication = target?.publications?.[0] ?? null;
  const sessions = row.scheduledSessions.map((session) => ({
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    cancelledAt: session.cancelledAt,
  }));

  return {
    deliveryMode: row.deliveryMode,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    capacity: row.capacity,
    seatsTaken: row.seatsTaken,
    priceMinor: row.priceMinor,
    currency: row.currency,
    attendanceThresholdPct: row.attendanceThresholdPct,
    instructorCount: row._count.instructors,
    nonCancelledSessionCount: sessions.filter((session) => session.cancelledAt == null)
      .length,
    sessions,
    pin: {
      kind,
      publicationId: latestPublication?.id ?? null,
      targetStatus: target?.status ?? null,
      completionRule: extractCompletionRule(latestPublication?.payload),
    },
  };
}

/** The transaction client `publishCohort` needs — structurally satisfied by a
 *  Prisma `tx` and by a unit-test fake, so no `@prisma/client` import. */
export type CohortPublishTx = {
  cohort: {
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  domainEvent: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
};

export type CohortPublishDb = {
  $transaction: <R>(fn: (tx: CohortPublishTx) => Promise<R>) => Promise<R>;
};

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export type CohortServiceDeps = {
  delegate: Delegate<CohortRecord>;
  enrolment: CohortGuardEnrolmentDelegate;
  aggregate: CohortAggregateDelegate;
  db: CohortPublishDb;
  toScope: (id: string) => ResourceScope | Promise<ResourceScope>;
  withPermission: WithPermission;
  audit: (entry: ResourceAuditEntry) => Promise<void>;
  runInTransaction: <R>(fn: () => Promise<R>) => Promise<R>;
  now?: () => Date;
};

export function createCohortService(deps: CohortServiceDeps) {
  const { withPermission } = deps;
  const { assertOfferMutable } = createCohortGuards({ enrolment: deps.enrolment });

  const cohortService = createResourceService<CohortRecord>({
    name: "Cohort",
    delegate: deps.delegate,
    permissions: {
      view: "cohorts.view",
      create: "cohorts.manage",
      edit: "cohorts.manage",
    },
    toScope: deps.toScope,
    withPermission,
    audit: deps.audit,
    // D-31 — archive is a soft-cancel, never a delete.
    archiveData: () => ({ status: "CANCELLED" }),
    runInTransaction: deps.runInTransaction,
  });

  /**
   * The D-30 wrapper around `cohortService.update`. Runs `assertOfferMutable`
   * first whenever the payload carries a `courseId`/`programmeId` whose
   * submitted value differs from the stored one, then delegates to the
   * factory's audited update.
   */
  const updateCohort = withPermission<{
    id: string;
    data: Record<string, unknown>;
    reason?: string;
  }>("cohorts.manage", (input) => deps.toScope(input.id))(async (input) => {
    const changesCourse = "courseId" in input.data;
    const changesProgramme = "programmeId" in input.data;

    if (changesCourse || changesProgramme) {
      const current = await deps.delegate.findUnique({ where: { id: input.id } });
      const courseDiffers =
        changesCourse && input.data.courseId !== (current?.courseId ?? null);
      const programmeDiffers =
        changesProgramme && input.data.programmeId !== (current?.programmeId ?? null);
      if (courseDiffers || programmeDiffers) {
        await assertOfferMutable(input.id);
      }
    }

    return cohortService.update(input.id, input.data, input.reason);
  });

  const now = deps.now ?? (() => new Date());

  async function loadAggregateRow(cohortId: string): Promise<CohortAggregateRow | null> {
    return deps.aggregate.findUnique({
      where: { id: cohortId },
      select: AGGREGATE_SELECT as unknown as Record<string, unknown>,
    });
  }

  /**
   * The cohort detail page's readiness input (D-27). Reads the cohort row, its
   * non-cancelled sessions, its instructor count and its offer target's latest
   * publication, then hands plain values to the pure evaluator. Returns `null`
   * for a missing cohort.
   */
  async function loadCohortReadinessAggregate(
    cohortId: string,
  ): Promise<ReadinessCohortInput | null> {
    const row = await loadAggregateRow(cohortId);
    return row ? toReadinessInput(row) : null;
  }

  /**
   * COH-04 / D-27 / D-29. Gated on the dedicated publish permission —
   * a manage grant is not enough. Order: load the aggregate; refuse
   * with `NoPublishedOfferError` when the offer target has no publication to
   * pin; run `blockingFailures(evaluateCohortReadiness(...))` and refuse with
   * `CohortReadinessRefusedError` when non-empty — this server-side check is
   * the gate, the disabled button is only a courtesy echo; then, in one
   * transaction, claim `updatedAt` with a conditional `updateMany`
   * (`StaleOrderError` on a lost race), pin the latest publication, stamp
   * status + `publishedAt`, and append one `cohort.published` outbox row.
   * Audit after commit.
   */
  const publishCohort = withPermission<{
    cohortId: string;
    expectedUpdatedAt: Date;
    reason?: string;
  }>("cohorts.publish", (input) => deps.toScope(input.cohortId))(
    async (input, ctx) => {
      const row = await loadAggregateRow(input.cohortId);
      if (!row) throw new CohortNotFoundError(input.cohortId);

      const aggregate = toReadinessInput(row);
      const pin = aggregate.pin!;
      if (pin.publicationId == null) {
        throw new NoPublishedOfferError(input.cohortId, pin.kind);
      }

      const failures = blockingFailures(evaluateCohortReadiness(aggregate));
      if (failures.length > 0) {
        throw new CohortReadinessRefusedError(failures);
      }

      const publishedAt = now();
      const pinColumn =
        pin.kind === "course" ? "coursePublicationId" : "programmePublicationId";

      await deps.db.$transaction(async (tx) => {
        const claimed = await tx.cohort.updateMany({
          where: { id: input.cohortId, updatedAt: input.expectedUpdatedAt },
          data: {
            status: PUBLISHED_STATUS,
            publishedAt,
            [pinColumn]: pin.publicationId,
          },
        });
        if (claimed.count === 0) throw new StaleOrderError();

        await writeDomainEvent(tx, {
          type: "cohort.published",
          payload: {
            cohortId: input.cohortId,
            publicationId: pin.publicationId,
            actorId: ctx.actor.userId,
          },
        });
      });

      const reason = input.reason?.trim() ? input.reason.trim() : null;
      await deps.audit({
        action: "cohort.published",
        targetType: "Cohort",
        targetId: input.cohortId,
        actorId: ctx.actor.userId,
        outcome: "SUCCESS",
        reason,
        before: { status: row.status },
        after: { status: PUBLISHED_STATUS, publicationId: pin.publicationId },
      });

      return { publicationId: pin.publicationId, status: PUBLISHED_STATUS };
    },
  );

  return { cohortService, updateCohort, loadCohortReadinessAggregate, publishCohort };
}

// ---------------------------------------------------------------------------
// Prisma-backed binding
// ---------------------------------------------------------------------------

const built = createCohortService({
  delegate: prisma.cohort as unknown as Delegate<CohortRecord>,
  enrolment: prisma.enrolment as unknown as CohortGuardEnrolmentDelegate,
  aggregate: prisma.cohort as unknown as CohortAggregateDelegate,
  db: {
    $transaction: (fn) =>
      prisma.$transaction((tx) => fn(tx as unknown as CohortPublishTx)),
  },
  toScope: cohortResourceScope,
  withPermission: liveWithPermission,
  audit: (entry) =>
    recordAudit({
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      before: entry.before,
      after: entry.after,
      reason: entry.reason,
      outcome: entry.outcome,
    }),
  runInTransaction: (fn) => prisma.$transaction(fn),
});

export const cohortService = built.cohortService;
export const updateCohort = built.updateCohort;
export const publishCohort = built.publishCohort;
export const loadCohortReadinessAggregate = built.loadCohortReadinessAggregate;

/** Bound to `prisma.enrolment` — the guard plan 05-11/05-12 call directly. */
export const { assertOfferMutable } = createCohortGuards({
  enrolment: prisma.enrolment as unknown as CohortGuardEnrolmentDelegate,
});
