import { describe, expect, it, vi } from "vitest";
import {
  createPublicCatalogueService,
  PUBLIC_VISIBILITY_WHERE,
  type PublicCohort,
} from "@/server/services/public-catalogue-service";

type Row = Record<string, unknown> & {
  id: string;
  slug: string;
  publiclyListed: boolean;
  status: string;
};

/** A fake that applies the same `where` shape the real Prisma delegate would. */
function makeDelegate(rows: Row[]) {
  const matches = (row: Row, where: Record<string, unknown> | undefined) => {
    if (!where) return true;
    for (const [key, cond] of Object.entries(where)) {
      if (key === "status" && cond && typeof cond === "object" && "not" in cond) {
        if (row.status === (cond as { not: string }).not) return false;
      } else if (row[key] !== cond) {
        return false;
      }
    }
    return true;
  };
  // Project like Prisma's `select` does, so the service's explicit field lists
  // are actually exercised (a bare fake would return every column).
  const project = (row: Row | undefined, select: Record<string, unknown> | undefined) => {
    if (!row) return null;
    if (!select) return row;
    const out: Record<string, unknown> = {};
    for (const [key, spec] of Object.entries(select)) {
      if (spec === true) out[key] = row[key];
      else if (spec && typeof spec === "object") out[key] = row[key]; // nested select — pass through
    }
    return out;
  };
  return {
    findMany: vi.fn(async (args: { where?: unknown; select?: unknown }) =>
      rows
        .filter((r) => matches(r, args.where as Record<string, unknown>))
        .map((r) => project(r, args.select as Record<string, unknown>)),
    ),
    findFirst: vi.fn(async (args: { where?: unknown; select?: unknown }) =>
      project(rows.find((r) => matches(r, args.where as Record<string, unknown>)), args.select as Record<string, unknown>),
    ),
  };
}

const course = (over: Partial<Row>): Row => ({
  id: `c-${over.slug ?? "x"}`,
  slug: "a-course",
  title: "A course",
  summary: "s",
  outcomes: "o",
  audience: "a",
  prerequisites: "p",
  durationHours: 8,
  certificateEnabled: true,
  completionRule: { kind: "ALL" },
  publishedById: "user-1",
  publiclyListed: true,
  status: "PUBLISHED",
  ...over,
});

const build = (courses: Row[], programmes: Row[] = [], cohorts: unknown[] = []) =>
  createPublicCatalogueService({
    courseDelegate: makeDelegate(courses),
    programmeDelegate: makeDelegate(programmes),
    cohortDelegate: {
      findMany: vi.fn(async () => cohorts as never[]),
    },
    now: () => new Date("2026-06-01T00:00:00Z"),
  });

