/**
 * Task 1 (plan 04-08): the shared running-cohort guard and the slug freeze.
 *
 * `blockingCohorts` is exercised through an in-memory fake Prisma `Cohort`
 * delegate that interprets exactly the `where` shape the implementation
 * builds — status window, date window, and the Course reach (direct
 * `courseId` OR through `CohortCourse`) vs the Programme reach
 * (`programmeId`). No real Postgres: this is unit coverage of the predicate,
 * the error payload, and the pure `assertSlugMutable` rule.
 */

import { describe, expect, it } from "vitest";
import {
  assertSlugMutable,
  createCatalogueGuards,
  RunningCohortError,
  SlugFrozenError,
  type CohortGuardDelegate,
} from "@/server/services/catalogue-guards";

type CohortFixture = {
  id: string;
  code: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
  courseId: string | null;
  programmeId: string | null;
  cohortCourses: Array<{ courseId: string }>;
  enrolments: number;
};

const NOW = new Date("2026-06-15T12:00:00.000Z");
const past = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
const future = (days: number) => new Date(NOW.getTime() + days * 86_400_000);

function makeCohort(overrides: Partial<CohortFixture> = {}): CohortFixture {
  return {
    id: overrides.id ?? "coh-1",
    code: overrides.code ?? "COH-1",
    title: overrides.title ?? "Spring Cohort",
    startsAt: overrides.startsAt ?? past(10),
    endsAt: overrides.endsAt ?? future(10),
    status: overrides.status ?? "IN_PROGRESS",
    courseId: overrides.courseId ?? null,
    programmeId: overrides.programmeId ?? null,
    cohortCourses: overrides.cohortCourses ?? [],
    enrolments: overrides.enrolments ?? 0,
  };
}

/** Interprets the exact `where` shape `blockingCohorts` produces. */
function fakeCohortDelegate(rows: CohortFixture[]): CohortGuardDelegate {
  return {
    findMany: async ({ where }) => {
      const w = where as {
        status: { in: string[] };
        startsAt: { lte: Date };
        endsAt: { gte: Date };
        OR?: Array<{ courseId?: string; cohortCourses?: { some: { courseId: string } } }>;
        programmeId?: string;
      };
      return rows
        .filter((row) => w.status.in.includes(row.status))
        .filter((row) => row.startsAt.getTime() <= w.startsAt.lte.getTime())
        .filter((row) => row.endsAt.getTime() >= w.endsAt.gte.getTime())
        .filter((row) => {
          if (w.programmeId !== undefined) {
            return row.programmeId === w.programmeId;
          }
          if (w.OR) {
            return w.OR.some((clause) => {
              if (clause.courseId !== undefined) return row.courseId === clause.courseId;
              if (clause.cohortCourses) {
                return row.cohortCourses.some(
                  (cc) => cc.courseId === clause.cohortCourses!.some.courseId,
                );
              }
              return false;
            });
          }
          return false;
        })
        .map((row) => ({
          id: row.id,
          code: row.code,
          title: row.title,
          endsAt: row.endsAt,
          _count: { enrolments: row.enrolments },
        }));
    },
  };
}

function guards(rows: CohortFixture[]) {
  return createCatalogueGuards({ cohort: fakeCohortDelegate(rows), now: () => NOW });
}

describe("blockingCohorts — Course", () => {
  it("returns a running Cohort reached directly by Cohort.courseId, with its learner count and end date", async () => {
    const endsAt = future(20);
    const { blockingCohorts } = guards([
      makeCohort({ id: "c1", code: "ALG-2026", title: "Algebra 2026", courseId: "course-x", status: "IN_PROGRESS", endsAt, enrolments: 7 }),
    ]);

    const result = await blockingCohorts({ courseId: "course-x" });

    expect(result).toEqual([
      { id: "c1", code: "ALG-2026", title: "Algebra 2026", endsAt, enrolmentCount: 7 },
    ]);
  });

  it("returns a running Cohort reached through CohortCourse (a Course inside a Programme cohort)", async () => {
    const { blockingCohorts } = guards([
      makeCohort({
        id: "c2",
        code: "PROG-COH",
        courseId: null,
        programmeId: "programme-y",
        status: "PUBLISHED",
        cohortCourses: [{ courseId: "course-x" }],
      }),
    ]);

    const result = await blockingCohorts({ courseId: "course-x" });
    expect(result.map((c) => c.id)).toEqual(["c2"]);
  });

  it("counts a PUBLISHED cohort in its date window as running", async () => {
    const { blockingCohorts } = guards([
      makeCohort({ id: "c3", courseId: "course-x", status: "PUBLISHED" }),
    ]);
    expect(await blockingCohorts({ courseId: "course-x" })).toHaveLength(1);
  });

  it("a CANCELLED cohort never blocks, whatever its dates", async () => {
    const { blockingCohorts } = guards([
      makeCohort({ id: "c4", courseId: "course-x", status: "CANCELLED", startsAt: past(5), endsAt: future(5) }),
    ]);
    expect(await blockingCohorts({ courseId: "course-x" })).toEqual([]);
  });

  it("a COMPLETED cohort never blocks, whatever its dates", async () => {
    const { blockingCohorts } = guards([
      makeCohort({ id: "c5", courseId: "course-x", status: "COMPLETED", startsAt: past(5), endsAt: future(5) }),
    ]);
    expect(await blockingCohorts({ courseId: "course-x" })).toEqual([]);
  });

  it("a PUBLISHED cohort that has not started yet does not block", async () => {
    const { blockingCohorts } = guards([
      makeCohort({ id: "c6", courseId: "course-x", status: "PUBLISHED", startsAt: future(3), endsAt: future(30) }),
    ]);
    expect(await blockingCohorts({ courseId: "course-x" })).toEqual([]);
  });

  it("a cohort that has already ended does not block", async () => {
    const { blockingCohorts } = guards([
      makeCohort({ id: "c7", courseId: "course-x", status: "IN_PROGRESS", startsAt: past(60), endsAt: past(1) }),
    ]);
    expect(await blockingCohorts({ courseId: "course-x" })).toEqual([]);
  });

  it("a DRAFT cohort never blocks", async () => {
    const { blockingCohorts } = guards([
      makeCohort({ id: "c8", courseId: "course-x", status: "DRAFT" }),
    ]);
    expect(await blockingCohorts({ courseId: "course-x" })).toEqual([]);
  });
});

