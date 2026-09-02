/**
 * Task 2 (plan 04-08): the shared publish operation.
 *
 * Driven by an in-memory fake `PublishDb` plus a harness-built
 * `withPermission` (GLOBAL grants for the data-semantics cases, a
 * deliberately missing grant for the authorization cases). No real Postgres
 * here — `tests/publish.integration.test.ts` (Task 3) proves version
 * immutability and the cohort pin against a real unique index.
 */

import { describe, expect, it } from "vitest";
import { createTestWithPermission, grant } from "./support/harness";
import {
  createPublishService,
  PublishTargetNotFoundError,
  ReadinessRefusedError,
  ReasonRequiredError,
  UnknownMigrationTargetError,
  type PublishDb,
  type PublishTx,
  type CoursePublishAggregate,
  type ProgrammePublishAggregate,
} from "@/server/services/publish-service";
import { StaleOrderError } from "@/server/services/reorder-service";
import { RunningCohortError, type BlockingCohort } from "@/server/services/catalogue-guards";
import { AuthorizationError } from "@/server/permissions/with-permission";

const T0 = new Date("2026-01-01T00:00:00.000Z");
const NOW = new Date("2026-02-01T00:00:00.000Z");

type CourseRow = {
  id: string;
  updatedAt: Date;
  status: string;
  contentVersion: number;
  publishedAt: Date | null;
  publishedById: string | null;
  publiclyListed: boolean;
  publiclyListedAt: Date | null;
  slugLockedAt: Date | null;
  title: string | null;
  summary: string | null;
};

type ProgrammeRow = CourseRow & { sequential: boolean };

type PubRow = {
  id: string;
  parentId: string;
  version: number;
  payload: unknown;
  payloadSchema: number;
  publishedById: string;
  reason: string | null;
};

