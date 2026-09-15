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
import type {
  CourseObligationPayload,
  CourseObligationModule,
  CourseObligationLesson,
  ProgrammeObligationPayload,
} from "@/server/services/publication";
import {
  evaluateLessonSequencing,
  type SequencingLesson,
  type SequencingResult,
} from "@/server/services/lesson-sequencing";

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
  /**
   * Optional — only read by `getOwnPendingEnrolmentOrderHref` (09-09, DD-22).
   * Optional (not required) so every existing fake `LearnerAccessStore` row
   * built before this field existed keeps compiling unchanged.
   */
  orderId?: string | null;
};

export type OrderStoreRow = { reference: string };

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

export type CourseStoreRow = { id: string; title: string };

export type PublicationStoreRow = { payload: unknown };

export type ModuleStoreRow = {
  id: string;
  courseId: string;
  title: string;
  position: number;
  withdrawnAt: Date | string | null;
};

export type LessonStoreRow = {
  id: string;
  moduleId: string;
  title: string;
  type: string;
  position: number;
  required: boolean;
  allowManualComplete: boolean;
  withdrawnAt: Date | string | null;
};

export type LessonProgressStoreRow = {
  enrolmentId: string;
  lessonId: string;
  completedAt: Date;
  source: string;
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
  course: {
    findUnique(args: { where: { id: string } }): Promise<CourseStoreRow | null>;
  };
  coursePublication: {
    findUnique(args: { where: { id: string } }): Promise<PublicationStoreRow | null>;
  };
  programmePublication: {
    findUnique(args: { where: { id: string } }): Promise<PublicationStoreRow | null>;
  };
  module: {
    findMany(args: { where: { courseId: string } }): Promise<ModuleStoreRow[]>;
  };
  lesson: {
    findMany(args: { where: { moduleId: { in: string[] } } }): Promise<LessonStoreRow[]>;
  };
  lessonProgress: {
    findMany(args: { where: { enrolmentId: string } }): Promise<LessonProgressStoreRow[]>;
  };
  /**
   * Optional — only present so `getOwnPendingEnrolmentOrderHref` (09-09,
   * DD-22) can resolve the one PENDING_PAYMENT order/receipt link the
   * lesson-list access gate is allowed to show. Every other function in
   * this file never reads it.
   */
  order?: {
    findUnique(args: { where: { id: string } }): Promise<OrderStoreRow | null>;
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
// Pinned course structure (DD-11) — the shape a learner actually sees.
// ---------------------------------------------------------------------------

export type LearnerCourseLesson = {
  id: string;
  title: string;
  type: string;
  position: number;
  required: boolean;
  allowManualComplete: boolean;
  withdrawnAt: Date | string | null;
};

export type LearnerCourseModule = {
  id: string;
  title: string;
  position: number;
  lessons: LearnerCourseLesson[];
};

export type LearnerCourseEntry = {
  courseId: string;
  courseTitle: string;
  modules: LearnerCourseModule[];
};

/**
 * `{ kind: "unpinned" }` is a NAMED gap, not a live-tree fallback (D-06/OQ-1
 * as documented on `Cohort.coursePublicationId`) — an unpinned cohort is an
 * authoring anomaly a learner should never silently see the live tree for.
 */
export type LearnerCourseStructure =
  | { kind: "structure"; courses: LearnerCourseEntry[] }
  | { kind: "unpinned" };

export type PinnedCompletionRuleSource = { json: unknown; ruleVersion: number };

// ---------------------------------------------------------------------------
// The sequencing-applied learner path (D-04, D-05, D-06, D-16) and the one
// server-side open gate (LRN-02, T-09-02).
// ---------------------------------------------------------------------------

export type DecoratedLesson = LearnerCourseLesson & {
  locked: boolean;
  blockingLessonTitle: string | null;
  completed: boolean;
  completedSource: string | null;
  /** `LessonProgress.completedAt`, or `null` when never completed (plan
   *  09-13's staff per-learner page renders this alongside `completedSource`). */
  completedAt: Date | null;
};

export type DecoratedModule = { id: string; title: string; position: number; lessons: DecoratedLesson[] };

export type DecoratedCourseEntry = { courseId: string; courseTitle: string; modules: DecoratedModule[] };

export type LearnerPath = {
  enrolment: OwnEnrolmentSnapshot;
  courses: DecoratedCourseEntry[];
  /** Completed lesson ids, from live `LessonProgress` — recomputed on every call (D-16's lazy re-lock). */
  progress: ReadonlySet<string>;
  sequencing: SequencingResult[];
};

export type LessonOpenResult =
  | { ok: true; lesson: DecoratedLesson }
  | { ok: false; reason: "not-found" | "locked" | "access-window-closed" };

/**
 * Flattened course/module-index strides used to synthesise a globally
 * increasing `position` across a programme cohort's ordered member courses
 * before handing the flat list to the pure sequencing evaluator (which
 * sorts by `position`, tiebreaking equal values by lesson id — so any
 * unintended collision is order-fragile, not merely cosmetic). Pinned
 * lesson positions are only unique WITHIN their own MODULE (each module's
 * lessons restart at 0) — courses with more than one module need a module
 * offset too, not just a course offset (found via the 09-14 human
 * walkthrough: a two-module course collided module-1-position-0 with
 * module-2-position-0, and the id tiebreak happened to sort the wrong
 * module first). `courseIndex * COURSE_POSITION_STRIDE + moduleIndex *
 * MODULE_POSITION_STRIDE + lesson.position` is used instead. 1,000,000 and
 * 1,000 comfortably exceed any real course's module/lesson counts while
 * staying well clear of the schema's own negative `WITHDRAWN_PARK_BASE`
 * (-1,000,000) convention, so a synthesised position can never collide with
 * that band.
 */
const COURSE_POSITION_STRIDE = 1_000_000;
const MODULE_POSITION_STRIDE = 1_000;

function findDecoratedLesson(path: LearnerPath, lessonId: string): DecoratedLesson | null {
  for (const course of path.courses) {
    for (const mod of course.modules) {
      for (const lesson of mod.lessons) {
        if (lesson.id === lessonId) return lesson;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Runtime guards over `payload: Json` — never cast, always validated. A
// payload failing the guard is treated exactly like an absent pin.
// ---------------------------------------------------------------------------

function isObligationLessonShape(value: unknown): value is CourseObligationLesson {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.position === "number" &&
    typeof v.required === "boolean" &&
    typeof v.type === "string" &&
    (v.assessmentId === null || typeof v.assessmentId === "string")
  );
}

function isObligationModuleShape(value: unknown): value is CourseObligationModule {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.position === "number" &&
    Array.isArray(v.lessons) &&
    v.lessons.every(isObligationLessonShape)
  );
}

export function isCourseObligationPayload(value: unknown): value is CourseObligationPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.schema === "number" &&
    typeof v.completionRuleVersion === "number" &&
    Array.isArray(v.modules) &&
    v.modules.every(isObligationModuleShape)
  );
}

export function isProgrammeObligationPayload(value: unknown): value is ProgrammeObligationPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.schema === "number" &&
    typeof v.sequential === "boolean" &&
    typeof v.completionRuleVersion === "number" &&
    Array.isArray(v.courses) &&
    v.courses.every((c) => {
      if (!c || typeof c !== "object") return false;
      const cc = c as Record<string, unknown>;
      return typeof cc.courseId === "string" && typeof cc.position === "number";
    })
  );
}

