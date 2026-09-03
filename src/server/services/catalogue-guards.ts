/**
 * Shared refusal guards for the two operations that can pull material out
 * from under a learner: unpublish (D-12) and archive (D-14).
 *
 * One principle, deliberately not two: a running Cohort blocks BOTH
 * unpublishing content and archiving a record, and the refusal names the
 * blocking Cohorts so staff can act on it. Making unpublish and archive
 * share `assertNoRunningCohorts` is the mechanism that keeps them the same
 * rule rather than two rules that drift apart.
 *
 * Programme membership is NOT in here. Archiving a Course that belongs to
 * Programmes is allowed — Courses are referenced, never owned (D-14, D-18) —
 * so that case warns (it names the Programmes) rather than blocks, and the
 * warning is produced by the archive operation itself, not refused here.
 *
 * "Running" means a Cohort whose `status` is `PUBLISHED` or `IN_PROGRESS`
 * AND whose date window currently contains now. `DRAFT`, `COMPLETED` and
 * `CANCELLED` never block, whatever their dates — a cancelled or finished
 * Cohort has no live obligations to protect, and a draft one is not yet a
 * commitment to anyone.
 */

import { prisma } from "@/server/db";

/** The field set D-06's publish dialog needs (cohort code, learner count,
 * end date) and the same list D-12's refusal message names. One query, two
 * consumers. */
export type BlockingCohort = {
  id: string;
  code: string;
  title: string;
  endsAt: Date;
  /** Enrolments on the Cohort, for the publish dialog's learner count. */
  enrolmentCount: number;
};

/** A Course or a Programme, named by id. Exactly one key is set. */
export type CatalogueTarget = { courseId: string } | { programmeId: string };

/**
 * Thrown by `assertNoRunningCohorts`. Carries the full blocking list so the
 * caller can render D-06's dialog rows, and its message names the cohort
 * `code`s because D-12 requires the control to name the blocking Cohorts.
 */
export class RunningCohortError extends Error {
  readonly cohorts: BlockingCohort[];

  constructor(cohorts: BlockingCohort[]) {
    const codes = cohorts.map((cohort) => cohort.code).join(", ");
    super(
      `This cannot be changed while these Cohorts are running: ${codes}. ` +
        `Wait until they finish, or switch off public listing to stop new sales without disrupting current learners.`,
    );
    this.name = "RunningCohortError";
    this.cohorts = cohorts;
  }
}

/**
 * Thrown by `assertSlugMutable`. A frozen slug IS the mechanism D-11 wants —
 * there is no redirect machinery and none is wanted. An administrator
 * override exists, takes a mandatory reason, and is audited by its caller as
 * `course.slug_overridden`.
 */
export class SlugFrozenError extends Error {
  constructor(
    message = "This slug is frozen because the record has been publicly listed. " +
      "Changing it would break bookmarked and indexed links. An administrator override with a reason is required.",
  ) {
    super(message);
    this.name = "SlugFrozenError";
  }
}

/** The subset of the Prisma `Cohort` delegate this module uses. Injected so
 * the guards stay unit-testable without a real Postgres. */
export type CohortGuardDelegate = {
  findMany(args: {
    where: Record<string, unknown>;
    select: {
      id: true;
      code: true;
      title: true;
      endsAt: true;
      _count: { select: { enrolments: true } };
    };
  }): Promise<
    Array<{
      id: string;
      code: string;
      title: string;
      endsAt: Date;
      _count: { enrolments: number };
    }>
  >;
};

export type CatalogueGuardsConfig = {
  cohort: CohortGuardDelegate;
  now?: () => Date;
};

/** Cohort statuses that count as "running". `DRAFT`, `COMPLETED` and
 * `CANCELLED` are deliberately absent — see the file header. */
const RUNNING_STATUSES = ["PUBLISHED", "IN_PROGRESS"] as const;

export function createCatalogueGuards(config: CatalogueGuardsConfig) {
  const now = config.now ?? (() => new Date());

  /**
   * Every Cohort currently running on this Course or Programme.
   *
   * For a Course, a Cohort is reached either directly (`Cohort.courseId`,
   * the standalone-Course shape) or through `CohortCourse` (a Course
   * delivered inside a Programme Cohort). For a Programme, only the direct
   * `Cohort.programmeId` link matters.
   *
   * Selects EXACTLY `{ id, code, title, endsAt, _count.enrolments }` — the
   * field set the publish dialog (D-06) and the refusal message (D-12) both
   * consume.
   */
  async function blockingCohorts(target: CatalogueTarget): Promise<BlockingCohort[]> {
    const at = now();

    const reach =
      "courseId" in target
        ? {
            OR: [
              { courseId: target.courseId },
              { cohortCourses: { some: { courseId: target.courseId } } },
            ],
          }
        : { programmeId: target.programmeId };

    const rows = await config.cohort.findMany({
      where: {
        status: { in: [...RUNNING_STATUSES] },
        startsAt: { lte: at },
        endsAt: { gte: at },
        ...reach,
      },
      select: {
        id: true,
        code: true,
        title: true,
        endsAt: true,
        _count: { select: { enrolments: true } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      title: row.title,
      endsAt: row.endsAt,
      enrolmentCount: row._count.enrolments,
    }));
  }

  /**
   * Throws `RunningCohortError` (carrying the list, message naming the
   * codes) when any Cohort is running on the target. Shared verbatim by
   * unpublish (D-12) and archive (D-14).
   */
  async function assertNoRunningCohorts(target: CatalogueTarget): Promise<void> {
    const cohorts = await blockingCohorts(target);
    if (cohorts.length > 0) {
      throw new RunningCohortError(cohorts);
    }
  }

  return { blockingCohorts, assertNoRunningCohorts };
}

/**
 * D-11: a slug is editable while the record is unlisted and frozen the
 * moment it is first publicly listed (`slugLockedAt` is set). Pure — no
 * data access — so it can be called from a form validator and from the
 * listing action alike.
 *
 * The administrator override (`options.adminOverride`) bypasses the freeze
 * but REQUIRES a non-blank `options.reason`; the caller audits it as
 * `course.slug_overridden`.
 */
export function assertSlugMutable(
  record: { slugLockedAt: Date | null },
  options?: { adminOverride?: boolean; reason?: string | null },
): void {
  if (record.slugLockedAt == null) {
    return;
  }
  if (options?.adminOverride === true) {
    if (!options.reason || options.reason.trim() === "") {
      throw new SlugFrozenError(
        "An administrator slug override requires a reason.",
      );
    }
    return;
  }
  throw new SlugFrozenError();
}

const built = createCatalogueGuards({
  cohort: prisma.cohort as unknown as CohortGuardDelegate,
});

export const blockingCohorts = built.blockingCohorts;
export const assertNoRunningCohorts = built.assertNoRunningCohorts;
