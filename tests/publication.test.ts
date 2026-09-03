import { describe, expect, it } from "vitest";
import {
  buildCourseObligationTree,
  buildProgrammeObligationTree,
  diffObligationTrees,
  hasUnpublishedObligationChanges,
  OBLIGATION_PAYLOAD_SCHEMA,
  type ObligationCourseInput,
  type ObligationProgrammeInput,
} from "@/server/services/publication";

function makeCourse(overrides: Partial<ObligationCourseInput> = {}): ObligationCourseInput {
  return {
    status: "DRAFT",
    completionRule: { kind: "ALL_REQUIRED" },
    completionRuleVersion: 1,
    modules: [
      {
        id: "mod-1",
        position: 0,
        withdrawnAt: null,
        lessons: [
          {
            id: "les-1",
            position: 0,
            required: true,
            type: "TEXT",
            assessmentId: null,
            withdrawnAt: null,
          },
          {
            id: "les-2",
            position: 1,
            required: false,
            type: "FILE",
            assessmentId: null,
            withdrawnAt: null,
          },
        ],
      },
    ],
    ...overrides,
  };
}

function makeProgramme(overrides: Partial<ObligationProgrammeInput> = {}): ObligationProgrammeInput {
  return {
    status: "DRAFT",
    sequential: true,
    completionRule: { kind: "ALL_COURSES" },
    completionRuleVersion: 1,
    courses: [
      { courseId: "course-a", position: 0 },
      { courseId: "course-b", position: 1 },
    ],
    ...overrides,
  };
}

/** Recursively collects every object key present anywhere in a value. */
function allKeysDeep(value: unknown, keys: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) allKeysDeep(item, keys);
    return keys;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      keys.add(k);
      allKeysDeep(v, keys);
    }
  }
  return keys;
}

describe("buildCourseObligationTree — the frozen D-02 payload shape", () => {
  it("output contains schema, completionRule, completionRuleVersion, and a modules array", () => {
    const tree = buildCourseObligationTree(makeCourse());
    expect(tree.schema).toBe(OBLIGATION_PAYLOAD_SCHEMA);
    expect(tree.completionRule).toEqual({ kind: "ALL_REQUIRED" });
    expect(tree.completionRuleVersion).toBe(1);
    expect(Array.isArray(tree.modules)).toBe(true);
  });

  it("each module has id and position; each lesson has id, position, required, type, assessmentId", () => {
    const tree = buildCourseObligationTree(makeCourse());
    const mod = tree.modules[0];
    expect(mod).toMatchObject({ id: "mod-1", position: 0 });
    const lesson = mod.lessons[0];
    expect(lesson).toMatchObject({
      id: "les-1",
      position: 0,
      required: true,
      type: "TEXT",
      assessmentId: null,
    });
  });

  it("contains NO title, body, summary, embedUrl, or linkUrl at any depth", () => {
    const tree = buildCourseObligationTree(makeCourse());
    const keys = allKeysDeep(tree);
    for (const forbidden of ["title", "body", "summary", "embedUrl", "linkUrl"]) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });

  it("is deterministic: building twice from the same input yields byte-identical JSON.stringify", () => {
    const course = makeCourse();
    const first = JSON.stringify(buildCourseObligationTree(course));
    const second = JSON.stringify(buildCourseObligationTree(course));
    expect(first).toBe(second);
  });

  it("is order-independent: shuffled modules/lessons array order yields byte-identical JSON.stringify", () => {
    const ordered = makeCourse({
      modules: [
        {
          id: "mod-1",
          position: 0,
          withdrawnAt: null,
          lessons: [
            { id: "les-1", position: 0, required: true, type: "TEXT", assessmentId: null, withdrawnAt: null },
            { id: "les-2", position: 1, required: false, type: "FILE", assessmentId: null, withdrawnAt: null },
          ],
        },
        {
          id: "mod-2",
          position: 1,
          withdrawnAt: null,
          lessons: [
            { id: "les-3", position: 0, required: true, type: "QUIZ", assessmentId: null, withdrawnAt: null },
          ],
        },
      ],
    });
    const shuffled = makeCourse({
      modules: [
        {
          id: "mod-2",
          position: 1,
          withdrawnAt: null,
          lessons: [
            { id: "les-3", position: 0, required: true, type: "QUIZ", assessmentId: null, withdrawnAt: null },
          ],
        },
        {
          id: "mod-1",
          position: 0,
          withdrawnAt: null,
          lessons: [
            { id: "les-2", position: 1, required: false, type: "FILE", assessmentId: null, withdrawnAt: null },
            { id: "les-1", position: 0, required: true, type: "TEXT", assessmentId: null, withdrawnAt: null },
          ],
        },
      ],
    });
    expect(JSON.stringify(buildCourseObligationTree(ordered))).toBe(
      JSON.stringify(buildCourseObligationTree(shuffled)),
    );
  });

  it("excludes withdrawn modules and lessons from a newly built tree (D-07)", () => {
    const course = makeCourse({
      modules: [
        {
          id: "mod-1",
          position: 0,
          withdrawnAt: null,
          lessons: [
            { id: "les-1", position: 0, required: true, type: "TEXT", assessmentId: null, withdrawnAt: null },
            {
              id: "les-2",
              position: 1,
              required: false,
              type: "FILE",
              assessmentId: null,
              withdrawnAt: new Date("2026-01-01"),
            },
          ],
        },
        {
          id: "mod-2",
          position: 1,
          withdrawnAt: new Date("2026-01-01"),
          lessons: [{ id: "les-3", position: 0, required: true, type: "QUIZ", assessmentId: null, withdrawnAt: null }],
        },
      ],
    });
    const tree = buildCourseObligationTree(course);
    expect(tree.modules.map((m) => m.id)).toEqual(["mod-1"]);
    expect(tree.modules[0].lessons.map((l) => l.id)).toEqual(["les-1"]);
  });
});

