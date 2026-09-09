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
  priceMinor: number;
  currency: string;
  // Derived (capacity - seatsTaken, floored at 0) — the raw seatsTaken/capacity
  // counters are internal operational data and are never present on this
  // anonymous payload (REG-01, 06-RESEARCH.md Pitfall 6).
  seatsAvailable: number;
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
  upcomingCohorts: PublicCohort[];
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
};

export function createPublicCatalogueService(deps: PublicCatalogueDeps) {
  const now = deps.now ?? (() => new Date());

  async function upcomingCohorts(link: { courseId: string } | { programmeId: string }): Promise<PublicCohort[]> {
    const at = now();
    const rows = (await deps.cohortDelegate.findMany({
      where: { ...link, status: "PUBLISHED", startsAt: { gt: at } },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        enrolmentOpensAt: true,
        enrolmentClosesAt: true,
        deliveryMode: true,
        priceMinor: true,
        currency: true,
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
        priceMinor: row.priceMinor,
        currency: row.currency,
        seatsAvailable: Math.max(0, row.capacity - row.seatsTaken),
      }));
  }

  async function listPublicCourses(): Promise<Array<Omit<PublicCourse, "upcomingCohorts">>> {
    const rows = (await deps.courseDelegate.findMany({
      where: PUBLIC_VISIBILITY_WHERE,
      select: COURSE_PUBLIC_SELECT,
      orderBy: { title: "asc" },
    })) as Array<Omit<PublicCourse, "upcomingCohorts">>;
    return rows;
  }

  async function listPublicProgrammes(): Promise<Array<Omit<PublicProgramme, "upcomingCohorts" | "memberCourseTitles">>> {
    const rows = (await deps.programmeDelegate.findMany({
      where: PUBLIC_VISIBILITY_WHERE,
      select: PROGRAMME_PUBLIC_SELECT,
      orderBy: { title: "asc" },
    })) as Array<Omit<PublicProgramme, "upcomingCohorts" | "memberCourseTitles">>;
    return rows;
  }

  async function getPublicCourseBySlug(slug: string): Promise<PublicCourse | null> {
    const row = (await deps.courseDelegate.findFirst({
      where: { slug, ...PUBLIC_VISIBILITY_WHERE },
      select: { ...COURSE_PUBLIC_SELECT, id: true },
    })) as (Omit<PublicCourse, "upcomingCohorts"> & { id: string }) | null;
    if (!row) return null;
    const { id, ...rest } = row;
    return { ...rest, upcomingCohorts: await upcomingCohorts({ courseId: id }) };
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
});

export const listPublicCourses = built.listPublicCourses;
export const listPublicProgrammes = built.listPublicProgrammes;
export const getPublicCourseBySlug = built.getPublicCourseBySlug;
export const getPublicProgrammeBySlug = built.getPublicProgrammeBySlug;
