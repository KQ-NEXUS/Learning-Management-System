import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * The staff Assessment authoring routes (plan 10-08, ASM-01/ASM-03).
 *
 * Graded like `tests/arrange-page-route.test.ts` (route modules invoked
 * directly, service calls faked) and `tests/cohort-actions.test.ts` (Server
 * Actions invoked directly with a constructed `FormData`, `next/cache` and
 * `next/navigation` mocked so `redirect()`'s throw can be asserted rather
 * than actually thrown).
 */

const NOT_FOUND = "NEXT_NOT_FOUND";

const { mocks, AuthorizationError, AuthenticationError, AssessmentNotPublishableError } =
  vi.hoisted(() => {
    class AuthorizationError extends Error {}
    class AuthenticationError extends Error {}
    class AssessmentNotPublishableError extends Error {
      failures: unknown[];
      constructor(failures: unknown[]) {
        super(`blocked by ${failures.length} check(s)`);
        this.name = "AssessmentNotPublishableError";
        this.failures = failures;
      }
    }
    return {
      AuthorizationError,
      AuthenticationError,
      AssessmentNotPublishableError,
      mocks: {
        courseGet: vi.fn(),
        assessmentList: vi.fn(),
        assessmentGet: vi.fn(),
        assessmentCreate: vi.fn(),
        assessmentUpdate: vi.fn(),
        assessmentArchive: vi.fn(),
        publishAssessment: vi.fn(),
        revalidatePath: vi.fn(),
        redirect: vi.fn((url: string) => {
          throw new Error(`NEXT_REDIRECT:${url}`);
        }),
        notFound: vi.fn(() => {
          throw new Error(NOT_FOUND);
        }),
      },
    };
  });

vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/server/permissions", () => ({ AuthorizationError, AuthenticationError, can: async () => true }));
vi.mock("@/server/services/course-service", () => ({
  courseService: { get: mocks.courseGet },
}));
vi.mock("@/server/services/assessment-service", () => ({
  assessmentService: {
    list: mocks.assessmentList,
    get: mocks.assessmentGet,
    create: mocks.assessmentCreate,
    update: mocks.assessmentUpdate,
    archive: mocks.assessmentArchive,
  },
  publishAssessment: mocks.publishAssessment,
  AssessmentNotPublishableError,
  FEEDBACK_BEHAVIOURS: ["ON_RELEASE", "IMMEDIATE", "NEVER"],
}));

const { default: AssessmentsListPage } = await import(
  "@/app/staff/courses/[id]/assessments/page"
);
const { createAssessmentAction, updateAssessmentAction, publishAssessmentAction } = await import(
  "@/app/staff/courses/[id]/assessments/actions"
);

const runList = (id = "course-1") =>
  AssessmentsListPage({ params: Promise.resolve({ id }) } as never);

function quizFormData(overrides: Record<string, string> = {}) {
  const data = new FormData();
  const fields: Record<string, string> = {
    courseId: "course-1",
    type: "QUIZ",
    title: "Module 1 Quiz",
    feedbackBehaviour: "ON_RELEASE",
    attemptGradingMethod: "HIGHEST",
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}

function assignmentFormData(overrides: Record<string, string> = {}) {
  const data = new FormData();
  const fields: Record<string, string> = {
    courseId: "course-1",
    type: "ASSIGNMENT",
    title: "Site hazard report",
    feedbackBehaviour: "ON_RELEASE",
    availableUntil: "2026-09-15T00:00",
    dueAt: "2026-09-14T23:39",
    maxFileSizeBytes: "10485760",
    totalMarks: "100",
    allowResubmission: "on",
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  data.append("allowedFileTypes", ".pdf");
  return data;
}

const PREVIOUS_STATE = { ok: null as boolean | null, errors: [], message: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.notFound.mockImplementation(() => {
    throw new Error(NOT_FOUND);
  });
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  });
});

// ---------------------------------------------------------------------------
// List route — access and scope-denial parity (T-10-25).
// ---------------------------------------------------------------------------