function makeHarness(opts?: {
  running?: BlockingCohort[];
  courseOverrides?: Partial<CourseRow>;
}) {
  const running = opts?.running ?? [];

  const courses = new Map<string, CourseRow>();
  const programmes = new Map<string, ProgrammeRow>();
  const coursePublications: PubRow[] = [];
  const programmePublications: PubRow[] = [];
  const cohorts = new Map<
    string,
    { id: string; courseId: string | null; programmeId: string | null; coursePublicationId: string | null; programmePublicationId: string | null }
  >();
  const cohortCourses: Array<{ cohortId: string; courseId: string; coursePublicationId: string | null }> = [];
  const audits: Array<Record<string, unknown>> = [];

  courses.set("course-1", {
    id: "course-1",
    updatedAt: T0,
    status: "DRAFT",
    contentVersion: 1,
    publishedAt: null,
    publishedById: null,
    publiclyListed: false,
    publiclyListedAt: null,
    slugLockedAt: null,
    title: "Intro to Widgets",
    summary: "A short course on widgets.",
    ...opts?.courseOverrides,
  });

  programmes.set("programme-1", {
    id: "programme-1",
    updatedAt: T0,
    status: "DRAFT",
    contentVersion: 1,
    publishedAt: null,
    publishedById: null,
    publiclyListed: false,
    publiclyListedAt: null,
    slugLockedAt: null,
    title: "Widget Mastery",
    summary: "All things widget.",
    sequential: true,
  });

  cohorts.set("cohort-standalone", {
    id: "cohort-standalone",
    courseId: "course-1",
    programmeId: null,
    coursePublicationId: null,
    programmePublicationId: null,
  });

  const courseModules = [
    {
      id: "mod-1",
      position: 0,
      withdrawnAt: null,
      lessons: [
        { id: "les-1", position: 0, required: true, type: "TEXT", assessmentId: null, withdrawnAt: null },
      ],
    },
  ];

  function loadCourse(id: string): Promise<CoursePublishAggregate | null> {
    const row = courses.get(id);
    if (!row) return Promise.resolve(null);
    return Promise.resolve({
      id: row.id,
      updatedAt: row.updatedAt,
      status: row.status,
      contentVersion: row.contentVersion,
      title: row.title,
      summary: row.summary,
      outcomes: "Build a widget.",
      durationHours: 4,
      prerequisites: "None",
      publiclyListed: row.publiclyListed,
      publiclyListedAt: row.publiclyListedAt,
      slugLockedAt: row.slugLockedAt,
      completionRule: { kind: "ALL_REQUIRED" },
      completionRuleVersion: 1,
      upcomingCohortCount: 1,
      modules: courseModules,
    });
  }

  function loadProgramme(id: string): Promise<ProgrammePublishAggregate | null> {
    const row = programmes.get(id);
    if (!row) return Promise.resolve(null);
    return Promise.resolve({
      id: row.id,
      updatedAt: row.updatedAt,
      status: row.status,
      contentVersion: row.contentVersion,
      title: row.title,
      summary: row.summary,
      outcomes: "Master widgets.",
      audience: "Engineers",
      publiclyListed: row.publiclyListed,
      publiclyListedAt: row.publiclyListedAt,
      slugLockedAt: row.slugLockedAt,
      sequential: row.sequential,
      completionRule: { kind: "ALL_COURSES" },
      completionRuleVersion: 1,
      courses: [{ courseId: "course-1", position: 0 }],
    });
  }

  const whereMatch = (obj: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => obj[k] === v);

  let pubCounter = 0;

  function makeParentDelegate(store: Map<string, { updatedAt: Date } & Record<string, unknown>>) {
    return {
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; updatedAt: Date };
        data: Record<string, unknown>;
      }) => {
        const row = store.get(where.id);
        if (!row || row.updatedAt.getTime() !== where.updatedAt.getTime()) {
          return { count: 0 };
        }
        Object.assign(row, data);
        return { count: 1 };
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = store.get(where.id);
        if (row) Object.assign(row, data);
        return row;
      },
    };
  }

  function makePubDelegate(list: PubRow[], key: "courseId" | "programmeId") {
    return {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const rows = list
          .filter((r) => r.parentId === where[key])
          .sort((a, b) => b.version - a.version);
        return rows[0] ? { version: rows[0].version } : null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        pubCounter += 1;
        const row: PubRow = {
          id: `pub-${pubCounter}`,
          parentId: (data[key] ?? data.courseId ?? data.programmeId) as string,
          version: data.version as number,
          payload: data.payload,
          payloadSchema: data.payloadSchema as number,
          publishedById: data.publishedById as string,
          reason: (data.reason ?? null) as string | null,
        };
        list.push(row);
        return { id: row.id, version: row.version };
      },
    };
  }

  const tx: PublishTx = {
    course: makeParentDelegate(courses as never),
    programme: makeParentDelegate(programmes as never),
    coursePublication: makePubDelegate(coursePublications, "courseId"),
    programmePublication: makePubDelegate(programmePublications, "programmeId"),
    cohort: {
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const c of cohorts.values()) {
          if (whereMatch(c as never, where)) {
            Object.assign(c, data);
            count += 1;
          }
        }
        return { count };
      },
    },
    cohortCourse: {
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const cc of cohortCourses) {
          if (whereMatch(cc as never, where)) {
            Object.assign(cc, data);
            count += 1;
          }
        }
        return { count };
      },
    },
  };

  const db: PublishDb = { $transaction: (fn) => fn(tx) };

  function buildService(grants: Parameters<typeof createTestWithPermission>[0]) {
    const { withPermission } = createTestWithPermission(grants, { userId: "actor-9" });
    return createPublishService({
      db,
      loadCourse,
      loadProgramme,
      updateCourse: async (id, data) => {
        const row = courses.get(id);
        if (row) Object.assign(row, data);
        return row;
      },
      updateProgramme: async (id, data) => {
        const row = programmes.get(id);
        if (row) Object.assign(row, data);
        return row;
      },
      latestCoursePublication: async (id) => {
        const rows = coursePublications
          .filter((r) => r.parentId === id)
          .sort((a, b) => b.version - a.version);
        return rows[0]
          ? {
              id: rows[0].id,
              version: rows[0].version,
              payload: rows[0].payload,
              publishedAt: NOW,
              publishedById: rows[0].publishedById,
            }
          : null;
      },
      latestProgrammePublication: async () => null,
      blockingCohorts: async () => running,
      assertNoRunningCohorts: async () => {
        if (running.length > 0) throw new RunningCohortError(running);
      },
      removeCourseFromAllProgrammes: async () => ({ programmeTitles: [] }),
      withPermission,
      audit: async (entry) => {
        audits.push(entry as never);
      },
      now: () => NOW,
    });
  }

  return {
    buildService,
    state: { courses, programmes, coursePublications, programmePublications, cohorts, cohortCourses },
    audits,
  };
}

const RUNNING_COHORT: BlockingCohort = {
  id: "cohort-standalone",
  code: "RUN-1",
  title: "Running Cohort",
  endsAt: new Date("2026-12-01T00:00:00.000Z"),
  enrolmentCount: 4,
};

