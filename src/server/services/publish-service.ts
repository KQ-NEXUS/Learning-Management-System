/**
 * The operation the resource-service factory does not have: publish.
 *
 * `createResourceService` stops at `archive`. Publish is new surface, and
 * D-04 gives a Course and a Programme identical semantics — so the shared
 * `createPublishOperation` below is written once and `publishCourse` /
 * `publishProgramme` are derived from it. Writing it twice would be writing
 * the divergence twice.
 *
 * Three prohibitions, each load-bearing:
 *
 *  1. No boolean mass-migration flag. D-06 is per-Cohort, unticked by
 *     default, with a mandatory reason. A "tick them all" boolean is exactly
 *     the silent requirement change CAT-05 exists to prevent — so the only
 *     parameter is `migrateCohortIds: string[]`, default `[]`.
 *
 *  2. `publishCourse` must never write `publiclyListed`, and the listing
 *     switch (`setPublicListing`) must never write `status`. Two permissions,
 *     two business acts (D-08 / D-09): content publish is `courses.publish`,
 *     public listing is `programmes.publish`.
 *
 *  3. No update path to a publication row. `CoursePublication` /
 *     `ProgrammePublication` are insert-only. If the payload is wrong,
 *     publish again — a new row, a new version. A retroactive edit to a
 *     published version is an invisible change to what enrolled learners owe
 *     (T-04-31).
 *
 * The whole publish runs inside one `$transaction`: claim `updatedAt` with a
 * conditional `updateMany` (D-22, sharing `StaleOrderError` with the reorder
 * service), compute the next version from `max(version)` under the same
 * transaction, insert the publication row, update the parent's
 * status/version fields, repoint the pins for `migrateCohortIds` only, and
 * audit.
 */

import { prisma } from "@/server/db";
import { withPermission as liveWithPermission } from "@/server/permissions";
import type { Permission } from "@/server/permissions/catalogue";
import type { ResourceScope } from "@/server/permissions/scope";
import type { createWithPermission } from "@/server/permissions/with-permission";
import { recordAudit } from "@/server/services/audit-service";
import type { ResourceAuditEntry } from "@/server/services/resource-service";
import { StaleOrderError } from "@/server/services/reorder-service";
import {
  buildCourseObligationTree,
  buildProgrammeObligationTree,
  diffObligationTrees,
  hasUnpublishedObligationChanges,
  OBLIGATION_PAYLOAD_SCHEMA,
  type CourseObligationPayload,
  type ProgrammeObligationPayload,
} from "@/server/services/publication";
import {
  blockingFailures,
  evaluateCourseReadiness,
  evaluateProgrammeReadiness,
  type ReadinessItem,
} from "@/server/services/readiness-service";
import {
  assertNoRunningCohorts as liveAssertNoRunningCohorts,
  blockingCohorts as liveBlockingCohorts,
  type BlockingCohort,
  type CatalogueTarget,
} from "@/server/services/catalogue-guards";

type WithPermission = ReturnType<typeof createWithPermission>;
type Audit = (entry: ResourceAuditEntry) => Promise<void>;

export type PublishKind = "Course" | "Programme";

// ---------------------------------------------------------------------------
// Errors — each a typed refusal the calling Server Action turns into a
// specific message rather than a raw stack trace.
// ---------------------------------------------------------------------------

export class PublishTargetNotFoundError extends Error {
  constructor(message = "That record no longer exists.") {
    super(message);
    this.name = "PublishTargetNotFoundError";
  }
}

/** A publish or a listing was refused because a blocking readiness item is
 * still FAIL. Carries the failing items so the UI can list them. */
export class ReadinessRefusedError extends Error {
  readonly failures: ReadinessItem[];
  constructor(failures: ReadinessItem[]) {
    super(
      `Not ready: ${failures.map((item) => item.label).join(", ")}.`,
    );
    this.name = "ReadinessRefusedError";
    this.failures = failures;
  }
}

/** Same shape as `ReadinessRefusedError`, raised specifically by
 * `setPublicListing` so the listing dialog can distinguish the two paths. */
