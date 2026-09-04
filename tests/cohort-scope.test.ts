/**
 * Task 3 (plan 05-02): the async cohort scope resolvers (D-21).
 *
 * Drives `createCohortScopeResolvers` with in-memory fake delegates. Proves
 * every resolver reads the row and returns a complete `ResourceScope`
 * (cohortId + programmeId + courseIds), that an unknown id denies by
 * default (`{}`), and — composed with `grantMatches` — that a COURSE grant
 * on a member course reaches a Programme cohort (threat T-05-07).
 */

import { describe, expect, it } from "vitest";
import {
  createCohortScopeResolvers,
  type CohortScopeDeps,
} from "@/server/services/cohort-scope";
import { grantMatches, type Grant } from "@/server/permissions/scope";

type CohortRow = {
  id: string;
  programmeId: string | null;
  courseId: string | null;
  cohortCourses: Array<{ courseId: string }>;
};

function makeDeps(opts: {
  cohorts?: CohortRow[];
  sessions?: Array<{ id: string; cohortId: string }>;
  enrolments?: Array<{ id: string; cohortId: string }>;
}): CohortScopeDeps {
  const cohorts = opts.cohorts ?? [];
  const sessions = opts.sessions ?? [];
  const enrolments = opts.enrolments ?? [];
  return {
    cohort: {
      findUnique: async ({ where }) =>
        cohorts.find((c) => c.id === where.id) ?? null,
    },
    session: {
      findUnique: async ({ where }) => {
        const s = sessions.find((x) => x.id === where.id);
        return s ? { cohortId: s.cohortId } : null;
      },
    },
    enrolment: {
      findUnique: async ({ where }) => {
        const e = enrolments.find((x) => x.id === where.id);
        return e ? { cohortId: e.cohortId } : null;
      },
    },
  };
}

const standaloneCourseCohort: CohortRow = {
  id: "coh-course",
  programmeId: null,
  courseId: "course-x",
  cohortCourses: [],
};

const programmeCohort: CohortRow = {
  id: "coh-prog",
  programmeId: "prog-1",
  courseId: null,
  cohortCourses: [{ courseId: "course-a" }, { courseId: "course-b" }],
};

describe("cohortResourceScope", () => {
  it("standalone-Course cohort → { cohortId, courseIds: [courseId] }, no programmeId", async () => {
    const { cohortResourceScope } = createCohortScopeResolvers(
      makeDeps({ cohorts: [standaloneCourseCohort] }),
    );
    const scope = await cohortResourceScope("coh-course");
    expect(scope).toEqual({ cohortId: "coh-course", courseIds: ["course-x"] });
    expect(scope.programmeId).toBeUndefined();
  });

  it("Programme cohort → { cohortId, programmeId, courseIds: [member course ids] }", async () => {
    const { cohortResourceScope } = createCohortScopeResolvers(
      makeDeps({ cohorts: [programmeCohort] }),
    );
    const scope = await cohortResourceScope("coh-prog");
    expect(scope).toEqual({
      cohortId: "coh-prog",
      programmeId: "prog-1",
      courseIds: ["course-a", "course-b"],
    });
  });

  it("unknown cohortId → {} (deny by default)", async () => {
    const { cohortResourceScope } = createCohortScopeResolvers(makeDeps({}));
    expect(await cohortResourceScope("nope")).toEqual({});
  });
});

describe("sessionCohortScope / enrolmentCohortScope resolve the parent id from the row", () => {
  it("sessionCohortScope delegates through the session's cohortId", async () => {
    const { sessionCohortScope } = createCohortScopeResolvers(
      makeDeps({
        cohorts: [programmeCohort],
        sessions: [{ id: "sess-1", cohortId: "coh-prog" }],
      }),
    );
    expect(await sessionCohortScope("sess-1")).toEqual({
      cohortId: "coh-prog",
      programmeId: "prog-1",
      courseIds: ["course-a", "course-b"],
    });
  });

  it("enrolmentCohortScope delegates through the enrolment's cohortId", async () => {
    const { enrolmentCohortScope } = createCohortScopeResolvers(
      makeDeps({
        cohorts: [standaloneCourseCohort],
        enrolments: [{ id: "enr-1", cohortId: "coh-course" }],
      }),
    );
    expect(await enrolmentCohortScope("enr-1")).toEqual({
      cohortId: "coh-course",
      courseIds: ["course-x"],
    });
  });

  it("unknown session / enrolment id → {}", async () => {
    const resolvers = createCohortScopeResolvers(makeDeps({ cohorts: [programmeCohort] }));
    expect(await resolvers.sessionCohortScope("ghost")).toEqual({});
    expect(await resolvers.enrolmentCohortScope("ghost")).toEqual({});
  });
});

describe("composed with grantMatches (scope.ts)", () => {
  it("a COURSE grant on a member course reaches a Programme cohort", async () => {
    const { cohortResourceScope } = createCohortScopeResolvers(
      makeDeps({ cohorts: [programmeCohort] }),
    );
    const scope = await cohortResourceScope("coh-prog");
    const grant: Grant = {
      permission: "cohorts.view",
      scopeType: "COURSE",
      scopeId: "course-b",
    };
    expect(grantMatches(grant, scope)).toBe(true);
  });

  it("an unknown cohortId yields {} and grantMatches then denies", async () => {
    const { cohortResourceScope } = createCohortScopeResolvers(makeDeps({}));
    const scope = await cohortResourceScope("nope");
    const grant: Grant = {
      permission: "cohorts.view",
      scopeType: "COHORT",
      scopeId: "nope",
    };
    expect(grantMatches(grant, scope)).toBe(false);
  });
});