describe("hasUnpublishedObligationChanges — D-01, the single most important assertion", () => {
  it("is true against a null payload when course.status is PUBLISHED", () => {
    const course = makeCourse({ status: "PUBLISHED" });
    expect(hasUnpublishedObligationChanges(course, null)).toBe(true);
  });

  it("is false against a null payload when course.status is DRAFT", () => {
    const course = makeCourse({ status: "DRAFT" });
    expect(hasUnpublishedObligationChanges(course, null)).toBe(false);
  });

  it("editing only a lesson body or title returns false — a typo fix is not a requirement change", () => {
    const course = makeCourse();
    const published = buildCourseObligationTree(course);
    // A "body/title edit" never enters the obligation payload at all, so the
    // aggregate can carry arbitrary prose changes and the frozen facets stay
    // identical.
    const editedProse = makeCourse();
    expect(hasUnpublishedObligationChanges(editedProse, published)).toBe(false);
  });

  it("is false when the stored payload has the same content but its object keys are reordered", () => {
    // The real payload column is `jsonb`; PostgreSQL does not preserve object
    // key order, so the round-tripped payload arrives with keys shuffled. The
    // comparison must be canonical, not a raw JSON.stringify.
    const course = makeCourse();
    const tree = buildCourseObligationTree(course) as Record<string, unknown>;
    const shuffled = Object.fromEntries(
      Object.keys(tree).reverse().map((key) => [key, tree[key]]),
    ) as unknown as ReturnType<typeof buildCourseObligationTree>;
    expect(hasUnpublishedObligationChanges(course, shuffled)).toBe(false);
  });

  it("reordering lessons returns true", () => {
    const course = makeCourse();
    const published = buildCourseObligationTree(course);
    const reordered = makeCourse({
      modules: [
        {
          id: "mod-1",
          position: 0,
          withdrawnAt: null,
          lessons: [
            { id: "les-1", position: 1, required: true, type: "TEXT", assessmentId: null, withdrawnAt: null },
            { id: "les-2", position: 0, required: false, type: "FILE", assessmentId: null, withdrawnAt: null },
          ],
        },
      ],
    });
    expect(hasUnpublishedObligationChanges(reordered, published)).toBe(true);
  });

  it("toggling required returns true", () => {
    const course = makeCourse();
    const published = buildCourseObligationTree(course);
    const toggled = makeCourse({
      modules: [
        {
          id: "mod-1",
          position: 0,
          withdrawnAt: null,
          lessons: [
            { id: "les-1", position: 0, required: false, type: "TEXT", assessmentId: null, withdrawnAt: null },
            { id: "les-2", position: 1, required: false, type: "FILE", assessmentId: null, withdrawnAt: null },
          ],
        },
      ],
    });
    expect(hasUnpublishedObligationChanges(toggled, published)).toBe(true);
  });

  it("withdrawing a lesson returns true", () => {
    const course = makeCourse();
    const published = buildCourseObligationTree(course);
    const withdrawn = makeCourse({
      modules: [
        {
          id: "mod-1",
          position: 0,
          withdrawnAt: null,
          lessons: [
            { id: "les-1", position: 0, required: true, type: "TEXT", assessmentId: null, withdrawnAt: null },
            {
              id: "les-2",
              position: 1,
              required: false,
              type: "FILE",
              assessmentId: null,
              withdrawnAt: new Date("2026-01-01"),
            },
          ],
        },
      ],
    });
    expect(hasUnpublishedObligationChanges(withdrawn, published)).toBe(true);
  });

  it("adding a lesson returns true", () => {
    const course = makeCourse();
    const published = buildCourseObligationTree(course);
    const added = makeCourse({
      modules: [
        {
          id: "mod-1",
          position: 0,
          withdrawnAt: null,
          lessons: [
            { id: "les-1", position: 0, required: true, type: "TEXT", assessmentId: null, withdrawnAt: null },
            { id: "les-2", position: 1, required: false, type: "FILE", assessmentId: null, withdrawnAt: null },
            { id: "les-3", position: 2, required: true, type: "QUIZ", assessmentId: null, withdrawnAt: null },
          ],
        },
      ],
    });
    expect(hasUnpublishedObligationChanges(added, published)).toBe(true);
  });

  it("changing assessmentId returns true", () => {
    const course = makeCourse();
    const published = buildCourseObligationTree(course);
    const changed = makeCourse({
      modules: [
        {
          id: "mod-1",
          position: 0,
          withdrawnAt: null,
          lessons: [
            { id: "les-1", position: 0, required: true, type: "TEXT", assessmentId: "assess-1", withdrawnAt: null },
            { id: "les-2", position: 1, required: false, type: "FILE", assessmentId: null, withdrawnAt: null },
          ],
        },
      ],
    });
    expect(hasUnpublishedObligationChanges(changed, published)).toBe(true);
  });

  it("changing completionRule returns true", () => {
    const course = makeCourse();
    const published = buildCourseObligationTree(course);
    const changed = makeCourse({ completionRule: { kind: "PERCENTAGE", threshold: 80 } });
    expect(hasUnpublishedObligationChanges(changed, published)).toBe(true);
  });
});