export class ListingNotReadyError extends Error {
  readonly failures: ReadinessItem[];
  constructor(failures: ReadinessItem[]) {
    super(
      `This cannot be listed publicly yet: ${failures.map((item) => item.label).join(", ")}.`,
    );
    this.name = "ListingNotReadyError";
    this.failures = failures;
  }
}

export class ReasonRequiredError extends Error {
  constructor(message = "A reason is required for this action.") {
    super(message);
    this.name = "ReasonRequiredError";
  }
}

/** A cohort id was named for migration that is not among the running
 * Cohorts this publish actually affects — a forged migration list (T-04-30). */
export class UnknownMigrationTargetError extends Error {
  constructor(cohortId: string) {
    super(`Cohort ${cohortId} is not a running Cohort affected by this publish.`);
    this.name = "UnknownMigrationTargetError";
  }
}

// ---------------------------------------------------------------------------
// Aggregates — everything the payload builder and the readiness evaluator
// need, loaded in one query. Structurally satisfies both
// `ObligationCourseInput` + `ReadinessCourseInput` (Course) and their
// Programme equivalents, without importing either.
// ---------------------------------------------------------------------------

export type CoursePublishAggregate = {
  id: string;
  updatedAt: Date;
  status: string;
  contentVersion: number;
  title: string | null;
  summary: string | null;
  outcomes: string | null;
  durationHours: number | null;
  prerequisites: string | null;
  publiclyListed: boolean;
  publiclyListedAt: Date | null;
  slugLockedAt: Date | null;
  completionRule: unknown;
  completionRuleVersion: number;
  upcomingCohortCount: number;
  modules: Array<{
    id: string;
    position: number;
    withdrawnAt: Date | string | null;
    lessons: Array<{
      id: string;
      position: number;
      required: boolean;
      type: string;
      assessmentId: string | null;
      withdrawnAt: Date | string | null;
    }>;
  }>;
};

export type ProgrammePublishAggregate = {
  id: string;
  updatedAt: Date;
  status: string;
  contentVersion: number;
  title: string | null;
  summary: string | null;
  outcomes: string | null;
  audience: string | null;
  publiclyListed: boolean;
  publiclyListedAt: Date | null;
  slugLockedAt: Date | null;
  sequential: boolean;
  completionRule: unknown;
  completionRuleVersion: number;
  courses: Array<{ courseId: string; position: number }>;
};

export type PublicationRecord = {
  id: string;
  version: number;
  payload: unknown;
  publishedAt: Date;
  publishedById: string;
};

// ---------------------------------------------------------------------------
// The transaction client this service needs. Injected (not a hard Prisma
// import in the call path) so the unit test can drive it with an in-memory
// fake and the integration test with a real Postgres.
// ---------------------------------------------------------------------------