describe("publishCourse — authorization (D-09)", () => {
  it("denies a caller holding only courses.edit", async () => {
    const h = makeHarness();
    const svc = h.buildService([grant("courses.edit")]);
    await expect(
      svc.publishCourse({ courseId: "course-1", expectedUpdatedAt: T0 }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("cannot change publiclyListed through publishCourse", async () => {
    const h = makeHarness();
    const svc = h.buildService([grant("courses.publish")]);
    await svc.publishCourse({ courseId: "course-1", expectedUpdatedAt: T0 });
    expect(h.state.courses.get("course-1")!.publiclyListed).toBe(false);
    expect(h.state.courses.get("course-1")!.publiclyListedAt).toBeNull();
  });
});

describe("publishCourse — the immutable version", () => {
  it("inserts one CoursePublication at version 1 with the frozen payload, schema, and actor", async () => {
    const h = makeHarness();
    const svc = h.buildService([grant("courses.publish")]);

    const result = await svc.publishCourse({ courseId: "course-1", expectedUpdatedAt: T0 });

    expect(result.version).toBe(1);
    expect(h.state.coursePublications).toHaveLength(1);
    const pub = h.state.coursePublications[0];
    expect(pub.version).toBe(1);
    expect(pub.payloadSchema).toBe(1);
    expect(pub.publishedById).toBe("actor-9");
    expect(pub.payload).toMatchObject({
      schema: 1,
      modules: [{ id: "mod-1", lessons: [{ id: "les-1", required: true, type: "TEXT" }] }],
    });
  });

  it("sets Course.status, publishedAt, publishedById and contentVersion", async () => {
    const h = makeHarness();
    const svc = h.buildService([grant("courses.publish")]);
    await svc.publishCourse({ courseId: "course-1", expectedUpdatedAt: T0 });

    const row = h.state.courses.get("course-1")!;
    expect(row.status).toBe("PUBLISHED");
    expect(row.publishedAt).toEqual(NOW);
    expect(row.publishedById).toBe("actor-9");
    expect(row.contentVersion).toBe(1);
  });

  it("a second publish inserts version 2 and never mutates the version 1 row", async () => {
    const h = makeHarness();
    const svc = h.buildService([grant("courses.publish")]);

    await svc.publishCourse({ courseId: "course-1", expectedUpdatedAt: T0 });
    const v1Snapshot = JSON.stringify(h.state.coursePublications[0]);

    const newToken = h.state.courses.get("course-1")!.updatedAt;
    const second = await svc.publishCourse({ courseId: "course-1", expectedUpdatedAt: newToken });

    expect(second.version).toBe(2);
    expect(h.state.coursePublications).toHaveLength(2);
    expect(JSON.stringify(h.state.coursePublications[0])).toBe(v1Snapshot);
  });

  it("refuses with StaleOrderError when expectedUpdatedAt does not match, writing no publication row (D-22)", async () => {
    const h = makeHarness();
    const svc = h.buildService([grant("courses.publish")]);
    await expect(
      svc.publishCourse({ courseId: "course-1", expectedUpdatedAt: new Date("2000-01-01") }),
    ).rejects.toBeInstanceOf(StaleOrderError);
    expect(h.state.coursePublications).toHaveLength(0);
  });

  it("refuses with ReadinessRefusedError listing the failures when a blocking item is FAIL", async () => {
    const h = makeHarness({ courseOverrides: { title: null } });
    const svc = h.buildService([grant("courses.publish")]);
    await expect(
      svc.publishCourse({ courseId: "course-1", expectedUpdatedAt: T0 }),
    ).rejects.toBeInstanceOf(ReadinessRefusedError);
    expect(h.state.coursePublications).toHaveLength(0);
  });

  it("throws PublishTargetNotFoundError for an unknown id", async () => {
    const h = makeHarness();
    const svc = h.buildService([grant("courses.publish")]);
    await expect(
      svc.publishCourse({ courseId: "nope", expectedUpdatedAt: T0 }),
    ).rejects.toBeInstanceOf(PublishTargetNotFoundError);
  });
});

describe("publishCourse — cohort migration (D-06)", () => {
  it("leaves every running cohort's coursePublicationId unchanged when migrateCohortIds is empty", async () => {
    const h = makeHarness({ running: [RUNNING_COHORT] });
    const svc = h.buildService([grant("courses.publish")]);
    await svc.publishCourse({ courseId: "course-1", expectedUpdatedAt: T0, migrateCohortIds: [] });
    expect(h.state.cohorts.get("cohort-standalone")!.coursePublicationId).toBeNull();
  });

  it("refuses a non-empty migrateCohortIds with a blank reason", async () => {
    const h = makeHarness({ running: [RUNNING_COHORT] });
    const svc = h.buildService([grant("courses.publish")]);
    await expect(
      svc.publishCourse({
        courseId: "course-1",
        expectedUpdatedAt: T0,
        migrateCohortIds: ["cohort-standalone"],
        reason: "   ",
      }),
    ).rejects.toBeInstanceOf(ReasonRequiredError);
  });

  it("repoints only the ticked cohort's pin and audits the migration with the reason", async () => {
    const h = makeHarness({ running: [RUNNING_COHORT] });
    const svc = h.buildService([grant("courses.publish")]);

    const result = await svc.publishCourse({
      courseId: "course-1",
      expectedUpdatedAt: T0,
      migrateCohortIds: ["cohort-standalone"],
      reason: "Corrected a required-flag error",
    });

    expect(h.state.cohorts.get("cohort-standalone")!.coursePublicationId).toBe(result.publicationId);
    const migrationAudit = h.audits.find((a) => a.action === "course.cohorts_migrated");
    expect(migrationAudit).toMatchObject({ reason: "Corrected a required-flag error" });
  });

  it("rejects a migrateCohortId that is not among the affected running cohorts", async () => {
    const h = makeHarness({ running: [RUNNING_COHORT] });
    const svc = h.buildService([grant("courses.publish")]);
    await expect(
      svc.publishCourse({
        courseId: "course-1",
        expectedUpdatedAt: T0,
        migrateCohortIds: ["forged-cohort"],
        reason: "x",
      }),
    ).rejects.toBeInstanceOf(UnknownMigrationTargetError);
  });
});

describe("publishProgramme — same rules, its own permission and payload builder", () => {
  it("denies a caller holding only programmes.manage (needs programmes.publish)", async () => {
    const h = makeHarness();
    const svc = h.buildService([grant("programmes.manage")]);
    await expect(
      svc.publishProgramme({ programmeId: "programme-1", expectedUpdatedAt: T0 }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("writes ProgrammePublication and Programme.contentVersion / publishedById via the shared commit", async () => {
    const h = makeHarness();
    const svc = h.buildService([grant("programmes.publish")]);

    const result = await svc.publishProgramme({ programmeId: "programme-1", expectedUpdatedAt: T0 });

    expect(result.version).toBe(1);
    expect(h.state.programmePublications).toHaveLength(1);
    expect(h.state.programmePublications[0].payload).toMatchObject({
      schema: 1,
      sequential: true,
      courses: [{ courseId: "course-1", position: 0 }],
    });
    const row = h.state.programmes.get("programme-1")!;
    expect(row.status).toBe("PUBLISHED");
    expect(row.contentVersion).toBe(1);
    expect(row.publishedById).toBe("actor-9");
  });
});

describe("unpublishContent (D-12)", () => {
  it("requires courses.publish", async () => {
    const h = makeHarness();
    const svc = h.buildService([grant("courses.edit")]);
    await expect(
      svc.unpublishContent({ kind: "Course", id: "course-1", reason: "withdrawn" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("throws RunningCohortError when a cohort is running, and does not change status", async () => {
    const h = makeHarness({ running: [RUNNING_COHORT], courseOverrides: { status: "PUBLISHED" } });
    const svc = h.buildService([grant("courses.publish")]);
    await expect(
      svc.unpublishContent({ kind: "Course", id: "course-1", reason: "withdrawn" }),
    ).rejects.toBeInstanceOf(RunningCohortError);
    expect(h.state.courses.get("course-1")!.status).toBe("PUBLISHED");
  });

  it("returns a Course to DRAFT when nothing is running", async () => {
    const h = makeHarness({ courseOverrides: { status: "PUBLISHED" } });
    const svc = h.buildService([grant("courses.publish")]);
    await svc.unpublishContent({ kind: "Course", id: "course-1", reason: "withdrawn" });
    expect(h.state.courses.get("course-1")!.status).toBe("DRAFT");
  });

  it("refuses a blank reason", async () => {
    const h = makeHarness({ courseOverrides: { status: "PUBLISHED" } });
    const svc = h.buildService([grant("courses.publish")]);
    await expect(
      svc.unpublishContent({ kind: "Course", id: "course-1", reason: "  " }),
    ).rejects.toBeInstanceOf(ReasonRequiredError);
  });
});
