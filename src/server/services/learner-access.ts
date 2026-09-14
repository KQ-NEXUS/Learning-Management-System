/**
 * Ownership-scoped enrolment, course-structure and pinned-rule resolution
 * for a learner accessing their own delivery (D-07, DD-10, DD-11).
 *
 * DD-10: this module deliberately does NOT go through `withPermission`.
 * `ResourceScope` (`src/server/permissions/scope.ts`) is Global / Programme /
 * Course / Cohort — it has no user/enrolment dimension. Forcing "is this
 * enrolment mine" through that choke point would require either inventing a
 * permission identifier the closed 36-entry catalogue does not have, or
 * fabricating a scope that would leak to sibling enrolments in the same
 * cohort. `checkout-service.ts` (`getOwnOrder`) and `profile-service.ts`
 * document the identical reasoning for the identical reason: authorization
 * here is an ownership comparison, not a permission check, and that is the
 * intended model, not a gap. This file imports no permission wrapper — the
 * only reference to `@/server/permissions/with-permission` below is a
 * type-only import of `Actor`.
 *
 * DD-11: obligations (`required` flags, module/lesson membership,
 * `completionRule`, `completionRuleVersion`) come from the PINNED
 * publication payload (`publication.ts`'s `CourseObligationPayload` /
 * `ProgrammeObligationPayload`), never from a live `Course`/`Programme`/
 * `Lesson` row. Prose (titles, `type`, `allowManualComplete`,
 * `withdrawnAt`) stays live — that split is exactly what `publication.ts`'s
 * own header establishes.
 *
 * Follows the injected-store / live-singleton convention `roster-service.ts`
 * and `lesson-resource-service.ts` already use: `createLearnerAccessService`
 * takes a narrow structural store slice (unit-testable without Postgres),
 * and a live singleton is built at the bottom of the file from `prisma`.
 */

import { prisma } from "@/server/db";
import type { Actor } from "@/server/permissions/with-permission";
import { computeAccessWindow, type AccessWindow } from "@/server/services/access-window";

// ---------------------------------------------------------------------------
// Store rows — the narrow structural slice this module needs.
// ---------------------------------------------------------------------------

export type EnrolmentStoreRow = {
  id: string;
  userId: string;
  cohortId: string;
  status: string;
  accessStartsAt: Date | null;
  accessEndsAt: Date | null;
  activatedAt: Date | null;
};

export type CohortStoreRow = {
  id: string;
  title: string;
  deliveryMode: string;
  timezone: string;
  startsAt: Date;
  endsAt: Date;
  attendanceThresholdPct: number | null;
  courseId: string | null;
  programmeId: string | null;
  accessDurationDays: number | null;
  coursePublicationId: string | null;
  programmePublicationId: string | null;
};

export type CohortCourseStoreRow = {
  id: string;
  cohortId: string;
  courseId: string;
  position: number;
  coursePublicationId: string | null;
};

export type LearnerAccessStore = {
  enrolment: {
    findUnique(args: { where: { id: string } }): Promise<EnrolmentStoreRow | null>;
    findMany(args: { where: { userId: string; status: string } }): Promise<EnrolmentStoreRow[]>;
  };
  cohort: {
    findUnique(args: { where: { id: string } }): Promise<CohortStoreRow | null>;
  };
  cohortCourse: {
    findMany(args: { where: { cohortId: string } }): Promise<CohortCourseStoreRow[]>;
    findFirst(args: {
      where: { cohortId: string; courseId: string };
    }): Promise<CohortCourseStoreRow | null>;
  };
};

export type LearnerAccessDeps = {
  store: LearnerAccessStore;
  /** Explicit clock — no caller may read a client-controlled value (T-09-10). */
  now?: () => Date;
};

// ---------------------------------------------------------------------------
// Returned snapshot shape — NEVER carries `userId` (T-09-17).
// ---------------------------------------------------------------------------

