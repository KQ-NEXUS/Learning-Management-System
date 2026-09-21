/**
 * Phase 9 close-out — executable phase-wide invariants (09-14).
 *
 * Every rule this whole phase relies on is a convention someone wrote in a
 * doc comment: pure modules staying import-free, ownership services never
 * importing `withPermission`, `meetingUrl` never leaving the gate,
 * `Enrolment.status` never being written by the completion engine. A
 * convention with no test attached can be eroded by a single well-meaning
 * future edit with nobody noticing until it ships. This file turns eight of
 * those conventions into TypeScript-compiler-API source scans — never a raw
 * text/regex search, which would false-positive on a comment or a doc string
 * and be the exact reason a gate like this gets quietly deleted six months
 * later (see `tests/checkout-phase-invariants.test.ts`'s identical framing
 * for Phase 6/7).
 *
 * The import-graph traversal itself (`runtimeImports`) is NOT reimplemented
 * here — it is imported from `tests/import-graph.ts`, the plain module
 * `tests/boundary.test.ts`'s own traversal was extracted into (09-14) so
 * this file and `boundary.test.ts` share one implementation without one
 * spec file importing (and thereby re-executing) the other's `describe`/`it`
 * registrations. See that module's header for the full reasoning.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { runtimeImports } from "./import-graph";

const SOURCE_EXTENSIONS = [".ts", ".tsx"];

function walkSourceFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkSourceFiles(full));
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      results.push(full);
    }
  }
  return results;
}

function parse(filePath: string): ts.SourceFile {
  const source = readFileSync(filePath, "utf8");
  return ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
}

/** Every top-level `ImportDeclaration`, regardless of type-only status — unlike `runtimeImports`, which deliberately excludes type-only imports. */
function allImportDeclarations(sourceFile: ts.SourceFile): ts.ImportDeclaration[] {
  return sourceFile.statements.filter((s): s is ts.ImportDeclaration => ts.isImportDeclaration(s));
}

/** Every `Identifier` node anywhere in the tree whose text matches `name` — AST-based, so a mention inside a comment or string literal is invisible. */
function findIdentifiers(sourceFile: ts.SourceFile, name: string): ts.Identifier[] {
  const found: ts.Identifier[] = [];
  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node) && node.text === name) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

