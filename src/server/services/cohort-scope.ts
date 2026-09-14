/**
 * Async cohort scope resolvers (D-21).
 *
 * Turns a cohortId / sessionId / enrolmentId into a `ResourceScope` the
 * authorization core (`src/server/permissions/scope.ts` `grantMatches`) can
 * match a COHORT, PROGRAMME or COURSE grant against. This is what makes
 * COHORT scope load-bearing for the first time — an Instructor's COHORT
 * grant, a Programme Manager's PROGRAMME grant, and a Course-scoped
 * manager's COURSE grant must all be able to reach a cohort-scoped
 * resource.
 *
 * This file is authorization *input*, not an authorization *check*. It must
 * not take a value import from the permissions layer or anything under it —
 * only the `ResourceScope` type, written as `import type`. Keeping that
 * layer out of here is what stops it reaching the scheduled-function import
 * closure (`tests/boundary.test.ts`), the same constraint the
 * `*-system-service.ts` modules document in their headers.
 *
 * Every resolver takes ONLY an id and reads the row from the database. No
 * resolver signature accepts a caller-supplied cohortId / programmeId /
 * courseId — a caller-asserted parent id would be a scope the caller chose
 * (threat T-05-06). `sessionCohortScope` and `enrolmentCohortScope` resolve
 * the owning cohortId from the row, then delegate.
 */

import { prisma } from "@/server/db";
import type { ResourceScope } from "@/server/permissions/scope";

type CohortScopeRow = {
  id: string;
  programmeId: string | null;
  courseId: string | null;
  cohortCourses: Array<{ courseId: string }>;
};

/** The `Cohort` delegate slice this module uses. Injected for unit tests. */
export type CohortScopeDelegate = {
  findUnique(args: {
    where: { id: string };
    select: {
      id: true;
      programmeId: true;
      courseId: true;
      cohortCourses: { select: { courseId: true } };
    };
  }): Promise<CohortScopeRow | null>;
};

/** The `ScheduledSession` delegate slice this module uses. */
export type SessionScopeDelegate = {
  findUnique(args: {
    where: { id: string };
    select: { cohortId: true };
  }): Promise<{ cohortId: string } | null>;
};

/** The `Enrolment` delegate slice this module uses. */
export type EnrolmentScopeDelegate = {
  findUnique(args: {
    where: { id: string };
    select: { cohortId: true };
  }): Promise<{ cohortId: string } | null>;
};

/**
 * The `Order` delegate slice this module uses (07-08). `Order.cohortId` is a
 * direct column (unlike `ScheduledSession`/`Enrolment`, which also resolve
 * through a single `cohortId` field) — still a one-hop delegate-to-resolver
 * shape for consistency with its two siblings above.
 */
export type OrderScopeDelegate = {
  findUnique(args: {
    where: { id: string };
    select: { cohortId: true };
  }): Promise<{ cohortId: string } | null>;
};

export type CohortScopeDeps = {
  cohort: CohortScopeDelegate;
  session: SessionScopeDelegate;
  enrolment: EnrolmentScopeDelegate;
  /**
   * Optional (07-08) — every pre-existing caller of `createCohortScopeResolvers`
   * (`attendance-service.ts`, several integration tests) builds an instance
   * to use only `cohortResourceScope`/`sessionCohortScope`/
   * `enrolmentCohortScope` and has never needed an `Order` delegate. Making
   * this required would force every one of those call sites to supply a
   * delegate they never call. `orderCohortScope` throws a clear, named error
   * if invoked on an instance built without one, rather than a bare
   * "Cannot read property of undefined."
   */
  order?: OrderScopeDelegate;
};

/** Thrown by `orderCohortScope` when the `CohortScopeDeps` instance it runs against was built without an `order` delegate. */
export class MissingOrderScopeDelegateError extends Error {
  constructor() {
    super("orderCohortScope requires a CohortScopeDeps instance built with an 'order' delegate.");
    this.name = "MissingOrderScopeDelegateError";
  }
}

export function createCohortScopeResolvers(deps: CohortScopeDeps) {
  /**
   * Resolves a cohortId to a `ResourceScope` populating ALL THREE keys:
   * `cohortId`, `programmeId` (when the cohort delivers a Programme), and
   * `courseIds` — `[courseId]` for a standalone-Course cohort, or the
   * `CohortCourse` member course ids for a Programme cohort. Populating all
   * three is what lets a PROGRAMME or COURSE grant reach the cohort through
   * `grantMatches`; omitting `courseIds` would silently deny a
   * Course-scoped Programme Manager (threat T-05-07).
   *
   * A missing row returns `{}` so the authorization core denies by default
   * (threat T-05-08).
   */
  async function cohortResourceScope(cohortId: string): Promise<ResourceScope> {
    const row = await deps.cohort.findUnique({
      where: { id: cohortId },
      select: {
        id: true,
        programmeId: true,
        courseId: true,
        cohortCourses: { select: { courseId: true } },
      },
    });

    if (!row) {
      return {};
    }

    return {
      cohortId: row.id,
      ...(row.programmeId ? { programmeId: row.programmeId } : {}),
      courseIds: row.courseId
        ? [row.courseId]
        : row.cohortCourses.map((cc) => cc.courseId),
    };
  }

  async function sessionCohortScope(sessionId: string): Promise<ResourceScope> {
    const row = await deps.session.findUnique({
      where: { id: sessionId },
      select: { cohortId: true },
    });
    if (!row) {
      return {};
    }
    return cohortResourceScope(row.cohortId);
  }

  async function enrolmentCohortScope(enrolmentId: string): Promise<ResourceScope> {
    const row = await deps.enrolment.findUnique({
      where: { id: enrolmentId },
      select: { cohortId: true },
    });
    if (!row) {
      return {};
    }
    return cohortResourceScope(row.cohortId);
  }

  /**
   * 07-08 — resolves an `Order` id to its owning cohort's `ResourceScope`, the
   * scope resolver `manual-payment-service.ts`/`refund-service.ts` both need
   * for their `withPermission("payments.confirm" | "refunds.manage", ...)`
   * gates. No prior resolver in this file covers `Order`, since nothing
   * before Phase 7 authorized a staff action keyed on an Order id.
   */
  async function orderCohortScope(orderId: string): Promise<ResourceScope> {
    if (!deps.order) {
      throw new MissingOrderScopeDelegateError();
    }
    const row = await deps.order.findUnique({
      where: { id: orderId },
      select: { cohortId: true },
    });
    if (!row) {
      return {};
    }
    return cohortResourceScope(row.cohortId);
  }

  return { cohortResourceScope, sessionCohortScope, enrolmentCohortScope, orderCohortScope };
}

const built = createCohortScopeResolvers({
  cohort: prisma.cohort as unknown as CohortScopeDelegate,
  session: prisma.scheduledSession as unknown as SessionScopeDelegate,
  enrolment: prisma.enrolment as unknown as EnrolmentScopeDelegate,
  order: prisma.order as unknown as OrderScopeDelegate,
});

/** Bound to `prisma.cohort` — the instance the resource-service factory wires as `toScope`. */
export const cohortResourceScope = built.cohortResourceScope;
/** Bound to `prisma.scheduledSession` — two-hop resolver for session-scoped resources. */
export const sessionCohortScope = built.sessionCohortScope;
/** Bound to `prisma.enrolment` — two-hop resolver for enrolment-scoped resources. */
export const enrolmentCohortScope = built.enrolmentCohortScope;
/** Bound to `prisma.order` — two-hop resolver for Order-scoped staff actions (07-08). */
export const orderCohortScope = built.orderCohortScope;
