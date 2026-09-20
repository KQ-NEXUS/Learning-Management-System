import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * Plan 10-13: the grade-entry screen's Server Actions (ASM-05, ASM-06,
 * D-07) — the zod boundary in front of `grading-service.ts`/
 * `grade-override-service.ts`, mapped refusals, and the `@prisma/client`
 * folder-boundary invariant.
 *
 * The two service modules are mocked with `importOriginal` so the REAL
 * error classes flow through (their `instanceof` identity matters to the
 * action's error mapping) while only the mutating functions themselves are
 * replaced — mirroring `tests/learner-quiz-attempt-route.test.ts`'s exact
 * pattern for the same reason.
 */

const m = vi.hoisted(() => ({
  saveDraftGrade: vi.fn(),
  releaseGrade: vi.fn(),
  overrideGrade: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));

vi.mock("@/server/services/grading-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/services/grading-service")>();
  return { ...actual, saveDraftGrade: m.saveDraftGrade, releaseGrade: m.releaseGrade };
});

vi.mock("@/server/services/grade-override-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/services/grade-override-service")>();
  return { ...actual, overrideGrade: m.overrideGrade };
});

import {
  saveDraftGradeAction,
  releaseGradeAction,
  overrideGradeAction,
} from "@/app/staff/cohorts/[id]/grading/[assessmentId]/[submissionId]/actions";
import {
  GradeAlreadyReleasedError,
  GradeNotFoundError,
} from "@/server/services/grading-service";
import { GradeNotReleasedError } from "@/server/services/grade-override-service";

const base = { cohortId: "c1", assessmentId: "a1", submissionId: "s1" };

beforeEach(() => {
  vi.clearAllMocks();
  m.saveDraftGrade.mockResolvedValue({ id: "g1", status: "DRAFT", score: 8, gradedAt: new Date("2026-03-01T00:00:00Z") });
  m.releaseGrade.mockResolvedValue({ id: "g1", status: "RELEASED" });
  m.overrideGrade.mockResolvedValue({ override: { id: "o1" }, grade: { id: "g1", score: 9 }, overrides: [] });
});

describe("saveDraftGradeAction", () => {
  it("delegates to the service and revalidates on success", async () => {
    const result = await saveDraftGradeAction({ ...base, score: 8, feedback: "Nice work" });
    expect(result).toEqual({ ok: true, grade: expect.objectContaining({ id: "g1" }) });
    expect(m.saveDraftGrade).toHaveBeenCalledExactlyOnceWith({ submissionId: "s1", score: 8, feedback: "Nice work" });
    expect(m.revalidatePath).toHaveBeenCalled();
  });

  it("maps GradeAlreadyReleasedError to a form-level error, not a throw", async () => {
    m.saveDraftGrade.mockRejectedValue(new GradeAlreadyReleasedError("g1"));
    const result = await saveDraftGradeAction({ ...base, score: 8, feedback: null });
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty("message");
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a non-integer score at the zod boundary before the service is called", async () => {
    const result = await saveDraftGradeAction({ ...base, score: 8.5, feedback: null });
    expect(result.ok).toBe(false);
    expect(m.saveDraftGrade).not.toHaveBeenCalled();
  });
});

describe("releaseGradeAction", () => {
  it("calls release exactly once and revalidates on success", async () => {
    const result = await releaseGradeAction({ ...base, gradeId: "g1" });
    expect(result).toEqual({ ok: true, grade: expect.objectContaining({ status: "RELEASED" }) });
    expect(m.releaseGrade).toHaveBeenCalledExactlyOnceWith({ gradeId: "g1" });
    expect(m.revalidatePath).toHaveBeenCalledTimes(3);
  });

  it("maps GradeNotFoundError to a form-level error, not a throw", async () => {
    m.releaseGrade.mockRejectedValue(new GradeNotFoundError("g1"));
    const result = await releaseGradeAction({ ...base, gradeId: "g1" });
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty("message");
  });
});

describe("overrideGradeAction", () => {
  it("rejects a reason shorter than 10 characters at the zod boundary, before the service is called", async () => {
    const result = await overrideGradeAction({ ...base, gradeId: "g1", newScore: 9, reason: "too short" });
    expect(result).toMatchObject({ ok: false, field: "reason" });
    expect(m.overrideGrade).not.toHaveBeenCalled();
  });

  it("rejects a whitespace-only reason", async () => {
    const result = await overrideGradeAction({ ...base, gradeId: "g1", newScore: 9, reason: "           " });
    expect(result).toMatchObject({ ok: false, field: "reason" });
    expect(m.overrideGrade).not.toHaveBeenCalled();
  });

  it("calls override exactly once with the trimmed reason and revalidates on success", async () => {
    const result = await overrideGradeAction({ ...base, gradeId: "g1", newScore: 9, reason: "  Recount confirmed a marking error  " });
    expect(result.ok).toBe(true);
    expect(m.overrideGrade).toHaveBeenCalledExactlyOnceWith({
      gradeId: "g1",
      newScore: 9,
      reason: "Recount confirmed a marking error",
    });
    expect(m.revalidatePath).toHaveBeenCalledTimes(3);
  });

  it("maps GradeNotReleasedError to a form-level error, not a throw", async () => {
    m.overrideGrade.mockRejectedValue(new GradeNotReleasedError());
    const result = await overrideGradeAction({ ...base, gradeId: "g1", newScore: 9, reason: "Recount confirmed a marking error" });
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty("message");
  });
});

// ---------------------------------------------------------------------------
// Source-level assertion: no file under this route directory imports
// @prisma/client. AST-based (TypeScript compiler API), not a text/regex
// search — a mention inside a comment or string literal must stay invisible.
// ---------------------------------------------------------------------------

const ROUTE_ROOT = path.resolve(
  process.cwd(),
  "src",
  "app",
  "staff",
  "cohorts",
  "[id]",
  "grading",
  "[assessmentId]",
  "[submissionId]",
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

describe("grade-entry route — the @prisma/client boundary (T-10-03)", () => {
  it("walks every .ts/.tsx file under the [submissionId] route and finds zero @prisma/client imports", () => {
    const files = walkSourceFiles(ROUTE_ROOT);

    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter(importsPrismaClient);
    expect(offenders).toEqual([]);
  });
});