describe("blockingCohorts — Programme (symmetric)", () => {
  it("returns a running Cohort reached by Cohort.programmeId", async () => {
    const { blockingCohorts } = guards([
      makeCohort({ id: "p1", code: "LEAD-COH", programmeId: "programme-z", status: "IN_PROGRESS", enrolments: 12 }),
      makeCohort({ id: "other", programmeId: "programme-other", status: "IN_PROGRESS" }),
    ]);

    const result = await blockingCohorts({ programmeId: "programme-z" });
    expect(result).toEqual([
      { id: "p1", code: "LEAD-COH", title: "Spring Cohort", endsAt: future(10), enrolmentCount: 12 },
    ]);
  });

  it("a CANCELLED programme cohort never blocks", async () => {
    const { blockingCohorts } = guards([
      makeCohort({ id: "p2", programmeId: "programme-z", status: "CANCELLED" }),
    ]);
    expect(await blockingCohorts({ programmeId: "programme-z" })).toEqual([]);
  });
});

describe("assertNoRunningCohorts", () => {
  it("throws RunningCohortError carrying the full blocking list", async () => {
    const { assertNoRunningCohorts } = guards([
      makeCohort({ id: "r1", code: "RUN-1", courseId: "course-x", status: "IN_PROGRESS", enrolments: 3 }),
    ]);

    await expect(assertNoRunningCohorts({ courseId: "course-x" })).rejects.toBeInstanceOf(
      RunningCohortError,
    );

    try {
      await assertNoRunningCohorts({ courseId: "course-x" });
    } catch (err) {
      const running = err as RunningCohortError;
      expect(running.cohorts).toEqual([
        { id: "r1", code: "RUN-1", title: "Spring Cohort", endsAt: future(10), enrolmentCount: 3 },
      ]);
    }
  });

  it("the RunningCohortError message names the blocking cohort's code (D-12)", async () => {
    const { assertNoRunningCohorts } = guards([
      makeCohort({ id: "r2", code: "NAMED-COHORT-42", courseId: "course-x", status: "IN_PROGRESS" }),
    ]);

    await expect(assertNoRunningCohorts({ courseId: "course-x" })).rejects.toThrow(
      /NAMED-COHORT-42/,
    );
  });

  it("resolves without throwing when nothing is running", async () => {
    const { assertNoRunningCohorts } = guards([
      makeCohort({ id: "r3", courseId: "course-x", status: "DRAFT" }),
    ]);
    await expect(assertNoRunningCohorts({ courseId: "course-x" })).resolves.toBeUndefined();
  });

  it("works symmetrically for a Programme", async () => {
    const { assertNoRunningCohorts } = guards([
      makeCohort({ id: "r4", code: "PROG-RUN", programmeId: "programme-z", status: "PUBLISHED" }),
    ]);
    await expect(assertNoRunningCohorts({ programmeId: "programme-z" })).rejects.toThrow(
      /PROG-RUN/,
    );
  });
});

describe("assertSlugMutable (D-11)", () => {
  it("passes while the record is unlisted (slugLockedAt is null)", () => {
    expect(() => assertSlugMutable({ slugLockedAt: null })).not.toThrow();
  });

  it("throws SlugFrozenError once the record has been listed (slugLockedAt is a Date)", () => {
    expect(() => assertSlugMutable({ slugLockedAt: new Date() })).toThrow(SlugFrozenError);
  });

  it("passes with an administrator override that carries a reason", () => {
    expect(() =>
      assertSlugMutable(
        { slugLockedAt: new Date() },
        { adminOverride: true, reason: "Legal name change, ticket OPS-1042" },
      ),
    ).not.toThrow();
  });

  it("still refuses an administrator override with no reason", () => {
    expect(() =>
      assertSlugMutable({ slugLockedAt: new Date() }, { adminOverride: true }),
    ).toThrow(SlugFrozenError);
    expect(() =>
      assertSlugMutable({ slugLockedAt: new Date() }, { adminOverride: true, reason: "   " }),
    ).toThrow(SlugFrozenError);
  });
});
