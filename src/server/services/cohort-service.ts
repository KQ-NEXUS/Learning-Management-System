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
import { CohortNotFoundError, assertCohortOpen, lockCohort } from "./seat-accounting";
import {
  applyEnrolmentExit,
  ReasonRequiredError,
  type EnrolmentRow,
} from "./enrolment-service";

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

// ---------------------------------------------------------------------------
// cancelCohort (D-31) — bulk withdraw + status change, all atomic
// ---------------------------------------------------------------------------

/**
 * Thrown when `cancelCohort` is called on a Cohort whose `status` is already
 * `CANCELLED`. Nothing is written — no enrolment touched, no session
 * touched, no audit row, no event.
 */
export class CohortCancelBlockedError extends Error {
  readonly cohortId: string;

  constructor(cohortId: string) {
    super(`Cohort ${cohortId} is already cancelled.`);
    this.name = "CohortCancelBlockedError";
    this.cohortId = cohortId;
  }
}

/** UI-SPEC line 160's `ConfirmModal minReasonLength: 10` contract. */
const CANCEL_REASON_MIN_LENGTH = 10;

/**
 * Copy of the `publish-service.ts` / `enrolment-service.ts` shape, widened
 * with a minimum trimmed length so a one-word reason cannot bulk-withdraw an
 * entire roster.
 */