describe("assessments list route", () => {
  it("renders for an actor whose grant covers the Course, surfacing title/type/version", async () => {
    mocks.courseGet.mockResolvedValue({ id: "course-1" });
    mocks.assessmentList.mockResolvedValue([
      { id: "a1", title: "Module 1 Quiz", type: "QUIZ", status: "DRAFT", version: 1 },
      { id: "a2", title: "Final Project", type: "ASSIGNMENT", status: "PUBLISHED", version: 2 },
    ]);

    const element = (await runList()) as { props: { rows?: unknown; denied?: unknown } };

    expect(element.props.denied).toBeUndefined();
    expect(element.props.rows).toEqual([
      { id: "a1", title: "Module 1 Quiz", type: "QUIZ", status: "DRAFT", version: 1 },
      { id: "a2", title: "Final Project", type: "ASSIGNMENT", status: "PUBLISHED", version: 2 },
    ]);
    expect(mocks.assessmentList).toHaveBeenCalledWith({
      where: { courseId: "course-1" },
      scope: { courseIds: ["course-1"] },
    });
  });

  it("renders a denial — never an empty table — when the actor's grant covers a different Course", async () => {
    mocks.courseGet.mockResolvedValue({ id: "course-1" });
    mocks.assessmentList.mockRejectedValue(new AuthorizationError("scope mismatch"));

    const element = (await runList()) as {
      props: { rows?: unknown; denied?: { permission: string } };
    };

    // A scope leak dressed as data: an empty `rows: []` would read as "this
    // course has no assessments." The denial must be its own distinct prop,
    // not an empty collection (T-10-25).
    expect(element.props.rows).toBeUndefined();
    expect(element.props.denied).toEqual({ permission: "courses.view" });
  });

  it("hides existence on a denied Course lookup, same as a missing course", async () => {
    mocks.courseGet.mockRejectedValue(new AuthorizationError("denied"));

    await expect(runList()).rejects.toThrow(NOT_FOUND);
    expect(mocks.notFound).toHaveBeenCalled();
    expect(mocks.assessmentList).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// createAssessmentAction — zod boundary validation (T-10-13).
// ---------------------------------------------------------------------------

describe("createAssessmentAction", () => {
  it("rejects a feedbackBehaviour outside FEEDBACK_BEHAVIOURS before the service is called", async () => {
    const result = await createAssessmentAction(
      PREVIOUS_STATE,
      quizFormData({ feedbackBehaviour: "SOMETIMES" }),
    );

    expect(result).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.objectContaining({ name: "feedbackBehaviour" })]),
    });
    expect(mocks.assessmentCreate).not.toHaveBeenCalled();
  });

  it("rejects a missing type before the service is called", async () => {
    const data = quizFormData();
    data.delete("type");

    const result = await createAssessmentAction(PREVIOUS_STATE, data);

    expect(result.ok).toBe(false);
    expect(mocks.assessmentCreate).not.toHaveBeenCalled();
  });

  it("rejects a type outside QUIZ/ASSIGNMENT before the service is called", async () => {
    const result = await createAssessmentAction(PREVIOUS_STATE, quizFormData({ type: "ESSAY" }));

    expect(result.ok).toBe(false);
    expect(mocks.assessmentCreate).not.toHaveBeenCalled();
  });

  it("creates a valid Quiz and redirects to its edit route", async () => {
    mocks.assessmentCreate.mockResolvedValue({ id: "a1" });

    await expect(createAssessmentAction(PREVIOUS_STATE, quizFormData())).rejects.toThrow(
      "NEXT_REDIRECT:/staff/courses/course-1/assessments/a1",
    );

    expect(mocks.assessmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: "course-1", type: "QUIZ", title: "Module 1 Quiz" }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1);
  });
});

describe("updateAssessmentAction", () => {
  it("coerces datetime-local assessment fields to Dates before the Prisma-backed service", async () => {
    mocks.assessmentUpdate.mockResolvedValue({ id: "a1" });

    expect(await updateAssessmentAction("a1", PREVIOUS_STATE, assignmentFormData())).toEqual({
      ok: true,
      errors: [],
      message: null,
    });

    const data = mocks.assessmentUpdate.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(data.availableUntil).toEqual(new Date("2026-09-14T23:00:00.000Z"));
    expect(data.dueAt).toEqual(new Date("2026-09-14T22:39:00.000Z"));
  });

  it("rejects an invalid datetime-local value before the service is called", async () => {
    const result = await updateAssessmentAction(
      "a1",
      PREVIOUS_STATE,
      assignmentFormData({ availableUntil: "not-a-date" }),
    );

    expect(result).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.objectContaining({ name: "availableUntil" })]),
    });
    expect(mocks.assessmentUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// publishAssessmentAction — readiness-gated, never a silent partial publish.
// ---------------------------------------------------------------------------

describe("publishAssessmentAction", () => {
  it("returns the blocking ReadinessItem[] — not a thrown error — when the service refuses to publish", async () => {
    const failures = [
      {
        id: "assessment.pass-mark",
        category: "Grading",
        label: "Pass mark",
        state: "FAIL",
        blocking: true,
        detail: "Pass mark 80 exceeds total marks 50.",
      },
    ];
    mocks.publishAssessment.mockRejectedValue(new AssessmentNotPublishableError(failures));

    const result = await publishAssessmentAction({ assessmentId: "a1" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe("assessment.pass-mark");
    }
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("publishes a valid assessment and calls the revalidation API exactly once", async () => {
    mocks.publishAssessment.mockResolvedValue({
      courseId: "course-1",
      status: "PUBLISHED",
      version: 2,
    });

    const result = await publishAssessmentAction({ assessmentId: "a1" });

    expect(result).toEqual({ ok: true, status: "PUBLISHED", version: 2 });
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/staff/courses/course-1/assessments");
  });
});

// ---------------------------------------------------------------------------
// Source-level assertion: no file under assessments/ imports @prisma/client.
// AST-based (TypeScript compiler API), not a text/regex search — a mention
// inside a comment or string literal must stay invisible to this check.
// ---------------------------------------------------------------------------

const ASSESSMENTS_ROOT = path.resolve(
  process.cwd(),
  "src",
  "app",
  "staff",
  "courses",
  "[id]",
  "assessments",
);

function walkSourceFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkSourceFiles(full));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      results.push(full);
    }
  }
  return results;
}

function importsPrismaClient(filePath: string): boolean {
  const source = readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  return sourceFile.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === "@prisma/client",
  );
}

describe("assessment routes — the @prisma/client boundary (T-10-07)", () => {
  it("walks every .ts/.tsx file under src/app/staff/courses/[id]/assessments and finds zero @prisma/client imports", () => {
    const files = walkSourceFiles(ASSESSMENTS_ROOT);

    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter(importsPrismaClient);
    expect(offenders).toEqual([]);
  });
});