type ParentUpdateDelegate = {
  updateMany(args: {
    where: { id: string; updatedAt: Date };
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
};

type PublicationCreateDelegate = {
  findFirst(args: {
    where: Record<string, unknown>;
    orderBy: { version: "desc" };
    select: { version: true };
  }): Promise<{ version: number } | null>;
  create(args: { data: Record<string, unknown> }): Promise<{ id: string; version: number }>;
};

export type PublishTx = {
  course: ParentUpdateDelegate;
  programme: ParentUpdateDelegate;
  coursePublication: PublicationCreateDelegate;
  programmePublication: PublicationCreateDelegate;
  cohort: {
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  cohortCourse: {
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
};

export type PublishDb = {
  $transaction: <R>(fn: (tx: PublishTx) => Promise<R>) => Promise<R>;
};

// ---------------------------------------------------------------------------
// Service dependencies
// ---------------------------------------------------------------------------

export type PublishServiceDeps = {
  db: PublishDb;
  loadCourse: (id: string) => Promise<CoursePublishAggregate | null>;
  loadProgramme: (id: string) => Promise<ProgrammePublishAggregate | null>;
  updateCourse: (id: string, data: Record<string, unknown>) => Promise<unknown>;
  updateProgramme: (id: string, data: Record<string, unknown>) => Promise<unknown>;
  latestCoursePublication: (id: string) => Promise<PublicationRecord | null>;
  latestProgrammePublication: (id: string) => Promise<PublicationRecord | null>;
  blockingCohorts: (target: CatalogueTarget) => Promise<BlockingCohort[]>;
  assertNoRunningCohorts: (target: CatalogueTarget) => Promise<void>;
  removeCourseFromAllProgrammes: (courseId: string) => Promise<{ programmeTitles: string[] }>;
  withPermission: WithPermission;
  audit: Audit;
  now?: () => Date;
};

type PublishInput = {
  id: string;
  expectedUpdatedAt: Date;
  reason?: string | null;
  migrateCohortIds?: string[];
};

type CommitArgs<TPayload> = {
  id: string;
  payload: TPayload;
  expectedUpdatedAt: Date;
  actorId: string;
  reason: string | null;
  migrateCohortIds: string[];
};

type CommitResult = { publicationId: string; version: number; migratedCohortIds: string[] };

const courseScope = (id: string): ResourceScope => ({ courseIds: [id] });
const programmeScope = (id: string): ResourceScope => ({ programmeId: id });

function requireReason(reason: string | null | undefined): string {
  const trimmed = reason?.trim();
  if (!trimmed) throw new ReasonRequiredError();
  return trimmed;
}

export function createPublishService(deps: PublishServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const { db, withPermission, audit } = deps;

  // -------------------------------------------------------------------------
  // Shared publish operation (D-04)
  // -------------------------------------------------------------------------

  type OperationConfig<TAgg, TPayload> = {
    kind: PublishKind;
    permission: Permission;
    toScope: (id: string) => ResourceScope;
    load: (id: string) => Promise<TAgg | null>;
    buildPayload: (agg: TAgg) => TPayload;
    evaluate: (agg: TAgg) => ReadinessItem[];
    affected: (id: string) => Promise<BlockingCohort[]>;
    commit: (args: CommitArgs<TPayload>) => Promise<CommitResult>;
  };

  function createPublishOperation<TAgg, TPayload>(cfg: OperationConfig<TAgg, TPayload>) {
    const slug = cfg.kind.toLowerCase();

    return withPermission<PublishInput>(cfg.permission, (input) => cfg.toScope(input.id))(
      async (input, ctx) => {
        const agg = await cfg.load(input.id);
        if (!agg) throw new PublishTargetNotFoundError(`${cfg.kind} ${input.id} not found.`);

        const migrateCohortIds = input.migrateCohortIds ?? [];
        const reason =
          input.reason && input.reason.trim() !== "" ? input.reason.trim() : null;

        // D-06: any ticked Cohort requires a reason.
        if (migrateCohortIds.length > 0 && reason === null) {
          throw new ReasonRequiredError(
            "Migrating a running Cohort to the new version requires a reason (D-06).",
          );
        }

        // D-25: hard blocks stop a publish (the four core content blockers).
        const failures = blockingFailures(cfg.evaluate(agg));
        if (failures.length > 0) throw new ReadinessRefusedError(failures);

        // T-04-30: every ticked Cohort must actually be a running Cohort
        // affected by this publish — never trust the list to be honest.
        if (migrateCohortIds.length > 0) {
          const affectedIds = new Set((await cfg.affected(input.id)).map((c) => c.id));
          for (const cohortId of migrateCohortIds) {
            if (!affectedIds.has(cohortId)) {
              throw new UnknownMigrationTargetError(cohortId);
            }
          }
        }

        const payload = cfg.buildPayload(agg);

        const result = await cfg.commit({
          id: input.id,
          payload,
          expectedUpdatedAt: input.expectedUpdatedAt,
          actorId: ctx.actor.userId,
          reason,
          migrateCohortIds,
        });

        await audit({
          action: `${slug}.published`,
          targetType: cfg.kind,
          targetId: input.id,
          actorId: ctx.actor.userId,
          outcome: "SUCCESS",
          reason,
          before: null,
          after: { version: result.version, publicationId: result.publicationId },
        });

        if (result.migratedCohortIds.length > 0) {
          await audit({
            action: `${slug}.cohorts_migrated`,
            targetType: cfg.kind,
            targetId: input.id,
            actorId: ctx.actor.userId,
            outcome: "SUCCESS",
            reason,
            before: null,
            after: { cohortIds: result.migratedCohortIds, toVersion: result.version },
          });
        }

        return {
          publicationId: result.publicationId,
          version: result.version,
          migratedCohortIds: result.migratedCohortIds,
        };
      },
    );
  }

  async function courseCommit(
    args: CommitArgs<CourseObligationPayload>,
  ): Promise<CommitResult> {
    return db.$transaction(async (tx) => {
      const claimed = await tx.course.updateMany({
        where: { id: args.id, updatedAt: args.expectedUpdatedAt },
        data: { updatedAt: now() },
      });
      if (claimed.count === 0) throw new StaleOrderError();

      const latest = await tx.coursePublication.findFirst({
        where: { courseId: args.id },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      const version = (latest?.version ?? 0) + 1;

      const publication = await tx.coursePublication.create({
        data: {
          courseId: args.id,
          version,
          payload: args.payload as unknown as object,
          payloadSchema: OBLIGATION_PAYLOAD_SCHEMA,
          publishedById: args.actorId,
          reason: args.reason,
        },
      });

      // Parent status/version fields — NOT publiclyListed (D-08).
      await tx.course.update({
        where: { id: args.id },
        data: {
          status: "PUBLISHED",
          publishedAt: now(),
          publishedById: args.actorId,
          contentVersion: version,
        },
      });

      const migratedCohortIds = await repointCoursePins(
        tx,
        args.id,
        publication.id,
        args.migrateCohortIds,
      );

      return { publicationId: publication.id, version, migratedCohortIds };
    });
  }

  async function programmeCommit(
    args: CommitArgs<ProgrammeObligationPayload>,
  ): Promise<CommitResult> {
    return db.$transaction(async (tx) => {
      const claimed = await tx.programme.updateMany({
        where: { id: args.id, updatedAt: args.expectedUpdatedAt },
        data: { updatedAt: now() },
      });
      if (claimed.count === 0) throw new StaleOrderError();

      const latest = await tx.programmePublication.findFirst({
        where: { programmeId: args.id },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      const version = (latest?.version ?? 0) + 1;

      const publication = await tx.programmePublication.create({
        data: {
          programmeId: args.id,
          version,
          payload: args.payload as unknown as object,
          payloadSchema: OBLIGATION_PAYLOAD_SCHEMA,
          publishedById: args.actorId,
          reason: args.reason,
        },
      });

      // Identical field set to courseCommit (plan 04-02 added contentVersion
      // and publishedById to Programme so this really is the same write).
      await tx.programme.update({
        where: { id: args.id },
        data: {
          status: "PUBLISHED",
          publishedAt: now(),
          publishedById: args.actorId,
          contentVersion: version,
        },
      });

      const migratedCohortIds: string[] = [];
      for (const cohortId of args.migrateCohortIds) {
        const moved = await tx.cohort.updateMany({
          where: { id: cohortId, programmeId: args.id },
          data: { programmePublicationId: publication.id },
        });
        if (moved.count > 0) migratedCohortIds.push(cohortId);
      }

      return { publicationId: publication.id, version, migratedCohortIds };
    });
  }

  /**
   * Repoints the pin for each ticked Cohort — and ONLY those (D-06). A
   * standalone-Course Cohort pins on `Cohort.coursePublicationId`; a Course
   * delivered inside a Programme Cohort pins on `CohortCourse`. Unticked
   * Cohorts are never touched: the default is "do not touch".
   */
  async function repointCoursePins(
    tx: PublishTx,
    courseId: string,
    publicationId: string,
    migrateCohortIds: string[],
  ): Promise<string[]> {
    const migrated: string[] = [];
    for (const cohortId of migrateCohortIds) {
      const direct = await tx.cohort.updateMany({
        where: { id: cohortId, courseId },
        data: { coursePublicationId: publicationId },
      });
      const viaProgramme = await tx.cohortCourse.updateMany({
        where: { cohortId, courseId },
        data: { coursePublicationId: publicationId },
      });
      if (direct.count > 0 || viaProgramme.count > 0) migrated.push(cohortId);
    }
    return migrated;
  }

  const publishCourse = createPublishOperation<CoursePublishAggregate, CourseObligationPayload>({
    kind: "Course",
    permission: "courses.publish",
    toScope: courseScope,
    load: deps.loadCourse,
    buildPayload: buildCourseObligationTree,
    evaluate: evaluateCourseReadiness,
    affected: (id) => deps.blockingCohorts({ courseId: id }),
    commit: courseCommit,
  });

  const publishProgramme = createPublishOperation<
    ProgrammePublishAggregate,
    ProgrammeObligationPayload
  >({
    kind: "Programme",
    permission: "programmes.publish",
    toScope: programmeScope,
    load: deps.loadProgramme,
    buildPayload: buildProgrammeObligationTree,
    evaluate: evaluateProgrammeReadiness,
    affected: (id) => deps.blockingCohorts({ programmeId: id }),
    commit: programmeCommit,
  });

  // -------------------------------------------------------------------------
  // Unpublish — content only, gated courses.publish, refused mid-cohort (D-12)
  // -------------------------------------------------------------------------

  const unpublishContent = withPermission<{ kind: PublishKind; id: string; reason: string }>(
    "courses.publish",
    (input) => (input.kind === "Course" ? courseScope(input.id) : programmeScope(input.id)),
  )(async (input, ctx) => {
    const reason = requireReason(input.reason);

    const agg =
      input.kind === "Course"
        ? await deps.loadCourse(input.id)
        : await deps.loadProgramme(input.id);
    if (!agg) throw new PublishTargetNotFoundError();

    // D-12: a running Cohort blocks unpublish, and the refusal names it.
    await deps.assertNoRunningCohorts(
      input.kind === "Course" ? { courseId: input.id } : { programmeId: input.id },
    );

    const update = input.kind === "Course" ? deps.updateCourse : deps.updateProgramme;
    await update(input.id, { status: "DRAFT" });

    await audit({
      action: `${input.kind.toLowerCase()}.unpublished`,
      targetType: input.kind,
      targetId: input.id,
      actorId: ctx.actor.userId,
      outcome: "SUCCESS",
      reason,
      before: { status: agg.status },
      after: { status: "DRAFT" },
    });
  });

  // -------------------------------------------------------------------------
  // D-05 warning-banner / publish-dialog helpers (consumed by plan 04-12)
  // -------------------------------------------------------------------------

  const getLatestCoursePublication = withPermission<string>(
    "courses.view",
    (id) => courseScope(id),
  )(async (id) => deps.latestCoursePublication(id));

  const getLatestProgrammePublication = withPermission<string>(
    "programmes.view",
    (id) => programmeScope(id),
  )(async (id) => deps.latestProgrammePublication(id));

  function getLatestPublication(kind: PublishKind, id: string) {
    return kind === "Course"
      ? getLatestCoursePublication(id)
      : getLatestProgrammePublication(id);
  }

  const getUnpublishedChangeSummary = withPermission<string>(
    "courses.view",
    (id) => courseScope(id),
  )(async (courseId): Promise<{ hasChanges: boolean; changes: string[] }> => {
    const agg = await deps.loadCourse(courseId);
    if (!agg) return { hasChanges: false, changes: [] };

    const latest = await deps.latestCoursePublication(courseId);
    const latestPayload = (latest?.payload ?? null) as CourseObligationPayload | null;

    const hasChanges = hasUnpublishedObligationChanges(agg, latestPayload);
    const changes = latestPayload
      ? diffObligationTrees(buildCourseObligationTree(agg), latestPayload)
      : [];

    return { hasChanges, changes };
  });

  return {
    publishCourse,
    publishProgramme,
    unpublishContent,
    getLatestPublication,
    getUnpublishedChangeSummary,
  };
}

// ---------------------------------------------------------------------------
// Production binding
// ---------------------------------------------------------------------------

async function loadCourseAggregate(id: string): Promise<CoursePublishAggregate | null> {
  const course = await prisma.course.findUnique({
    where: { id },
    select: {
      id: true,
      updatedAt: true,
      status: true,
      contentVersion: true,
      title: true,
      summary: true,
      outcomes: true,
      durationHours: true,
      prerequisites: true,
      publiclyListed: true,
      publiclyListedAt: true,
      slugLockedAt: true,
      completionRule: true,
      completionRuleVersion: true,
      modules: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          position: true,
          withdrawnAt: true,
          lessons: {
            orderBy: { position: "asc" },
            select: {
              id: true,
              position: true,
              required: true,
              type: true,
              assessmentId: true,
              withdrawnAt: true,
            },
          },
        },
      },
    },
  });
  if (!course) return null;

  const upcomingCohortCount = await prisma.cohort.count({
    where: { courseId: id, startsAt: { gte: new Date() } },
  });

  return {
    ...course,
    completionRule: course.completionRule ?? null,
    completionRuleVersion: course.completionRuleVersion,
    upcomingCohortCount,
  };
}

async function loadProgrammeAggregate(id: string): Promise<ProgrammePublishAggregate | null> {
  const programme = await prisma.programme.findUnique({
    where: { id },
    select: {
      id: true,
      updatedAt: true,
      status: true,
      contentVersion: true,
      title: true,
      summary: true,
      outcomes: true,
      audience: true,
      publiclyListed: true,
      publiclyListedAt: true,
      slugLockedAt: true,
      sequential: true,
      completionRule: true,
      completionRuleVersion: true,
      courses: {
        orderBy: { position: "asc" },
        select: { courseId: true, position: true },
      },
    },
  });
  if (!programme) return null;

  return { ...programme, completionRule: programme.completionRule ?? null };
}

async function latestCoursePublicationRow(id: string): Promise<PublicationRecord | null> {
  const row = await prisma.coursePublication.findFirst({
    where: { courseId: id },
    orderBy: { version: "desc" },
    select: { id: true, version: true, payload: true, publishedAt: true, publishedById: true },
  });
  return row as PublicationRecord | null;
}

async function latestProgrammePublicationRow(id: string): Promise<PublicationRecord | null> {
  const row = await prisma.programmePublication.findFirst({
    where: { programmeId: id },
    orderBy: { version: "desc" },
    select: { id: true, version: true, payload: true, publishedAt: true, publishedById: true },
  });
  return row as PublicationRecord | null;
}

async function removeCourseFromAllProgrammes(
  courseId: string,
): Promise<{ programmeTitles: string[] }> {
  const memberships = await prisma.programmeCourse.findMany({
    where: { courseId },
    select: { id: true, programmeId: true, programme: { select: { title: true } } },
  });
  if (memberships.length === 0) return { programmeTitles: [] };

  const programmeIds = [...new Set(memberships.map((m) => m.programmeId))];

  await prisma.$transaction(async (tx) => {
    await tx.programmeCourse.deleteMany({ where: { courseId } });
    // Renumber the survivors of each affected Programme's DRAFT ordering
    // to a contiguous 0..n-1. Ascending order never collides: every new
    // position is <= the old one and each already-processed survivor holds
    // a strictly smaller value. Published ProgrammePublication.payload rows
    // are immutable and untouched (D-14).
    for (const programmeId of programmeIds) {
      const survivors = await tx.programmeCourse.findMany({
        where: { programmeId },
        orderBy: { position: "asc" },
        select: { id: true, position: true },
      });
      for (let i = 0; i < survivors.length; i++) {
        if (survivors[i].position !== i) {
          await tx.programmeCourse.update({
            where: { id: survivors[i].id },
            data: { position: i },
          });
        }
      }
    }
  });

  return {
    programmeTitles: [...new Set(memberships.map((m) => m.programme.title))],
  };
}

const productionDb: PublishDb = {
  $transaction: (fn) => prisma.$transaction((tx) => fn(tx as unknown as PublishTx)),
};

const built = createPublishService({
  db: productionDb,
  loadCourse: loadCourseAggregate,
  loadProgramme: loadProgrammeAggregate,
  updateCourse: (id, data) => prisma.course.update({ where: { id }, data }),
  updateProgramme: (id, data) => prisma.programme.update({ where: { id }, data }),
  latestCoursePublication: latestCoursePublicationRow,
  latestProgrammePublication: latestProgrammePublicationRow,
  blockingCohorts: liveBlockingCohorts,
  assertNoRunningCohorts: liveAssertNoRunningCohorts,
  removeCourseFromAllProgrammes,
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
});

export const publishCourse = built.publishCourse;
export const publishProgramme = built.publishProgramme;
export const unpublishContent = built.unpublishContent;
export const getLatestPublication = built.getLatestPublication;
export const getUnpublishedChangeSummary = built.getUnpublishedChangeSummary;
