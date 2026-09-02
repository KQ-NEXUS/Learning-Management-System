import { describe, expect, it } from "vitest";
import {
  blockingFailures,
  evaluateCourseReadiness,
  evaluateProgrammeReadiness,
  type ReadinessCourseInput,
  type ReadinessProgrammeInput,
} from "@/server/services/readiness-service";

function makeCourse(overrides: Partial<ReadinessCourseInput> = {}): ReadinessCourseInput {
  return {
    title: "Intro to Widgets",
    summary: "A short course on widgets.",
    outcomes: "Build a widget from scratch.",
    durationHours: 4,
    prerequisites: "None",
    status: "PUBLISHED",
    upcomingCohortCount: 1,
    modules: [
      {
        withdrawnAt: null,
        lessons: [{ type: "TEXT", withdrawnAt: null }],
      },
    ],
    ...overrides,
  };
}

function makeProgramme(overrides: Partial<ReadinessProgrammeInput> = {}): ReadinessProgrammeInput {
  return {
    title: "Widget Mastery",
    summary: "A programme covering all things widget.",
    outcomes: "Master widgets end to end.",
    audience: "Engineers",
    status: "PUBLISHED",
    courses: ["course-a"],
    ...overrides,
  };
}

describe("evaluateCourseReadiness — four states, four blockers", () => {
  it("every item's state is one of PASS, FAIL, WARN, NOT_YET_CHECKED", () => {
    const items = evaluateCourseReadiness(makeCourse());
    for (const item of items) {
      expect(["PASS", "FAIL", "WARN", "NOT_YET_CHECKED"]).toContain(item.state);
    }
  });

  it("exactly four items carry blocking: true — title, summary, modules, module-lessons", () => {
    const items = evaluateCourseReadiness(makeCourse());
    const blocking = items.filter((item) => item.blocking);
    expect(blocking).toHaveLength(4);
    expect(blocking.map((item) => item.id).sort()).toEqual(
      ["modules", "module-lessons", "summary", "title"].sort(),
    );
  });

  it("no fifth item is blocking", () => {
    const items = evaluateCourseReadiness(makeCourse());
    const blockingIds = items.filter((item) => item.blocking).map((item) => item.id);
    expect(blockingIds).not.toContain("published");
    expect(blockingIds).not.toContain("schedule");
  });

  it("a DRAFT course yields WARN (not FAIL) on the published item", () => {
    const items = evaluateCourseReadiness(makeCourse({ status: "DRAFT" }));
    const published = items.find((item) => item.id === "published");
    expect(published?.state).toBe("WARN");
    expect(published?.blocking).toBe(false);
  });

  it("a DRAFT course with an otherwise-complete shape has an empty blockingFailures result", () => {
    const items = evaluateCourseReadiness(makeCourse({ status: "DRAFT" }));
    expect(blockingFailures(items)).toHaveLength(0);
  });

  it("missing outcomes produces WARN, never FAIL", () => {
    const items = evaluateCourseReadiness(makeCourse({ outcomes: null }));
    const outcomes = items.find((item) => item.id === "outcomes");
    expect(outcomes?.state).toBe("WARN");
  });

  it("missing duration produces WARN, never FAIL", () => {
    const items = evaluateCourseReadiness(makeCourse({ durationHours: null }));
    const duration = items.find((item) => item.id === "duration");
    expect(duration?.state).toBe("WARN");
  });

  it("missing prerequisites produces WARN, never FAIL", () => {
    const items = evaluateCourseReadiness(makeCourse({ prerequisites: null }));
    const prerequisites = items.find((item) => item.id === "prerequisites");
    expect(prerequisites?.state).toBe("WARN");
  });

  it("no upcoming cohorts produces WARN, never FAIL", () => {
    const items = evaluateCourseReadiness(makeCourse({ upcomingCohortCount: 0 }));
    const cohorts = items.find((item) => item.id === "cohorts");
    expect(cohorts?.state).toBe("WARN");
  });

  it("schedule, price, capacity and instructors are always NOT_YET_CHECKED — never PASS", () => {
    const items = evaluateCourseReadiness(makeCourse());
    for (const id of ["schedule", "price", "capacity", "instructors"]) {
      const item = items.find((entry) => entry.id === id);
      expect(item?.state).toBe("NOT_YET_CHECKED");
      expect(item?.deferredTo).toBe("Phase 5");
    }
  });

  it("a course with a QUIZ lesson gains an assessments item deferred to Phase 10", () => {
    const items = evaluateCourseReadiness(
      makeCourse({
        modules: [
          {
            withdrawnAt: null,
            lessons: [
              { type: "TEXT", withdrawnAt: null },
              { type: "QUIZ", withdrawnAt: null },
            ],
          },
        ],
      }),
    );
    const assessments = items.find((item) => item.id === "assessments");
    expect(assessments?.state).toBe("NOT_YET_CHECKED");
    expect(assessments?.deferredTo).toBe("Phase 10");
  });

  it("a course with an ASSIGNMENT lesson also gains the assessments item", () => {
    const items = evaluateCourseReadiness(
      makeCourse({
        modules: [{ withdrawnAt: null, lessons: [{ type: "ASSIGNMENT", withdrawnAt: null }] }],
      }),
    );
    expect(items.some((item) => item.id === "assessments")).toBe(true);
  });

  it("a course without a QUIZ or ASSIGNMENT lesson does not gain the assessments item", () => {
    const items = evaluateCourseReadiness(makeCourse());
    expect(items.some((item) => item.id === "assessments")).toBe(false);
  });

  it("blockingFailures returns only items with state FAIL and blocking true", () => {
    // A module with zero lessons keeps the "modules" item PASS-ing (a
    // module DOES exist) while failing "module-lessons" independently,
    // alongside the missing title — the three blockers this evaluator can
    // ever raise in combination.
    const items = evaluateCourseReadiness(makeCourse({ title: "", modules: [{ withdrawnAt: null, lessons: [] }] }));
    const failures = blockingFailures(items);
    expect(failures.every((item) => item.state === "FAIL" && item.blocking === true)).toBe(true);
    expect(failures.map((item) => item.id).sort()).toEqual(["module-lessons", "title"].sort());
  });

  it("a fully ready course yields zero blocking failures", () => {
    const items = evaluateCourseReadiness(makeCourse());
    expect(blockingFailures(items)).toHaveLength(0);
  });

  it("a course with a title, a summary, one module and one lesson, but DRAFT status, is listable (D-08)", () => {
    const items = evaluateCourseReadiness(
      makeCourse({
        status: "DRAFT",
        outcomes: null,
        durationHours: null,
        prerequisites: null,
        upcomingCohortCount: 0,
      }),
    );
    expect(blockingFailures(items)).toHaveLength(0);
  });

  it("a missing title is a blocking FAIL", () => {
    const items = evaluateCourseReadiness(makeCourse({ title: "" }));
    const title = items.find((item) => item.id === "title");
    expect(title?.state).toBe("FAIL");
    expect(title?.blocking).toBe(true);
  });

  it("a missing summary is a blocking FAIL", () => {
    const items = evaluateCourseReadiness(makeCourse({ summary: null }));
    const summary = items.find((item) => item.id === "summary");
    expect(summary?.state).toBe("FAIL");
    expect(summary?.blocking).toBe(true);
  });

  it("no modules is a blocking FAIL", () => {
    const items = evaluateCourseReadiness(makeCourse({ modules: [] }));
    const modules = items.find((item) => item.id === "modules");
    expect(modules?.state).toBe("FAIL");
    expect(modules?.blocking).toBe(true);
  });

  it("a module with no lessons is a blocking FAIL on module-lessons", () => {
    const items = evaluateCourseReadiness(makeCourse({ modules: [{ withdrawnAt: null, lessons: [] }] }));
    const moduleLessons = items.find((item) => item.id === "module-lessons");
    expect(moduleLessons?.state).toBe("FAIL");
    expect(moduleLessons?.blocking).toBe(true);
  });
});

describe("evaluateProgrammeReadiness", () => {
  it("blocks on title, summary, and courses", () => {
    const items = evaluateProgrammeReadiness(makeProgramme());
    const blocking = items.filter((item) => item.blocking).map((item) => item.id);
    expect(blocking.sort()).toEqual(["courses", "summary", "title"].sort());
  });

  it("published is a warning, not a blocker", () => {
    const items = evaluateProgrammeReadiness(makeProgramme({ status: "DRAFT" }));
    const published = items.find((item) => item.id === "published");
    expect(published?.state).toBe("WARN");
    expect(published?.blocking).toBe(false);
  });

  it("outcomes and audience warn when missing", () => {
    const items = evaluateProgrammeReadiness(makeProgramme({ outcomes: null, audience: null }));
    expect(items.find((item) => item.id === "outcomes")?.state).toBe("WARN");
    expect(items.find((item) => item.id === "audience")?.state).toBe("WARN");
  });

  it("no member courses is a blocking FAIL", () => {
    const items = evaluateProgrammeReadiness(makeProgramme({ courses: [] }));
    const courses = items.find((item) => item.id === "courses");
    expect(courses?.state).toBe("FAIL");
    expect(courses?.blocking).toBe(true);
  });
});