function requireCancelReason(reason: string | null | undefined): string {
  const trimmed = reason?.trim();
  if (!trimmed || trimmed.length < CANCEL_REASON_MIN_LENGTH) {
    throw new ReasonRequiredError(
      `A reason of at least ${CANCEL_REASON_MIN_LENGTH} characters is required to cancel a cohort.`,
    );
  }
  return trimmed;
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

/** The `ScheduledSession` columns `cancelCohort`'s soft-cancel loop reads
 *  and writes (D-26 — never a delete). */
export type ScheduledSessionCancelRow = { id: string; cancelledAt: Date | null };

/**
 * The transaction client `publishCohort` and `cancelCohort` need —
 * structurally satisfied by a Prisma `tx` and by a unit-test fake, so no
 * `@prisma/client` import. Widened beyond `publishCohort`'s own needs
 * (`cohort.updateMany` / `domainEvent.create`) to also carry what
 * `cancelCohort`'s bulk withdraw/session-cancel needs: `enrolment.findMany`
 * plus everything `applyEnrolmentExit` (`enrolment-service.ts`) requires of a
 * tx — `$queryRaw`/`$executeRaw`/`enrolment.update`/`cohort.update` — and the
 * session soft-cancel's `scheduledSession.findMany`/`update`. A real Prisma
 * `tx` satisfies every field; a unit-test fake only needs to implement what
 * the operation under test calls.
 */
export type CohortPublishTx = {
  $queryRaw<T = unknown>(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  cohort: {
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<unknown>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
    /** Re-reads the readiness aggregate from INSIDE the publish transaction
     *  (CR-02) — the pre-transaction read used for the fail-fast checks can
     *  go stale between that read and the transaction claiming the row, since
     *  instructor assignment and session create/cancel do not bump the
     *  cohort's own `updatedAt`. */
    findUnique(args: {
      where: { id: string };
      select: Record<string, unknown>;
    }): Promise<CohortAggregateRow | null>;
  };
  enrolment: {
    findMany(args: { where: Record<string, unknown> }): Promise<EnrolmentRow[]>;
    update(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<unknown>;
  };
  scheduledSession: {
    findMany(args: {
      where: Record<string, unknown>;
    }): Promise<ScheduledSessionCancelRow[]>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  domainEvent: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
};

export type CohortPublishDb = {
  $transaction: <R>(fn: (tx: CohortPublishTx) => Promise<R>) => Promise<R>;
};

// ---------------------------------------------------------------------------
// Instructor assignment — the readiness gate's "Instructors" check (D-27)
// otherwise has no writer anywhere in the app; only `prisma/seed.ts` could
// ever populate `CohortInstructor`, so a staff-created instructor-led or
// blended cohort could never clear that check and could never be published.
// ---------------------------------------------------------------------------

export class InstructorUserNotFoundError extends Error {
  constructor(readonly userId: string) {
    super(`No user with id ${userId} exists.`);
    this.name = "InstructorUserNotFoundError";
  }
}

/**
 * True for a Prisma `PrismaClientKnownRequestError` with code `P2002`
 * (unique-constraint violation), duck-typed on `.code` so this file stays
 * free of a Prisma client import (copied from `seat-accounting.ts:132-139`).
 */
function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

/** True for Prisma's "record to delete/update does not exist" (P2025) —
 *  the delete-side counterpart of the race `isUniqueConstraintViolation`
 *  guards on the create side. */
function isRecordNotFoundError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2025"
  );
}

export type CohortInstructorRow = {
  id: string;
  user: { id: string; name: string; email: string };
};

/** Injected so assignment is unit-testable without a real Postgres. */
export type CohortInstructorDelegate = {
  findMany(args: {
    where: { cohortId: string };
    select: Record<string, unknown>;
    orderBy: Record<string, unknown>;
  }): Promise<CohortInstructorRow[]>;
  findUnique(args: {
    where: { cohortId_userId: { cohortId: string; userId: string } };
  }): Promise<{ id: string } | null>;
  create(args: { data: { cohortId: string; userId: string } }): Promise<{ id: string }>;
  delete(args: {
    where: { cohortId_userId: { cohortId: string; userId: string } };
  }): Promise<unknown>;
};

export type UserExistsDelegate = {
  findUnique(args: {
    where: { id: string };
    select: { id: true; name: true; email: true };
  }): Promise<{ id: string; name: string; email: string } | null>;
};

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export type CohortServiceDeps = {
  delegate: Delegate<CohortRecord>;
  enrolment: CohortGuardEnrolmentDelegate;
  aggregate: CohortAggregateDelegate;
  instructor: CohortInstructorDelegate;
  user: UserExistsDelegate;
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
   * first whenever the offer changes, then conditionally writes the page
   * version so competing editors cannot silently overwrite one another.
   */
  const updateCohort = withPermission<{
    id: string;
    data: Record<string, unknown>;
    expectedUpdatedAt?: Date;
    reason?: string;
  }>("cohorts.manage", (input) => deps.toScope(input.id))(async (input, ctx) => {
    const current = await deps.delegate.findUnique({ where: { id: input.id } });
    if (!current) throw new CohortNotFoundError(input.id);
    const expectedUpdatedAt = input.expectedUpdatedAt ?? current.updatedAt;
    if (current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new StaleOrderError();
    const changesCourse = "courseId" in input.data;
    const changesProgramme = "programmeId" in input.data;

    if (changesCourse || changesProgramme) {
      const courseDiffers =
        changesCourse && input.data.courseId !== (current?.courseId ?? null);
      const programmeDiffers =
        changesProgramme && input.data.programmeId !== (current?.programmeId ?? null);
      if (courseDiffers || programmeDiffers) {
        await assertOfferMutable(input.id);
      }
    }

    // Prisma's extended unique filter checks the version in the UPDATE itself.
    // Always advance it, even for two writes within one clock millisecond.
    const where = { id: input.id, updatedAt: expectedUpdatedAt };
    let after: CohortRecord;
    try {
      after = await deps.delegate.update({
        where,
        data: { ...input.data, updatedAt: new Date(Math.max(now().getTime(), current.updatedAt.getTime() + 1)) },
      });
    } catch (error) {
      if (isRecordNotFoundError(error)) throw new StaleOrderError();
      throw error;
    }
    await deps.audit({
      action: "cohort.updated", targetType: "Cohort", targetId: input.id,
      actorId: ctx.actor.userId, outcome: "SUCCESS", reason: input.reason ?? null,
      before: current, after,
    });
    return after;
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
   * The Overview tab's instructor list — read side of the assignment
   * feature below. Gated on `cohorts.view` like every other read of this
   * resource.
   */
  const loadCohortInstructors = withPermission<{ cohortId: string }>(
    "cohorts.view",
    (input) => deps.toScope(input.cohortId),
  )(async (input) => {
    return deps.instructor.findMany({
      where: { cohortId: input.cohortId },
      select: { id: true, user: { select: { id: true, name: true, email: true } } },
      orderBy: { user: { name: "asc" } },
    });
  });

  /**
   * Assigns a user as an instructor on this cohort — the only writer
   * `CohortInstructor` has anywhere in the app (previously only
   * `prisma/seed.ts` could populate it, which meant a staff-created
   * instructor-led/blended cohort could never clear the readiness panel's
   * "Instructors" check and could never be published). Idempotent: assigning
   * an already-assigned user is a no-op success, not a unique-constraint
   * error — including when two concurrent requests both pass the
   * check-then-write race (the `@@unique([cohortId, userId])` constraint is
   * the real guard; a losing `create` here is swallowed, not rethrown).
   */
  const assignCohortInstructor = withPermission<{ cohortId: string; userId: string }>(
    "cohorts.manage",
    (input) => deps.toScope(input.cohortId),
  )(async (input, ctx) => {
    const user = await deps.user.findUnique({
      where: { id: input.userId },
      select: { id: true, name: true, email: true },
    });
    if (!user) throw new InstructorUserNotFoundError(input.userId);

    const existing = await deps.instructor.findUnique({
      where: { cohortId_userId: { cohortId: input.cohortId, userId: input.userId } },
    });
    if (!existing) {
      try {
        await deps.instructor.create({ data: { cohortId: input.cohortId, userId: input.userId } });
      } catch (err) {
        if (!isUniqueConstraintViolation(err)) throw err;
        return { cohortId: input.cohortId, userId: user.id, userName: user.name };
      }
      await deps.audit({
        action: "cohort.instructor_assigned",
        targetType: "Cohort",
        targetId: input.cohortId,
        actorId: ctx.actor.userId,
        outcome: "SUCCESS",
        reason: null,
        before: null,
        after: { userId: user.id, userName: user.name },
      });
    }
    return { cohortId: input.cohortId, userId: user.id, userName: user.name };
  });

  /** Removes a user's instructor assignment. Idempotent: removing one that
   *  is not there — including one a concurrent request just removed — is a
   *  no-op success, never a rethrown "record not found". */
  const removeCohortInstructor = withPermission<{ cohortId: string; userId: string }>(
    "cohorts.manage",
    (input) => deps.toScope(input.cohortId),
  )(async (input, ctx) => {
    const existing = await deps.instructor.findUnique({
      where: { cohortId_userId: { cohortId: input.cohortId, userId: input.userId } },
    });
    if (existing) {
      try {
        await deps.instructor.delete({
          where: { cohortId_userId: { cohortId: input.cohortId, userId: input.userId } },
        });
      } catch (err) {
        if (!isRecordNotFoundError(err)) throw err;
        return { cohortId: input.cohortId, userId: input.userId };
      }
      await deps.audit({
        action: "cohort.instructor_removed",
        targetType: "Cohort",
        targetId: input.cohortId,
        actorId: ctx.actor.userId,
        outcome: "SUCCESS",
        reason: null,
        before: { userId: input.userId },
        after: null,
      });
    }
    return { cohortId: input.cohortId, userId: input.userId };
  });

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
      assertCohortOpen(input.cohortId, row.status);

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

      const publishedPublicationId = await deps.db.$transaction(async (tx) => {
        // CR-02: re-read the aggregate and re-evaluate readiness INSIDE the
        // transaction that claims the row. Instructor assignment/removal and
        // session create/cancel do not bump `Cohort.updatedAt`, so the
        // pre-transaction read above can be stale by the time this
        // transaction opens — the fresh evaluate-and-claim must happen
        // together or a cohort that lost its only instructor/session between
        // the two reads would still publish.
        const freshRow = await tx.cohort.findUnique({
          where: { id: input.cohortId },
          select: AGGREGATE_SELECT as unknown as Record<string, unknown>,
        });
        if (!freshRow) throw new CohortNotFoundError(input.cohortId);
        assertCohortOpen(input.cohortId, freshRow.status);

        const freshAggregate = toReadinessInput(freshRow);
        const freshPin = freshAggregate.pin!;
        if (freshPin.publicationId == null) {
          throw new NoPublishedOfferError(input.cohortId, freshPin.kind);
        }
        const freshFailures = blockingFailures(evaluateCohortReadiness(freshAggregate));
        if (freshFailures.length > 0) {
          throw new CohortReadinessRefusedError(freshFailures);
        }

        const pinColumn =
          freshPin.kind === "course" ? "coursePublicationId" : "programmePublicationId";

        const claimed = await tx.cohort.updateMany({
          where: {
            id: input.cohortId,
            updatedAt: input.expectedUpdatedAt,
            status: { in: ["DRAFT", "PUBLISHED", "IN_PROGRESS"] },
          },
          data: {
            status: PUBLISHED_STATUS,
            publishedAt,
            [pinColumn]: freshPin.publicationId,
          },
        });
        if (claimed.count === 0) throw new StaleOrderError();

        await writeDomainEvent(tx, {
          type: "cohort.published",
          payload: {
            cohortId: input.cohortId,
            publicationId: freshPin.publicationId,
            actorId: ctx.actor.userId,
          },
        });

        return freshPin.publicationId;
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
        after: { status: PUBLISHED_STATUS, publicationId: publishedPublicationId },
      });

      return { publicationId: publishedPublicationId, status: PUBLISHED_STATUS };
    },
  );

  /**
   * COH-05 / D-31 / T-05-68..T-05-75. UI-SPEC line 160's confirmation copy
   * ("Withdraws all {n} active enrolments … cancels every scheduled session
   * … kept as cancelled, never deleted") is the exact contract this
   * implements: mandatory reason (min 10 trimmed chars, matching the
   * `ConfirmModal` contract), refuse an already-`CANCELLED` cohort, then in
   * ONE `$transaction` — every `ACTIVE` enrolment -> `WITHDRAWN`, every
   * `PENDING_PAYMENT` enrolment -> `CANCELLED` (D-14's distinction) via the
   * SHARED `applyEnrolmentExit` (never a second copy of the transition
   * table — grep gate), soft-cancel every non-cancelled session (D-26 — never
   * a delete), and claim the cohort with a conditional `updateMany`
   * (`StaleOrderError` on a lost race). Per-transition audit rows — one per
   * affected enrolment, one per cancelled session, one for the cohort — are
   * written AFTER commit; a single batch row would lose exactly the history
   * the roster and ATT-03 depend on (D-31, T-05-69).
   */
  const cancelCohort = withPermission<{
    cohortId: string;
    reason: string;
    expectedUpdatedAt: Date;
  }>("cohorts.manage", (input) => deps.toScope(input.cohortId))(
    async (input, ctx) => {
      const reason = requireCancelReason(input.reason);

      const cohort = await deps.delegate.findUnique({ where: { id: input.cohortId } });
      if (!cohort) throw new CohortNotFoundError(input.cohortId);
      if (cohort.status === "CANCELLED") {
        throw new CohortCancelBlockedError(input.cohortId);
      }

      const cancelledAt = now();

      const { affected, cancelledSessionIds } = await deps.db.$transaction(async (tx) => {
        // Lock BEFORE taking the roster snapshot, including an empty roster.
        // Admission paths take this same lock and re-check status after waiting.
        const current = await lockCohort(tx, input.cohortId);
        if (current.status === "CANCELLED") throw new CohortCancelBlockedError(input.cohortId);
        // D-14: ACTIVE -> WITHDRAWN, PENDING_PAYMENT -> CANCELLED. Every
        // other status (WITHDRAWN/CANCELLED/TRANSFERRED/COMPLETED) is left
        // untouched by construction — this query never selects it.
        const enrolments = await tx.enrolment.findMany({
          where: { cohortId: input.cohortId, status: { in: ["ACTIVE", "PENDING_PAYMENT"] } },
        });

        const affected: Array<{
          id: string;
          before: string;
          toStatus: "WITHDRAWN" | "CANCELLED";
        }> = [];
        for (const enrolment of enrolments) {
          const toStatus = enrolment.status === "ACTIVE" ? "WITHDRAWN" : "CANCELLED";
          const result = await applyEnrolmentExit(tx, {
            enrolment,
            toStatus,
            reason,
            actorId: ctx.actor.userId,
            now: cancelledAt,
          });
          affected.push(result);
        }

        // D-26: soft-cancel only, never a delete.
        const sessions = await tx.scheduledSession.findMany({
          where: { cohortId: input.cohortId, cancelledAt: null },
        });
        for (const session of sessions) {
          await tx.scheduledSession.update({
            where: { id: session.id },
            data: { cancelledAt, cancellationReason: reason },
          });
        }

        const claimed = await tx.cohort.updateMany({
          where: { id: input.cohortId, updatedAt: input.expectedUpdatedAt },
          data: { status: "CANCELLED", seatsTaken: 0 },
        });
        if (claimed.count === 0) throw new StaleOrderError();

        await writeDomainEvent(tx, {
          type: "cohort.cancelled",
          payload: { cohortId: input.cohortId, actorId: ctx.actor.userId, reason },
        });

        return { affected, cancelledSessionIds: sessions.map((s) => s.id) };
      });

      // Per-transition audit rows, written after commit (T-05-69) — one per
      // affected enrolment, one per cancelled session, one for the cohort.
      for (const e of affected) {
        await deps.audit({
          action: e.toStatus === "WITHDRAWN" ? "enrolment.withdrawn" : "enrolment.cancelled",
          targetType: "Enrolment",
          targetId: e.id,
          actorId: ctx.actor.userId,
          outcome: "SUCCESS",
          reason,
          before: { status: e.before },
          after: { status: e.toStatus },
        });
      }
      for (const sessionId of cancelledSessionIds) {
        await deps.audit({
          action: "session.cancelled",
          targetType: "ScheduledSession",
          targetId: sessionId,
          actorId: ctx.actor.userId,
          outcome: "SUCCESS",
          reason,
          before: { cancelledAt: null },
          after: { cancelledAt },
        });
      }
      await deps.audit({
        action: "cohort.cancelled",
        targetType: "Cohort",
        targetId: input.cohortId,
        actorId: ctx.actor.userId,
        outcome: "SUCCESS",
        reason,
        before: { status: cohort.status },
        after: { status: "CANCELLED", seatsTaken: 0 },
      });

      return {
        cohortId: input.cohortId,
        status: "CANCELLED" as const,
        withdrawnCount: affected.filter((e) => e.toStatus === "WITHDRAWN").length,
        cancelledCount: affected.filter((e) => e.toStatus === "CANCELLED").length,
        sessionsCancelled: cancelledSessionIds.length,
      };
    },
  );

  return {
    cohortService,
    updateCohort,
    loadCohortReadinessAggregate,
    loadCohortInstructors,
    assignCohortInstructor,
    removeCohortInstructor,
    publishCohort,
    cancelCohort,
  };
}

// ---------------------------------------------------------------------------
// Prisma-backed binding
// ---------------------------------------------------------------------------

const built = createCohortService({
  delegate: prisma.cohort as unknown as Delegate<CohortRecord>,
  enrolment: prisma.enrolment as unknown as CohortGuardEnrolmentDelegate,
  aggregate: prisma.cohort as unknown as CohortAggregateDelegate,
  instructor: prisma.cohortInstructor as unknown as CohortInstructorDelegate,
  user: prisma.user as unknown as UserExistsDelegate,
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
export const cancelCohort = built.cancelCohort;
export const loadCohortReadinessAggregate = built.loadCohortReadinessAggregate;
export const loadCohortInstructors = built.loadCohortInstructors;
export const assignCohortInstructor = built.assignCohortInstructor;
export const removeCohortInstructor = built.removeCohortInstructor;

/** Bound to `prisma.enrolment` — the guard plan 05-11/05-12 call directly. */
export const { assertOfferMutable } = createCohortGuards({
  enrolment: prisma.enrolment as unknown as CohortGuardEnrolmentDelegate,
});