describe("public-catalogue-service", () => {
  it("PUBLIC_VISIBILITY_WHERE only admits publiclyListed and non-archived rows", () => {
    expect(PUBLIC_VISIBILITY_WHERE).toMatchObject({ publiclyListed: true });
    expect(JSON.stringify(PUBLIC_VISIBILITY_WHERE)).toMatch(/ARCHIVED/);
  });

  it("returns a DRAFT course that is publiclyListed (D-08 early-bookings)", async () => {
    const svc = build([course({ slug: "draft-listed", status: "DRAFT", publiclyListed: true })]);
    const rows = await svc.listPublicCourses();
    expect(rows.map((r) => r.slug)).toContain("draft-listed");
  });

  it("does NOT return a PUBLISHED course that is not publiclyListed", async () => {
    const svc = build([course({ slug: "private", status: "PUBLISHED", publiclyListed: false })]);
    expect(await svc.listPublicCourses()).toHaveLength(0);
  });

  it.each([true, false])("never returns an ARCHIVED course (publiclyListed=%s)", async (listed) => {
    const svc = build([course({ slug: "archived", status: "ARCHIVED", publiclyListed: listed })]);
    expect(await svc.listPublicCourses()).toHaveLength(0);
    expect(await svc.getPublicCourseBySlug("archived")).toBeNull();
  });

  it("getPublicCourseBySlug returns null (not a throw) for unknown / unlisted / archived slugs", async () => {
    const svc = build([
      course({ slug: "unlisted", publiclyListed: false }),
      course({ slug: "archived", status: "ARCHIVED" }),
    ]);
    expect(await svc.getPublicCourseBySlug("nope")).toBeNull();
    expect(await svc.getPublicCourseBySlug("unlisted")).toBeNull();
    expect(await svc.getPublicCourseBySlug("archived")).toBeNull();
  });

  it("the returned course shape carries no completionRule, publishedById or internal id", async () => {
    const svc = build([course({ slug: "shape" })]);
    const one = await svc.getPublicCourseBySlug("shape");
    expect(one).not.toBeNull();
    expect(one).not.toHaveProperty("completionRule");
    expect(one).not.toHaveProperty("publishedById");
    expect(one).not.toHaveProperty("id");
    expect(one).toMatchObject({ slug: "shape", title: "A course" });
  });

  it("the programme shape omits prerequisites and durationHours and adds member course titles", async () => {
    const svc = build(
      [],
      [
        {
          id: "p-1",
          slug: "a-programme",
          title: "A programme",
          summary: "s",
          outcomes: "o",
          audience: "a",
          certificateEnabled: true,
          completionRule: {},
          publiclyListed: true,
          status: "PUBLISHED",
          courses: [
            { position: 1, course: { title: "Second" } },
            { position: 0, course: { title: "First" } },
          ],
        } as unknown as Row,
      ],
    );
    const one = await svc.getPublicProgrammeBySlug("a-programme");
    expect(one).not.toBeNull();
    expect(one).not.toHaveProperty("prerequisites");
    expect(one).not.toHaveProperty("durationHours");
    expect(one).not.toHaveProperty("completionRule");
    expect((one as { memberCourseTitles: string[] }).memberCourseTitles).toEqual(["First", "Second"]);
  });

  it("upcoming cohorts are only PUBLISHED, future-starting, with an open or future enrolment window", async () => {
    const svc = build(
      [course({ slug: "with-cohorts" })],
      [],
      [
        {
          startsAt: new Date("2026-09-01T00:00:00Z"),
          enrolmentOpensAt: new Date("2026-05-01T00:00:00Z"),
          enrolmentClosesAt: new Date("2026-08-01T00:00:00Z"),
          status: "PUBLISHED",
        },
      ],
    );
    const one = await svc.getPublicCourseBySlug("with-cohorts");
    expect((one as { upcomingCohorts: unknown[] }).upcomingCohorts).toHaveLength(1);
  });

  const cohortRow = (over: Record<string, unknown> = {}) => ({
    id: "cohort-1",
    startsAt: new Date("2026-09-01T00:00:00Z"),
    endsAt: new Date("2026-09-30T00:00:00Z"),
    enrolmentOpensAt: new Date("2026-05-01T00:00:00Z"),
    enrolmentClosesAt: new Date("2026-08-01T00:00:00Z"),
    deliveryMode: "INSTRUCTOR_LED",
    priceMinor: 45000000,
    currency: "NGN",
    capacity: 10,
    seatsTaken: 3,
    status: "PUBLISHED",
    ...over,
  });

  it("derives seatsAvailable as capacity - seatsTaken", async () => {
    const svc = build([course({ slug: "seats" })], [], [cohortRow({ capacity: 10, seatsTaken: 3 })]);
    const one = await svc.getPublicCourseBySlug("seats");
    const [cohort] = (one as { upcomingCohorts: PublicCohort[] }).upcomingCohorts;
    expect(cohort.seatsAvailable).toBe(7);
  });

  it("reports seatsAvailable: 0 for a fully-subscribed cohort", async () => {
    const svc = build([course({ slug: "full" })], [], [cohortRow({ capacity: 5, seatsTaken: 5 })]);
    const one = await svc.getPublicCourseBySlug("full");
    const [cohort] = (one as { upcomingCohorts: PublicCohort[] }).upcomingCohorts;
    expect(cohort.seatsAvailable).toBe(0);
  });

  it("floors seatsAvailable at 0 rather than going negative when seatsTaken exceeds capacity", async () => {
    const svc = build([course({ slug: "over" })], [], [cohortRow({ capacity: 5, seatsTaken: 7 })]);
    const one = await svc.getPublicCourseBySlug("over");
    const [cohort] = (one as { upcomingCohorts: PublicCohort[] }).upcomingCohorts;
    expect(cohort.seatsAvailable).toBe(0);
  });

  it("the returned cohort has no seatsTaken and no capacity key — only the derived figure", async () => {
    const svc = build([course({ slug: "no-occupancy" })], [], [cohortRow()]);
    const one = await svc.getPublicCourseBySlug("no-occupancy");
    const [cohort] = (one as { upcomingCohorts: PublicCohort[] }).upcomingCohorts;
    expect(Object.keys(cohort).sort()).toEqual(
      [
        "currency",
        "deliveryMode",
        "endsAt",
        "enrolmentClosesAt",
        "enrolmentOpensAt",
        "id",
        "priceMinor",
        "seatsAvailable",
        "startsAt",
      ].sort(),
    );
  });
});
