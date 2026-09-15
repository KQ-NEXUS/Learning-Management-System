/**
 * Phase 10 conventions need executable gates: comments cannot keep a future
 * import from widening learner authorization or a write from changing a released
 * score. Scan syntax rather than source text so documentation cannot trip a gate.
 * Behavioral service tests additionally exercise ownership and race boundaries.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { runtimeImports } from "./import-graph";

const services = path.resolve("src/server/services");
const service = (name: string) => path.join(services, name);
const parse = (file: string) => ts.createSourceFile(
  file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true,
);

function nodes<T extends ts.Node>(root: ts.Node, guard: (node: ts.Node) => node is T): T[] {
  const found: T[] = [];
  function visit(node: ts.Node): void {
    if (guard(node)) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(root);
  return found;
}

function identifiers(root: ts.Node, name: string) {
  return nodes(root, ts.isIdentifier).filter(node => node.text === name);
}

function permissionImport(specifier: string) {
  return specifier === "@/server/permissions" ||
    specifier.startsWith("@/server/permissions/") || specifier.endsWith("with-permission");
}

function files(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(root, entry.name);
    return entry.isDirectory() ? files(file) :
      [".ts", ".tsx"].includes(path.extname(file)) ? [file] : [];
  });
}

function namedFunction(root: ts.Node, name: string): ts.Node {
  const declaration = nodes(root, ts.isFunctionDeclaration).find(node => node.name?.text === name);
  if (declaration?.body) return declaration.body;
  const variable = nodes(root, ts.isVariableDeclaration).find(node =>
    ts.isIdentifier(node.name) && node.name.text === name);
  expect(variable?.initializer, `Expected implementation of ${name}`).toBeDefined();
  return variable!.initializer!;
}

function calls(root: ts.Node, receiver: string, method: string) {
  return nodes(root, ts.isCallExpression).filter(node => {
    const expression = node.expression;
    if (!ts.isPropertyAccessExpression(expression) || expression.name.text !== method) return false;
    const target = expression.expression;
    return ts.isPropertyAccessExpression(target) ? target.name.text === receiver :
      ts.isIdentifier(target) && target.text === receiver;
  });
}

function property(root: ts.Node, name: string) {
  return nodes(root, ts.isPropertyAssignment).find(node =>
    (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && node.name.text === name);
}

function throws(root: ts.Node, error: string) {
  return nodes(root, ts.isThrowStatement).filter(node =>
    ts.isNewExpression(node.expression) && ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === error);
}

describe("Phase 10 assessment architecture", () => {
  it("keeps quiz scoring free of runtime imports", () => {
    expect(runtimeImports(service("quiz-scoring.ts"))).toEqual([]);
  });

  it("keeps readiness independent of database and permission modules", () => {
    expect(runtimeImports(service("assessment-readiness.ts")).filter(({ specifier }) =>
      specifier === "@prisma/client" || specifier === "@/server/db" || permissionImport(specifier),
    )).toEqual([]);
  });

  it("keeps learner services ownership scoped, allowing erased Actor type imports", () => {
    // DD-15 governs runtime authorization. An import type Actor is erased and
    // is already explicitly allowed by the Phase 9 gate and service contracts.
    for (const name of ["attempt-service.ts", "submission-service.ts", "learner-results-service.ts"]) {
      expect(runtimeImports(service(name)).filter(({ specifier }) => permissionImport(specifier)), name).toEqual([]);
      expect(identifiers(parse(service(name)), "withPermission"), name).toEqual([]);
    }
  });

  it("derives enrolment selectors from the actor's ACTIVE owned set", () => {
    // Wave 4 intentionally supports a disambiguation hint for learners enrolled
    // in multiple cohorts. The old plan's blanket parameter ban would remove
    // that supported behavior; instead protect its actual ownership derivation.
    for (const [name, resolver] of [
      ["attempt-service.ts", "resolveOwnEnrolmentForCourse"],
      ["submission-service.ts", "resolveOwnEnrolmentForCourse"],
      ["learner-results-service.ts", "contexts"],
    ]) {
      const body = namedFunction(parse(service(name)), resolver);
      const reads = calls(body, "enrolment", "findMany");
      expect(reads, name).toHaveLength(1);
      const where = property(reads[0], "where")!.initializer;
      expect(property(where, "status")!.initializer).toMatchObject({ text: "ACTIVE" });
      const owner = property(where, "userId");
      // Submission's helper accepts userId as a positional parameter, passed
      // from actor.userId at every call; the others use actor.userId directly.
      if (name === "submission-service.ts") {
        expect(nodes(where, ts.isShorthandPropertyAssignment).some(node => node.name.text === "userId")).toBe(true);
        const invocations = nodes(parse(service(name)), ts.isCallExpression).filter(node =>
          ts.isIdentifier(node.expression) && node.expression.text === resolver);
        expect(invocations.length).toBeGreaterThan(0);
        for (const call of invocations) expect(call.arguments[0].getText()).toBe("actor.userId");
      } else {
        expect(owner?.initializer.getText()).toBe("actor.userId");
      }
      if (resolver !== "contexts") {
        expect(nodes(body, ts.isContinueStatement).some(node => {
          const condition = node.parent;
          return ts.isIfStatement(condition) &&
            nodes(condition.expression, ts.isBinaryExpression).some(binary =>
              binary.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken &&
              ts.isPropertyAccessExpression(binary.left) && binary.left.name.text === "id");
        }), name).toBe(true);
      }
    }
  });

  it("keeps assessment scope free of permission value imports", () => {
    expect(runtimeImports(service("assessment-scope.ts")).filter(({ specifier }) => permissionImport(specifier))).toEqual([]);
  });

  it("guards draft score writes and reserves GradeOverride creation for the override service", () => {
    const source = parse(service("grading-service.ts"));
    expect(nodes(source, ts.isClassDeclaration).some(node => node.name?.text === "GradeAlreadyReleasedError")).toBe(true);
    const body = namedFunction(source, "saveDraftGrade");
    const guards = throws(body, "GradeAlreadyReleasedError");
    const writes = [...calls(body, "grade", "create"), ...calls(body, "grade", "update")];
    expect(guards.length).toBeGreaterThan(0);
    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) expect(guards[0].pos).toBeLessThan(write.pos);
    for (const update of calls(body, "grade", "update")) {
      expect(property(property(update, "where")!.initializer, "status")!.initializer).toMatchObject({ text: "DRAFT" });
    }
    // Lexical guard ordering is paired with grading-service behavioral tests;
    // an AST cannot prove control-flow semantics of arbitrary delegated calls.
    const creators = files(services).filter(file => calls(parse(file), "gradeOverride", "create").length);
    expect(creators.map(file => path.basename(file))).toEqual(["grade-override-service.ts"]);
  });

  it("throws missing-reason and unreleased-grade errors before override writes", () => {
    const body = namedFunction(parse(service("grade-override-service.ts")), "overrideGrade");
    const writes = [
      ...calls(body, "grade", "updateMany"), ...calls(body, "gradeOverride", "create"),
    ];
    expect(writes).toHaveLength(2);
    for (const error of ["OverrideReasonRequiredError", "GradeNotReleasedError"]) {
      const guards = throws(body, error);
      expect(guards).toHaveLength(1);
      for (const write of writes) expect(guards[0].pos).toBeLessThan(write.pos);
    }
  });

  it("keeps assessment, grading and learner results routes behind services", () => {
    for (const root of [
      "src/app/staff/courses/[id]/assessments",
      "src/app/staff/cohorts/[id]/grading",
      "src/app/(learner)/learn/[enrolmentId]/results",
    ]) {
      const routeFiles = files(path.resolve(root));
      expect(routeFiles.length, root).toBeGreaterThan(0);
      for (const file of routeFiles) {
        expect(nodes(parse(file), ts.isImportDeclaration).filter(node =>
          ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === "@prisma/client"), file).toEqual([]);
      }
    }
  });

  it("adds no invented assessment or release permissions to the closed catalogue", () => {
    const literals = nodes(parse(path.resolve("src/server/permissions/catalogue.ts")), ts.isStringLiteral);
    expect(literals.filter(node => ["assessments.view", "grades.release", "grades.batch_release"].includes(node.text))).toEqual([]);
  });

  it("adds neither AssessmentPublication nor a separate cutoffAt schema field", () => {
    // Prisma has no installed public AST parser here. Tokenize its source with
    // comments/trivia excluded rather than text-searching documentation. Scope
    // this gate to forbidden declaration tokens; migration tests validate DDL.
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, true);
    scanner.setText(readFileSync(path.resolve("prisma/schema.prisma"), "utf8"));
    const tokens: string[] = [];
    for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
      if (token === ts.SyntaxKind.Identifier) tokens.push(scanner.getTokenText());
    }
    expect(tokens).not.toContain("cutoffAt");
    expect(tokens.some((token, index) => token === "model" && tokens[index + 1] === "AssessmentPublication")).toBe(false);
  });

  it("releases a batch in one transaction without repeated permission wrappers", () => {
    const source = parse(service("grading-service.ts"));
    const body = namedFunction(source, "releaseGradesBatch");
    expect(calls(body, "deps", "runInTransaction")).toHaveLength(1);
    expect(identifiers(body, "releaseGrade")).toEqual([]);
    for (const loop of nodes(source, ts.isForOfStatement)) {
      expect(identifiers(loop, "withPermission")).toEqual([]);
      expect(identifiers(loop, "releaseGrade")).toEqual([]);
    }
  });
});
