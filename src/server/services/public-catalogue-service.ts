/**
 * The ONLY read path for the anonymous public catalogue.
 *
 * This service is deliberately NOT wrapped in the permission choke point: its audience is
 * anonymous, there is no session and no actor to authorize. That means the
 * `where` clause below is the entire access control for these routes — so it is
 * written exactly once, as `PUBLIC_VISIBILITY_WHERE`, and every query reuses it.
 * Never inline this filter into a page, and never add a fifth query that builds
 * its own: a future edit that fixes one `where` and misses the others is the
 * whole failure mode this shape prevents (T-04-67).
 *
 * Every query selects an EXPLICIT field list. A bare `findMany` on an anonymous
 * surface leaks the next column somebody adds to the model.
 */

import { prisma } from "@/server/db";
import { isPaystackRailEnabled, isStripeRailEnabled } from "@/server/payments/settlement-config";

/**
 * A record is public iff it is `publiclyListed` AND not `ARCHIVED`.
 *
 * - `publiclyListed: true` + `status: DRAFT` IS public — D-08's early-bookings
 *   case (taking bookings before the material is finished).
 * - `status: PUBLISHED` + `publiclyListed: false` is NOT public — private /
 *   corporate delivery.
 * - `ARCHIVED` is never public, whatever the listing flag says (CAT-08).
 */
export const PUBLIC_VISIBILITY_WHERE = {
  publiclyListed: true,
  status: { not: "ARCHIVED" as const },
} as const;

const COURSE_PUBLIC_SELECT = {
  slug: true,
  title: true,
  summary: true,
  outcomes: true,
  audience: true,
  prerequisites: true,
  durationHours: true,
  certificateEnabled: true,
} as const;

const PROGRAMME_PUBLIC_SELECT = {
  slug: true,
  title: true,
  summary: true,
  outcomes: true,
  audience: true,
  certificateEnabled: true,
} as const;

export type PublicCohort = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  enrolmentOpensAt: Date;
  enrolmentClosesAt: Date;
  deliveryMode: "SELF_PACED" | "INSTRUCTOR_LED" | "BLENDED";
  // D-06/D-08 — the two independent, nullable dual-currency rails this phase
  // adds. `null` means "this rail is not offered OR this deployment's
  // required school settlement account is absent for it (D-05, D-19)" —
  // the anonymous card never learns which. The legacy `priceMinor`/
  // `currency` pair is gone (07-11).
  priceNgnMinor: number | null;
  priceUsdMinor: number | null;
  // Derived (capacity - seatsTaken, floored at 0) — the raw seatsTaken/capacity
  // counters are internal operational data and are never present on this
  // anonymous payload (REG-01, 06-RESEARCH.md Pitfall 6).
  seatsAvailable: number;
};

/** A live module of a public course, by title only, with how many live lessons it holds. */
export type PublicCourseModule = { title: string; lessonCount: number };

/** What the catalogue list shows per course: the course plus its soonest bookable cohort. */
export type PublicCourseListing = Omit<PublicCourse, "upcomingCohorts" | "modules"> & {
  nextCohort: PublicCohort | null;
};

export type PublicCourse = {
  slug: string;
  title: string;
  summary: string | null;
  outcomes: string | null;
  audience: string | null;
  prerequisites: string | null;
  durationHours: number | null;
  certificateEnabled: boolean;
  modules: PublicCourseModule[];
  upcomingCohorts: PublicCohort[];
};

/** What the catalogue list shows per programme: the programme plus its soonest bookable cohort. */
export type PublicProgrammeListing = Omit<PublicProgramme, "upcomingCohorts" | "memberCourseTitles"> & {
  nextCohort: PublicCohort | null;
};

export type PublicProgramme = {
  slug: string;
  title: string;
  summary: string | null;
  outcomes: string | null;
  audience: string | null;
  certificateEnabled: boolean;
  memberCourseTitles: string[];
  upcomingCohorts: PublicCohort[];
};

type Finder = {
  findMany: (args: { where?: unknown; select?: unknown; orderBy?: unknown }) => Promise<unknown[]>;
  findFirst: (args: { where?: unknown; select?: unknown }) => Promise<unknown>;
};
type CohortFinder = { findMany: (args: { where?: unknown; select?: unknown; orderBy?: unknown }) => Promise<unknown[]> };

export type PublicCatalogueDeps = {
  courseDelegate: Finder;
  programmeDelegate: Finder;
  cohortDelegate: CohortFinder;
  now?: () => Date;
  /**
   * Whether this deployment's required school settlement account is present
   * for each rail (D-02/D-05) — the same presence check `cohort-service.ts`
   * injects into `evaluateCohortReadiness` (07-05), reused here so a rail
   * that is priced but has no usable settlement account is never offered to
   * an anonymous visitor as a selectable payment option (D-19). Defaults to
   * both rails enabled so every existing test/caller that omits this keeps
   * its current behaviour; the real binding at the bottom of this file wires
   * it to `settlement-config.ts`'s own presence checks.
   */
  enabledRails?: () => { ngn: boolean; usd: boolean };
};