describe("buildProgrammeObligationTree — D-04, identical treatment to Course", () => {
  it("output contains schema, sequential, completionRule, completionRuleVersion, and a courses array — no titles", () => {
    const tree = buildProgrammeObligationTree(makeProgramme());
    expect(tree.schema).toBe(OBLIGATION_PAYLOAD_SCHEMA);
    expect(tree.sequential).toBe(true);
    expect(tree.completionRule).toEqual({ kind: "ALL_COURSES" });
    expect(tree.completionRuleVersion).toBe(1);
    expect(tree.courses).toEqual([
      { courseId: "course-a", position: 0 },
      { courseId: "course-b", position: 1 },
    ]);
    expect(allKeysDeep(tree).has("title")).toBe(false);
  });

  it("reordering programme courses returns true", () => {
    const programme = makeProgramme();
    const published = buildProgrammeObligationTree(programme);
    const reordered = makeProgramme({
      courses: [
        { courseId: "course-a", position: 1 },
        { courseId: "course-b", position: 0 },
      ],
    });
    expect(hasUnpublishedObligationChanges(reordered, published)).toBe(true);
  });

  it("renaming a member course returns false — the payload never carries a course title", () => {
    // The obligation payload only ever carries { courseId, position } — a
    // course's own title lives on the Course row, not in this snapshot, so
    // there is nothing in the aggregate's `courses` array a rename could
    // touch.
    const programme = makeProgramme();
    const published = buildProgrammeObligationTree(programme);
    const unchanged = makeProgramme();
    expect(hasUnpublishedObligationChanges(unchanged, published)).toBe(false);
  });
});

describe("diffObligationTrees — human-readable change list for the publish dialog", () => {
  it("reports a lesson order change", () => {
    const before = buildCourseObligationTree(makeCourse());
    const after = buildCourseObligationTree(
      makeCourse({
        modules: [
          {
            id: "mod-1",
            position: 0,
            withdrawnAt: null,
            lessons: [
              { id: "les-1", position: 1, required: true, type: "TEXT", assessmentId: null, withdrawnAt: null },
              { id: "les-2", position: 0, required: false, type: "FILE", assessmentId: null, withdrawnAt: null },
            ],
          },
        ],
      }),
    );
    const diff = diffObligationTrees(after, before);
    expect(diff.some((line) => line.includes("les-1") && line.includes("0 -> 1"))).toBe(true);
  });

  it("reports a required-flag change", () => {
    const before = buildCourseObligationTree(makeCourse());
    const after = buildCourseObligationTree(
      makeCourse({
        modules: [
          {
            id: "mod-1",
            position: 0,
            withdrawnAt: null,
            lessons: [
              { id: "les-1", position: 0, required: false, type: "TEXT", assessmentId: null, withdrawnAt: null },
              { id: "les-2", position: 1, required: false, type: "FILE", assessmentId: null, withdrawnAt: null },
            ],
          },
        ],
      }),
    );
    const diff = diffObligationTrees(after, before);
    expect(diff.some((line) => line.includes("les-1") && line.includes("required"))).toBe(true);
  });

  it("reports a withdrawn module", () => {
    const before = buildCourseObligationTree(makeCourse());
    const after = buildCourseObligationTree(makeCourse({ modules: [] }));
    const diff = diffObligationTrees(after, before);
    expect(diff.some((line) => line.includes("mod-1") && line.includes("withdrawn"))).toBe(true);
  });

  it("reports a completion rule change", () => {
    const before = buildCourseObligationTree(makeCourse());
    const after = buildCourseObligationTree(makeCourse({ completionRule: { kind: "PERCENTAGE", threshold: 50 } }));
    const diff = diffObligationTrees(after, before);
    expect(diff).toContain("completion rule changed");
  });
});