/** Sorts by the PINNED payload's `position` then `id` — mirrors `publication.ts`'s own `byPositionThenId`, since position IS an obligation (DD-11) and must never be reordered by a live edit. */
function byPayloadPositionThenId<T extends { position: number; id: string }>(a: T, b: T): number {
  if (a.position !== b.position) return a.position - b.position;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

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

  /**
   * DD-22 — the ONE actionable question the D-07 denial path may ask
   * beyond the identical `null` `getOwnActiveEnrolment` returns for every
   * other denial cause. Returns an order/receipt href ONLY when an
   * enrolment with this id exists, belongs to `actor.userId`, AND is
   * currently `PENDING_PAYMENT`; `null` in every other case — including a
   * stranger's enrolment id, which must resolve identically to "does not
   * exist" (T-09-01's denial parity, applied here a second time so this
   * narrow extra lookup cannot become its own IDOR).
   */
  async function getOwnPendingEnrolmentOrderHref(
    actor: Actor,
    enrolmentId: string,
  ): Promise<string | null> {
    const enrolment = await store.enrolment.findUnique({ where: { id: enrolmentId } });
    if (!enrolment || enrolment.userId !== actor.userId || enrolment.status !== "PENDING_PAYMENT") {
      return null;
    }
    if (!enrolment.orderId || !store.order) return null;

    const order = await store.order.findUnique({ where: { id: enrolment.orderId } });
    if (!order) return null;

    return `/orders/${order.reference}`;
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

  /**
   * Loads one `LearnerCourseEntry` per course the pin resolves — a
   * standalone course-cohort resolves exactly one; a programme-cohort
   * resolves its `CohortCourse` rows in `position` order. Pin precedence
   * (documented once, here, since both this function and
   * `loadPinnedCompletionRuleSource` rely on it): for a member course
   * inside a programme cohort, `CohortCourse.coursePublicationId` wins;
   * otherwise `Cohort.coursePublicationId`. Any unresolved pin — the
   * cohort itself, or any one member course — makes the WHOLE result
   * `{ kind: "unpinned" }`; an authoring anomaly is never partially masked.
   */
  async function loadLearnerCourseStructure(
    enrolment: OwnEnrolmentSnapshot,
  ): Promise<LearnerCourseStructure> {
    const cohort = await store.cohort.findUnique({ where: { id: enrolment.cohortId } });
    if (!cohort) return { kind: "unpinned" };

    if (cohort.courseId) {
      const entry = await loadCourseEntryFromPin(cohort.courseId, cohort.coursePublicationId);
      if (!entry) return { kind: "unpinned" };
      return { kind: "structure", courses: [entry] };
    }

    if (cohort.programmeId) {
      const members = (await store.cohortCourse.findMany({ where: { cohortId: cohort.id } }))
        .slice()
        .sort((a, b) => a.position - b.position);
      if (members.length === 0) return { kind: "unpinned" };

      const entries: LearnerCourseEntry[] = [];
      for (const member of members) {
        const pinId = member.coursePublicationId ?? cohort.coursePublicationId;
        const entry = await loadCourseEntryFromPin(member.courseId, pinId);
        if (!entry) return { kind: "unpinned" };
        entries.push(entry);
      }
      return { kind: "structure", courses: entries };
    }

    return { kind: "unpinned" };
  }

  /**
   * Loads the frozen obligation tree for exactly one course, from exactly
   * one pin, driving the walk from the PINNED payload (not the live tree)
   * so a live lesson absent from the pin is excluded by construction, and
   * `required`/`position` always win from the pin (DD-11). Titles, `type`,
   * `allowManualComplete` and `withdrawnAt` come from the live rows — a
   * pinned lesson since withdrawn still renders, matching
   * `LessonContent`'s existing withdrawn-lesson banner behaviour.
   */
  async function loadCourseEntryFromPin(
    courseId: string,
    publicationId: string | null,
  ): Promise<LearnerCourseEntry | null> {
    if (!publicationId) return null;

    const publicationRow = await store.coursePublication.findUnique({
      where: { id: publicationId },
    });
    if (!publicationRow || !isCourseObligationPayload(publicationRow.payload)) return null;
    const payload = publicationRow.payload;

    const course = await store.course.findUnique({ where: { id: courseId } });
    if (!course) return null;

    const liveModules = await store.module.findMany({ where: { courseId } });
    const liveModuleById = new Map(liveModules.map((m) => [m.id, m]));

    const moduleIds = liveModules.map((m) => m.id);
    const liveLessons = moduleIds.length
      ? await store.lesson.findMany({ where: { moduleId: { in: moduleIds } } })
      : [];
    const liveLessonById = new Map(liveLessons.map((l) => [l.id, l]));

    const modules: LearnerCourseModule[] = payload.modules
      .slice()
      .sort(byPayloadPositionThenId)
      .map((pinnedModule) => {
        const liveModule = liveModuleById.get(pinnedModule.id);
        const lessons: LearnerCourseLesson[] = pinnedModule.lessons
          .slice()
          .sort(byPayloadPositionThenId)
          .map((pinnedLesson) => {
            const liveLesson = liveLessonById.get(pinnedLesson.id);
            return {
              id: pinnedLesson.id,
              title: liveLesson?.title ?? "",
              type: liveLesson?.type ?? pinnedLesson.type,
              position: pinnedLesson.position,
              required: pinnedLesson.required,
              allowManualComplete: liveLesson?.allowManualComplete ?? false,
              withdrawnAt: liveLesson?.withdrawnAt ?? null,
            };
          });
        return {
          id: pinnedModule.id,
          title: liveModule?.title ?? "",
          position: pinnedModule.position,
          lessons,
        };
      });

    return { courseId, courseTitle: course.title, modules };
  }

  /**
   * Resolves the completion-rule source for one scope evaluation.
   * `Cohort.courseId` set (a standalone course-cohort) => COURSE scope,
   * from that course's own pin. `Cohort.programmeId` set (a
   * programme-cohort) => PROGRAMME scope, from `Cohort.programmePublicationId`
   * — D-10's rule governs the WHOLE programme, never one member course, so
   * `courseId` there is used only as an ownership guard (the caller must be
   * asking about a course that is actually a member of this programme),
   * never to pick a per-course pin. `null` when no pin exists.
   */
  async function loadPinnedCompletionRuleSource(
    enrolment: OwnEnrolmentSnapshot,
    courseId: string,
  ): Promise<PinnedCompletionRuleSource | null> {
    const cohort = await store.cohort.findUnique({ where: { id: enrolment.cohortId } });
    if (!cohort) return null;

    if (cohort.courseId) {
      if (cohort.courseId !== courseId || !cohort.coursePublicationId) return null;
      const pub = await store.coursePublication.findUnique({
        where: { id: cohort.coursePublicationId },
      });
      if (!pub || !isCourseObligationPayload(pub.payload)) return null;
      return { json: pub.payload, ruleVersion: pub.payload.completionRuleVersion };
    }

    if (cohort.programmeId) {
      const members = await store.cohortCourse.findMany({ where: { cohortId: cohort.id } });
      const isMember = members.some((m) => m.courseId === courseId);
      if (!isMember || !cohort.programmePublicationId) return null;
      const pub = await store.programmePublication.findUnique({
        where: { id: cohort.programmePublicationId },
      });
      if (!pub || !isProgrammeObligationPayload(pub.payload)) return null;
      return { json: pub.payload, ruleVersion: pub.payload.completionRuleVersion };
    }

    return null;
  }

  /**
   * A learner's whole path with lock state and completion applied.
   * `null` for every denial cause `getOwnActiveEnrolment` returns `null`
   * for. Un-completing is not modelled as a distinct operation here at
   * all — sequencing is recomputed fresh from live `LessonProgress` on
   * every call, which IS D-16's lazy re-lock: nothing needs to walk a
   * downstream chain eagerly, because the next read simply recomputes it.
   */
  async function loadLearnerPath(actor: Actor, enrolmentId: string): Promise<LearnerPath | null> {
    const enrolment = await getOwnActiveEnrolment(actor, enrolmentId);
    if (!enrolment) return null;

    const structure = await loadLearnerCourseStructure(enrolment);
    const courses = structure.kind === "structure" ? structure.courses : [];

    const progressRows = await store.lessonProgress.findMany({ where: { enrolmentId: enrolment.id } });
    const progressByLesson = new Map(progressRows.map((p) => [p.lessonId, p]));
    const completedIds = new Set(progressRows.map((p) => p.lessonId));

    // D-05 extended across a programme cohort (see COURSE_POSITION_STRIDE /
    // MODULE_POSITION_STRIDE): flatten ALL lessons of ALL member courses,
    // course-position then module-position then lesson-position, before
    // handing to the pure evaluator — one global path, not one per course.
    const flatLessons: SequencingLesson[] = [];
    courses.forEach((courseEntry, courseIndex) => {
      courseEntry.modules.forEach((mod, moduleIndex) => {
        for (const lesson of mod.lessons) {
          flatLessons.push({
            id: lesson.id,
            title: lesson.title,
            required: lesson.required,
            position:
              courseIndex * COURSE_POSITION_STRIDE +
              moduleIndex * MODULE_POSITION_STRIDE +
              lesson.position,
            moduleId: mod.id,
            withdrawnAt: lesson.withdrawnAt,
          });
        }
      });
    });

    const sequencing = evaluateLessonSequencing(flatLessons, completedIds);
    const sequencingByLesson = new Map(sequencing.map((s) => [s.lessonId, s]));

    const decoratedCourses: DecoratedCourseEntry[] = courses.map((courseEntry) => ({
      courseId: courseEntry.courseId,
      courseTitle: courseEntry.courseTitle,
      modules: courseEntry.modules.map((mod) => ({
        id: mod.id,
        title: mod.title,
        position: mod.position,
        lessons: mod.lessons.map((lesson) => {
          const seq = sequencingByLesson.get(lesson.id);
          const progressRow = progressByLesson.get(lesson.id);
          return {
            ...lesson,
            // T-09-13 — an unevaluated (e.g. withdrawn) lesson defaults to
            // locked, never open by default.
            locked: seq?.locked ?? true,
            blockingLessonTitle: seq?.blockingLessonTitle ?? null,
            completed: !!progressRow,
            completedSource: progressRow?.source ?? null,
            completedAt: progressRow?.completedAt ?? null,
          };
        }),
      })),
    }));

    return { enrolment, courses: decoratedCourses, progress: completedIds, sequencing };
  }

  /**
   * The single server-side gate LRN-02 requires — the lesson-reading page
   * and every progress-write path MUST call this before reading content or
   * writing a row, because a UI lock is not a gate (T-09-02). A refusal is
   * a discriminated reason, never a thrown error, so a caller can render
   * the specific denial: `"not-found"` for an unknown/cross-course lesson
   * id, `"access-window-closed"` when D-03's window is `readOnly` (closed
   * or not yet started) — checked BEFORE the lock, so a closed window
   * refuses even an otherwise-unlocked lesson — and `"locked"` otherwise.
   */
  function assertLessonOpenable(path: LearnerPath, lessonId: string): LessonOpenResult {
    const lesson = findDecoratedLesson(path, lessonId);
    if (!lesson) return { ok: false, reason: "not-found" };

    if (path.enrolment.accessWindow.readOnly) {
      return { ok: false, reason: "access-window-closed" };
    }

    if (lesson.locked) return { ok: false, reason: "locked" };

    return { ok: true, lesson };
  }

  return {
    getOwnActiveEnrolment,
    getOwnPendingEnrolmentOrderHref,
    listOwnActiveEnrolments,
    hasActiveEnrolmentCoveringCourse,
    loadLearnerCourseStructure,
    loadPinnedCompletionRuleSource,
    loadLearnerPath,
    assertLessonOpenable,
  };
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
export const getOwnPendingEnrolmentOrderHref = built.getOwnPendingEnrolmentOrderHref;
export const listOwnActiveEnrolments = built.listOwnActiveEnrolments;
export const hasActiveEnrolmentCoveringCourse = built.hasActiveEnrolmentCoveringCourse;
export const loadLearnerCourseStructure = built.loadLearnerCourseStructure;
export const loadPinnedCompletionRuleSource = built.loadPinnedCompletionRuleSource;
export const loadLearnerPath = built.loadLearnerPath;
export const assertLessonOpenable = built.assertLessonOpenable;