export function createPublicCatalogueService(deps: PublicCatalogueDeps) {
  const now = deps.now ?? (() => new Date());
  const enabledRails = deps.enabledRails ?? (() => ({ ngn: true, usd: true }));

  async function upcomingCohorts(link: { courseId: string } | { programmeId: string }): Promise<PublicCohort[]> {
    const at = now();
    const rails = enabledRails();
    const rows = (await deps.cohortDelegate.findMany({
      where: { ...link, status: "PUBLISHED", startsAt: { gt: at } },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        enrolmentOpensAt: true,
        enrolmentClosesAt: true,
        deliveryMode: true,
        priceNgnMinor: true,
        priceUsdMinor: true,
        capacity: true,
        seatsTaken: true,
      },
      orderBy: { startsAt: "asc" },
    })) as Array<
      Omit<PublicCohort, "seatsAvailable"> & {
        status?: string;
        capacity: number;
        seatsTaken: number;
      }
    >;

    // A booking window is "open or future" — it has not already closed.
    return rows
      .filter(
        (row) =>
          new Date(row.startsAt) > at &&
          new Date(row.enrolmentClosesAt) >= at,
      )
      .map((row) => ({
        id: row.id,
        startsAt: new Date(row.startsAt),
        endsAt: new Date(row.endsAt),
        enrolmentOpensAt: new Date(row.enrolmentOpensAt),
        enrolmentClosesAt: new Date(row.enrolmentClosesAt),
        deliveryMode: row.deliveryMode,
        // D-05/D-19 — a priced rail this deployment has not enabled (no
        // settlement account configured) is nulled out here, at the source,
        // exactly like an unpriced rail. The card downstream (CohortCards)
        // never learns WHY a rail is absent — only that it is, which is the
        // "boolean-shaped fact, never a reason string" this phase requires.
        priceNgnMinor: rails.ngn ? row.priceNgnMinor : null,
        priceUsdMinor: rails.usd ? row.priceUsdMinor : null,
        seatsAvailable: Math.max(0, row.capacity - row.seatsTaken),
      }));
  }

  async function listPublicCourses(): Promise<PublicCourseListing[]> {
    const rows = (await deps.courseDelegate.findMany({
      where: PUBLIC_VISIBILITY_WHERE,
      select: { ...COURSE_PUBLIC_SELECT, id: true },
      orderBy: { title: "asc" },
    })) as Array<Omit<PublicCourseListing, "nextCohort"> & { id: string }>;
    return Promise.all(
      rows.map(async ({ id, ...rest }) => ({
        ...rest,
        nextCohort: (await upcomingCohorts({ courseId: id }))[0] ?? null,
      })),
    );
  }

  async function listPublicProgrammes(): Promise<PublicProgrammeListing[]> {
    const rows = (await deps.programmeDelegate.findMany({
      where: PUBLIC_VISIBILITY_WHERE,
      select: { ...PROGRAMME_PUBLIC_SELECT, id: true },
      orderBy: { title: "asc" },
    })) as Array<Omit<PublicProgrammeListing, "nextCohort"> & { id: string }>;
    return Promise.all(
      rows.map(async ({ id, ...rest }) => ({
        ...rest,
        nextCohort: (await upcomingCohorts({ programmeId: id }))[0] ?? null,
      })),
    );
  }

  async function getPublicCourseBySlug(slug: string): Promise<PublicCourse | null> {
    const row = (await deps.courseDelegate.findFirst({
      where: { slug, ...PUBLIC_VISIBILITY_WHERE },
      select: {
        ...COURSE_PUBLIC_SELECT,
        id: true,
        // Titles and lesson counts of LIVE modules only: withdrawn ones are soft-deleted.
        modules: {
          where: { withdrawnAt: null },
          orderBy: { position: "asc" },
          select: { title: true, lessons: { where: { withdrawnAt: null }, select: { id: true } } },
        },
      },
    })) as
      | (Omit<PublicCourse, "upcomingCohorts" | "modules"> & {
          id: string;
          modules?: Array<{ title: string; lessons: unknown[] }>;
        })
      | null;
    if (!row) return null;
    const { id, modules, ...rest } = row;
    return {
      ...rest,
      modules: (modules ?? []).map((m) => ({ title: m.title, lessonCount: m.lessons.length })),
      upcomingCohorts: await upcomingCohorts({ courseId: id }),
    };
  }

  async function getPublicProgrammeBySlug(slug: string): Promise<PublicProgramme | null> {
    const row = (await deps.programmeDelegate.findFirst({
      where: { slug, ...PUBLIC_VISIBILITY_WHERE },
      select: {
        ...PROGRAMME_PUBLIC_SELECT,
        id: true,
        courses: {
          orderBy: { position: "asc" },
          select: { position: true, course: { select: { title: true } } },
        },
      },
    })) as
      | (Omit<PublicProgramme, "upcomingCohorts" | "memberCourseTitles"> & {
          id: string;
          courses: Array<{ position: number; course: { title: string } }>;
        })
      | null;
    if (!row) return null;
    const { id, courses, ...rest } = row;
    return {
      ...rest,
      memberCourseTitles: [...courses]
        .sort((a, b) => a.position - b.position)
        .map((edge) => edge.course.title),
      upcomingCohorts: await upcomingCohorts({ programmeId: id }),
    };
  }

  return { listPublicCourses, listPublicProgrammes, getPublicCourseBySlug, getPublicProgrammeBySlug };
}

const built = createPublicCatalogueService({
  courseDelegate: prisma.course as unknown as Finder,
  programmeDelegate: prisma.programme as unknown as Finder,
  cohortDelegate: prisma.cohort as unknown as CohortFinder,
  enabledRails: () => ({ ngn: isPaystackRailEnabled(), usd: isStripeRailEnabled() }),
});

export const listPublicCourses = built.listPublicCourses;
export const listPublicProgrammes = built.listPublicProgrammes;
export const getPublicCourseBySlug = built.getPublicCourseBySlug;
export const getPublicProgrammeBySlug = built.getPublicProgrammeBySlug;