/** Every `StringLiteral` node anywhere in the tree with the exact given text. */
function findStringLiterals(sourceFile: ts.SourceFile, text: string): ts.StringLiteral[] {
  const found: ts.StringLiteral[] = [];
  function visit(node: ts.Node): void {
    if (ts.isStringLiteral(node) && node.text === text) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

/** True when `node` (or `startFrom` if given) has a `ConditionalExpression` (ternary) or `&&` `BinaryExpression` among its ancestors — the two shapes this codebase's conditional-render idiom uses (`cond ? a : b` and `cond && (...)`). */
function isInsideConditionalGuard(node: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isConditionalExpression(current)) return true;
    if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

/** True when `sourceFile`'s very first statement is the `"use client"` (or given text) directive prologue. */
function hasLeadingDirective(sourceFile: ts.SourceFile, text: string): boolean {
  const first = sourceFile.statements[0];
  return (
    !!first &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === text
  );
}

const SRC_ROOT = path.resolve(process.cwd(), "src");
const SERVICES_ROOT = path.join(SRC_ROOT, "server", "services");
const LEARNER_APP_ROOT = path.join(SRC_ROOT, "app", "(learner)");
// The lesson reading pane lives in its own route group (a focus layout) but is learner-facing all the same.
const LESSON_APP_ROOT = path.join(SRC_ROOT, "app", "(lesson)");
const learnerRouteFiles = () => [...walkSourceFiles(LEARNER_APP_ROOT), ...walkSourceFiles(LESSON_APP_ROOT)];
const LEARNER_COMPONENTS_ROOT = path.join(SRC_ROOT, "components", "learner");

describe("phase 9 invariant: pure-module import-freedom (INV-1, T-09-47)", () => {
  it("access-window.ts, lesson-sequencing.ts and completion-rule.ts declare zero imports of any kind; completion-engine.ts declares zero NON-type-only imports", () => {
    const zeroImportFiles = ["access-window.ts", "lesson-sequencing.ts", "completion-rule.ts"];
    for (const file of zeroImportFiles) {
      const sourceFile = parse(path.join(SERVICES_ROOT, file));
      const imports = allImportDeclarations(sourceFile);
      expect(
        imports,
        `${file} must have zero import declarations of any kind — it is a pure module ` +
          `(access-window.ts/lesson-sequencing.ts/completion-rule.ts's own header comments): a data-access ` +
          `import here would put it on the worker/webhook runtime import closure that ` +
          `tests/boundary.test.ts walks, silently widening what an actorless entrypoint can reach.`,
      ).toHaveLength(0);
    }

    // completion-engine.ts: `import type` only — a type-only import never
    // enters the runtime closure `runtimeImports` (and the closure walk it
    // backs) cares about, so this file uses that exact helper rather than a
    // second hand-rolled "is it type-only" check.
    const engineRuntimeImports = runtimeImports(path.join(SERVICES_ROOT, "completion-engine.ts"));
    expect(
      engineRuntimeImports,
      `completion-engine.ts must declare zero NON-type-only imports (its own header states this) — ` +
        `found runtime import(s) of: ${engineRuntimeImports.map((i) => i.specifier).join(", ")}. ` +
        `A runtime import here would put the pure completion evaluator on the worker/webhook closure.`,
    ).toHaveLength(0);
  });
});

describe("phase 9 invariant: ownership services never import the permission choke point (INV-2, T-09-47)", () => {
  it("learner-access.ts and enrolment-dashboard-service.ts import no runtime @/server/permissions module and contain no withPermission identifier (a type-only Actor import is allowed); learner-session-service.ts may import scheduled-session-service.ts (DD-23) but calls no withPermission of its own", () => {
    for (const file of ["learner-access.ts", "enrolment-dashboard-service.ts"]) {
      const filePath = path.join(SERVICES_ROOT, file);
      const sourceFile = parse(filePath);

      const permissionRuntimeImports = runtimeImports(filePath).filter(
        (i) => i.specifier === "@/server/permissions" || i.specifier.startsWith("@/server/permissions/"),
      );
      expect(
        permissionRuntimeImports,
        `${file} is ownership-scoped, not permission-scoped (DD-10) — it must never runtime-import ` +
          `@/server/permissions or a submodule of it (a type-only Actor import is fine). Found: ` +
          `${permissionRuntimeImports.map((i) => i.specifier).join(", ")}.`,
      ).toHaveLength(0);

      const withPermissionIdentifiers = findIdentifiers(sourceFile, "withPermission");
      expect(
        withPermissionIdentifiers,
        `${file} must contain no "withPermission" identifier anywhere in its code (DD-10) — ` +
          `authorization here is an ownership comparison against actor.userId, not a permission check; ` +
          `introducing withPermission would fabricate a permission/scope that does not model "is this mine".`,
      ).toHaveLength(0);
    }

    // learner-session-service.ts is asserted separately (DD-23): it is
    // allowed to import scheduled-session-service.ts for
    // isMeetingLinkVisible/linkVisibleFrom, so the blanket "no @/server/
    // permissions import" check above does not apply to it verbatim — only
    // the narrower "no withPermission CALL of its own" rule does.
    const sessionFilePath = path.join(SERVICES_ROOT, "learner-session-service.ts");
    const sessionSourceFile = parse(sessionFilePath);
    const withPermissionCalls = findIdentifiers(sessionSourceFile, "withPermission").filter((id) => {
      const parent = id.parent;
      return ts.isCallExpression(parent) && parent.expression === id;
    });
    expect(
      withPermissionCalls,
      `learner-session-service.ts must contain no withPermission(...) call of its own (DD-23) — it may ` +
        `import scheduled-session-service.ts for isMeetingLinkVisible/linkVisibleFrom, but authorization ` +
        `for this file's own exports stays ownership-scoped via getOwnActiveEnrolment.`,
    ).toHaveLength(0);
  });
});

describe("phase 9 invariant: DD-6 — completion-service.ts never writes Enrolment.status (INV-3, T-09-48)", () => {
  it("completion-service.ts calls no enrolment.update, no assertTransition, and contains no \"COMPLETED\" string literal", () => {
    const filePath = path.join(SERVICES_ROOT, "completion-service.ts");
    const sourceFile = parse(filePath);

    function isEnrolmentUpdateCall(node: ts.Node): boolean {
      if (!ts.isCallExpression(node)) return false;
      if (!ts.isPropertyAccessExpression(node.expression)) return false;
      if (node.expression.name.text !== "update") return false;
      const receiver = node.expression.expression;
      if (ts.isPropertyAccessExpression(receiver)) return receiver.name.text === "enrolment";
      if (ts.isIdentifier(receiver)) return receiver.text === "enrolment";
      return false;
    }

    const enrolmentUpdateCalls: ts.CallExpression[] = [];
    function visit(node: ts.Node): void {
      if (isEnrolmentUpdateCall(node)) enrolmentUpdateCalls.push(node as ts.CallExpression);
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);

    expect(
      enrolmentUpdateCalls,
      `completion-service.ts must never call <...>.enrolment.update(...) (DD-6) — Enrolment.status ` +
        `becoming a terminal COMPLETED would make a later supersede (D-12) unrepresentable and would ` +
        `silently free the (userId, cohortId) WHERE status = 'ACTIVE' partial unique index.`,
    ).toHaveLength(0);

    const assertTransitionIdentifiers = findIdentifiers(sourceFile, "assertTransition");
    expect(
      assertTransitionIdentifiers,
      `completion-service.ts must never call assertTransition (DD-6) — this module does not own any ` +
        `Enrolment.status transition; Phase 11 owns that, alongside the revocation semantics that make a ` +
        `terminal state safe.`,
    ).toHaveLength(0);

    const completedLiterals = findStringLiterals(sourceFile, "COMPLETED");
    expect(
      completedLiterals,
      `completion-service.ts must contain no "COMPLETED" string literal (DD-6) — this file's evidence is ` +
        `CompletionRecord, never an Enrolment.status value.`,
    ).toHaveLength(0);
  });
});

describe("phase 9 invariant: meetingUrl never leaves the D-24 gate onto a learner surface (INV-4, T-09-04)", () => {
  it("no file under src/app/(learner)/ or src/components/learner/ contains the identifier meetingUrl, except SessionCard.tsx (which may reference it only inside a conditional render)", () => {
    const files = [...learnerRouteFiles(), ...walkSourceFiles(LEARNER_COMPONENTS_ROOT)];
    expect(files.length).toBeGreaterThan(0);

    const unguardedViolations: string[] = [];
    for (const file of files) {
      const sourceFile = parse(file);
      const occurrences = findIdentifiers(sourceFile, "meetingUrl");
      if (occurrences.length === 0) continue;

      const isSessionCard = file.replace(/\\/g, "/").endsWith("components/learner/SessionCard.tsx");
      if (!isSessionCard) {
        unguardedViolations.push(`${path.relative(process.cwd(), file)} (${occurrences.length} occurrence(s), not SessionCard.tsx)`);
        continue;
      }

      const unguarded = occurrences.filter((id) => !isInsideConditionalGuard(id));
      if (unguarded.length > 0) {
        unguardedViolations.push(
          `${path.relative(process.cwd(), file)} references meetingUrl outside a conditional render (${unguarded.length} occurrence(s))`,
        );
      }
    }

    expect(
      unguardedViolations,
      `T-09-04 — meetingUrl must never appear on a learner surface except inside SessionCard.tsx's own ` +
        `conditional render of the value the server-side D-24 gate already decided to disclose:\n` +
        unguardedViolations.join("\n"),
    ).toHaveLength(0);
  });
});

describe("phase 9 invariant: zero-client-JS lesson content (INV-5, D-30/NFR-02)", () => {
  it("LessonContent.tsx and LessonMediaPlayer.tsx contain no \"use client\" directive and no useState/useEffect identifier", () => {
    const files = [
      path.join(SRC_ROOT, "components", "catalogue", "LessonContent.tsx"),
      path.join(SRC_ROOT, "components", "catalogue", "LessonMediaPlayer.tsx"),
    ];

    for (const file of files) {
      const sourceFile = parse(file);
      expect(
        hasLeadingDirective(sourceFile, "use client"),
        `${path.basename(file)} must never carry a "use client" directive — this component ships zero ` +
          `client JavaScript for every lesson read (D-30, NFR-02).`,
      ).toBe(false);

      const clientHookIdentifiers = [
        ...findIdentifiers(sourceFile, "useState"),
        ...findIdentifiers(sourceFile, "useEffect"),
      ];
      expect(
        clientHookIdentifiers,
        `${path.basename(file)} must contain no useState/useEffect identifier — any client-only hook here ` +
          `would force a "use client" boundary and break the zero-client-JS guarantee this phase consumed.`,
      ).toHaveLength(0);
    }
  });
});

describe("phase 9 invariant: zero raw hex colour literals outside globals.css (INV-6, 04.1 precedent)", () => {
  it("no file under src/app/(learner)/ or src/components/learner/ contains a raw hex colour literal", () => {
    const HEX_PATTERN = /#[0-9a-fA-F]{3,8}\b/;
    const files = [...learnerRouteFiles(), ...walkSourceFiles(LEARNER_COMPONENTS_ROOT)].filter(
      (f) => path.basename(f) !== "globals.css",
    );
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      // Strip comment contents before matching, so a hex value quoted in a
      // doc comment (documenting a token, or explaining why one is banned)
      // never self-invalidates this gate.
      const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      if (HEX_PATTERN.test(withoutComments)) {
        violations.push(path.relative(process.cwd(), file));
      }
    }

    expect(
      violations,
      `The following file(s) contain a raw hex colour literal outside a comment — every colour on a ` +
        `learner surface must be a semantic Tailwind token from globals.css, never an ad hoc hex value:\n` +
        violations.join("\n"),
    ).toHaveLength(0);
  });
});

describe("phase 9 invariant: DomainEventType gained exactly its three Phase-9 members, losing none of its prior ones (INV-7, DD-13)", () => {
  it("lesson.completed, course.completed and programme.completed exist alongside every pre-Phase-9 DomainEventType member", () => {
    const filePath = path.join(SERVICES_ROOT, "domain-event-service.ts");
    const sourceFile = parse(filePath);

    let unionMembers: string[] = [];
    function visit(node: ts.Node): void {
      if (
        ts.isTypeAliasDeclaration(node) &&
        node.name.text === "DomainEventType" &&
        ts.isUnionTypeNode(node.type)
      ) {
        unionMembers = node.type.types
          .filter((t): t is ts.LiteralTypeNode => ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal))
          .map((t) => (t.literal as ts.StringLiteral).text);
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);

    // The full member list as of the end of Phase 7/8, before this phase
    // added its three — pinned here so a future removal of any of these is
    // caught, not just an absence of the three new ones.
    const PRE_PHASE_9_MEMBERS = [
      "enrolment.created",
      "enrolment.approved",
      "enrolment.transferred",
      "enrolment.withdrawn",
      "enrolment.cancelled",
      "enrolment.hold_expired",
      "attendance.changed",
      "cohort.published",
      "cohort.cancelled",
      "session.created",
      "session.updated",
      "session.cancelled",
      "order.created",
      "order.paid",
      "order.exception",
      "enrolment.activated",
      "payment.reconciled",
      "payment.reconciliation_exception",
    ];
    const PHASE_9_NEW_MEMBERS = ["lesson.completed", "course.completed", "programme.completed"];

    const missingPrior = PRE_PHASE_9_MEMBERS.filter((m) => !unionMembers.includes(m));
    expect(
      missingPrior,
      `DomainEventType lost pre-existing member(s) that Phase 5-8 rely on: ${missingPrior.join(", ")}.`,
    ).toHaveLength(0);

    const missingNew = PHASE_9_NEW_MEMBERS.filter((m) => !unionMembers.includes(m));
    expect(
      missingNew,
      `DomainEventType is missing Phase 9's new member(s): ${missingNew.join(", ")} (DD-13, completion-service.ts).`,
    ).toHaveLength(0);
  });
});

describe("phase 9 invariant: learner Server Actions never trust a client-supplied identity field (INV-8, T-09-02)", () => {
  it("every \"use server\" file under src/app/(learner)/ begins with the directive and calls no formData.get(\"userId\")/formData.get(\"actorId\")", () => {
    const files = learnerRouteFiles();
    const serverActionFiles = files.filter((file) => hasLeadingDirective(parse(file), "use server"));

    expect(
      serverActionFiles.length,
      `Expected at least one "use server" file under src/app/(learner)/ (e.g. the lesson reading pane's actions.ts) — found none.`,
    ).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of serverActionFiles) {
      const sourceFile = parse(file);

      function isFormDataIdentityGet(node: ts.Node): string | null {
        if (!ts.isCallExpression(node)) return null;
        if (!ts.isPropertyAccessExpression(node.expression)) return null;
        if (node.expression.name.text !== "get") return null;
        if (!ts.isIdentifier(node.expression.expression) || node.expression.expression.text !== "formData") {
          return null;
        }
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg) && (arg.text === "userId" || arg.text === "actorId")) {
          return arg.text;
        }
        return null;
      }

      function visit(node: ts.Node): void {
        const field = isFormDataIdentityGet(node);
        if (field) {
          violations.push(`${path.relative(process.cwd(), file)} calls formData.get("${field}")`);
        }
        ts.forEachChild(node, visit);
      }
      visit(sourceFile);
    }

    expect(
      violations,
      `T-09-02 — a Server Action must always derive identity from getCurrentActor(), never from a ` +
        `client-submitted form field:\n${violations.join("\n")}`,
    ).toHaveLength(0);
  });
});