export type OwnEnrolmentSnapshot = {
  id: string;
  cohortId: string;
  status: string;
  activatedAt: Date | null;
  accessStartsAt: Date | null;
  accessEndsAt: Date | null;
  cohort: {
    id: string;
    title: string;
    deliveryMode: string;
    timezone: string;
    startsAt: Date;
    endsAt: Date;
    attendanceThresholdPct: number | null;
    courseId: string | null;
    programmeId: string | null;
  };
  accessWindow: AccessWindow;
};

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export function createLearnerAccessService(deps: LearnerAccessDeps) {
  const { store } = deps;
  const now = deps.now ?? (() => new Date());

  /**
   * Not-found, not-mine and not-ACTIVE all return the identical `null` — a
   * guessed enrolment id cannot be used to confirm another learner's
   * enrolment exists (T-09-01, the T-06-13 denial-parity rule applied to
   * Enrolment). A `readOnly` access window does NOT make this return
   * `null` — D-03 keeps the enrolment ACTIVE and readable; only
   * content-opening and progress-writing callers refuse, via
   * `assertLessonOpenable` reading `accessWindow.readOnly`.
   */
  async function getOwnActiveEnrolment(
    actor: Actor,
    enrolmentId: string,
  ): Promise<OwnEnrolmentSnapshot | null> {
    const enrolment = await store.enrolment.findUnique({ where: { id: enrolmentId } });
    if (!enrolment || enrolment.userId !== actor.userId || enrolment.status !== "ACTIVE") {
      return null;
    }

    const cohort = await store.cohort.findUnique({ where: { id: enrolment.cohortId } });
    if (!cohort) return null; // defensive — the FK guarantees this in practice

    const accessWindow = computeAccessWindow({
      deliveryMode: cohort.deliveryMode,
      cohortEndsAt: cohort.endsAt,
      accessDurationDays: cohort.accessDurationDays,
      activatedAt: enrolment.activatedAt,
      accessEndsAt: enrolment.accessEndsAt,
      now: now(),
    });

    // `userId` is destructured out by construction — this object literal
    // simply never has the field, so no consumer can echo the owner id.
    return {
      id: enrolment.id,
      cohortId: enrolment.cohortId,
      status: enrolment.status,
      activatedAt: enrolment.activatedAt,
      accessStartsAt: enrolment.accessStartsAt,
      accessEndsAt: enrolment.accessEndsAt,
      cohort: {
        id: cohort.id,
        title: cohort.title,
        deliveryMode: cohort.deliveryMode,
        timezone: cohort.timezone,
        startsAt: cohort.startsAt,
        endsAt: cohort.endsAt,
        attendanceThresholdPct: cohort.attendanceThresholdPct,
        courseId: cohort.courseId,
        programmeId: cohort.programmeId,
      },
      accessWindow,
    };
  }

  /** Every ACTIVE enrolment for `actor.userId`, most-recently-activated first. */
  async function listOwnActiveEnrolments(actor: Actor): Promise<OwnEnrolmentSnapshot[]> {
    const rows = await store.enrolment.findMany({
      where: { userId: actor.userId, status: "ACTIVE" },
    });

    const ordered = rows.slice().sort((a, b) => {
      const aAt = a.activatedAt ? a.activatedAt.getTime() : 0;
      const bAt = b.activatedAt ? b.activatedAt.getTime() : 0;
      if (aAt !== bAt) return bAt - aAt; // descending
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    const snapshots: OwnEnrolmentSnapshot[] = [];
    for (const row of ordered) {
      const snapshot = await getOwnActiveEnrolment(actor, row.id);
      if (snapshot) snapshots.push(snapshot);
    }
    return snapshots;
  }

  /**
   * `true` iff `userId` holds an ACTIVE enrolment in a cohort whose offer
   * covers `courseId` — either the cohort's own `courseId` (a standalone
   * course-cohort) or a `CohortCourse` row for that cohort with that
   * `courseId` (a member course inside a programme-cohort). A
   * PENDING_PAYMENT / WITHDRAWN / CANCELLED / TRANSFERRED / COMPLETED
   * enrolment never counts.
   */
  async function hasActiveEnrolmentCoveringCourse(
    userId: string,
    courseId: string,
  ): Promise<boolean> {
    const activeEnrolments = await store.enrolment.findMany({
      where: { userId, status: "ACTIVE" },
    });

    for (const enrolment of activeEnrolments) {
      const cohort = await store.cohort.findUnique({ where: { id: enrolment.cohortId } });
      if (!cohort) continue;
      if (cohort.courseId === courseId) return true;

      const member = await store.cohortCourse.findFirst({
        where: { cohortId: cohort.id, courseId },
      });
      if (member) return true;
    }

    return false;
  }

  return { getOwnActiveEnrolment, listOwnActiveEnrolments, hasActiveEnrolmentCoveringCourse };
}

// ---------------------------------------------------------------------------
// Prisma-backed binding
//
// Cast the whole client to the narrow structural store, the same
// `prisma as unknown as <Store>` idiom `roster-service.ts` uses — this is
// what lets `LearnerAccessStore`'s `status`/`deliveryMode`/etc. fields stay
// plain `string` (so a fake store in tests needs no Prisma enum import)
// while the live binding still runs the real, fully-typed Prisma delegate
// underneath. Every call site above already states its own `where` shape;
// Prisma returns full rows by default; the narrower `StoreRow` types above
// are what every caller actually reads.
// ---------------------------------------------------------------------------

const liveStore = prisma as unknown as LearnerAccessStore;

const built = createLearnerAccessService({ store: liveStore });

export const getOwnActiveEnrolment = built.getOwnActiveEnrolment;
export const listOwnActiveEnrolments = built.listOwnActiveEnrolments;
export const hasActiveEnrolmentCoveringCourse = built.hasActiveEnrolmentCoveringCourse;
