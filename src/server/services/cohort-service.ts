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

type WithPermission = ReturnType<typeof createWithPermission>;

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
// The service
// ---------------------------------------------------------------------------

export type CohortServiceDeps = {
  delegate: Delegate<CohortRecord>;
  enrolment: CohortGuardEnrolmentDelegate;
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

  return { cohortService, updateCohort };
}

// ---------------------------------------------------------------------------
// Prisma-backed binding
// ---------------------------------------------------------------------------

const built = createCohortService({
  delegate: prisma.cohort as unknown as Delegate<CohortRecord>,
  enrolment: prisma.enrolment as unknown as CohortGuardEnrolmentDelegate,
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

/** Bound to `prisma.enrolment` — the guard plan 05-11/05-12 call directly. */
export const { assertOfferMutable } = createCohortGuards({
  enrolment: prisma.enrolment as unknown as CohortGuardEnrolmentDelegate,
});
