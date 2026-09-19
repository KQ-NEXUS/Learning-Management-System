/**
 * Phase 11 close-out — executable phase-wide invariants (plan 11-16 Task 2).
 *
 * Sixteen plans each held a structural decision or a threat-model mitigation
 * in prose: exactly one PDF-rendering path (D-08), no headless-browser
 * dependency ever reintroduced (D-08's rejection), exactly one place that
 * mints a `verificationRef` (Pitfall 1's entropy decision), no caching
 * directive ever freezing a verification verdict or a presigned URL
 * (Pitfall 6), the public verification disclosure staying at exactly four
 * fields (CRD-04), certificates never hard-deleted (CAT-08, CRD-05), and
 * exactly one module ever moving `Enrolment.status` to `COMPLETED` (D-05).
 * This file turns each into a mechanical, TypeScript-compiler-API-based
 * source scan — not a raw-text regex, which would false-positive on a
 * comment (this phase's own `certificate-pdf-renderer.ts` header literally
 * contains the word "Puppeteer" in prose explaining why it does NOT use it)
 * and be the exact reason a gate like this gets quietly deleted later.
 * Mirrors `tests/checkout-phase-invariants.test.ts`'s established pattern.
 *
 * Deliberately NOT re-asserted here: `tests/boundary.test.ts` (plan 11-10)
 * already owns a `pdf-lib` single-importer gate and a runtime-closure
 * assertion keeping the Stripe webhook's import graph free of the PDF/
 * certificate stack. This file's own PDF-library invariant below is a
 * SEPARATE, independent implementation (a fresh AST walk, not a shared
 * helper import) so the two suites can never both silently rot in the same
 * commit — it complements that earlier gate rather than depending on it.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".mjs", ".js", ".jsx"];
const SRC_ROOT = path.resolve(process.cwd(), "src");

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

function relPath(filePath: string): string {
  return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
}

function parse(filePath: string): ts.SourceFile {
  const source = readFileSync(filePath, "utf8");
  return ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
}

type ImportedSpecifier = { specifier: string };

/** Every module specifier a file imports (or re-exports) from, via the
 *  compiler API's own import/export declaration nodes — a specifier
 *  mentioned inside a comment or a string literal elsewhere is invisible to
 *  this walk. Mirrors `tests/checkout-phase-invariants.test.ts`. */
function importSpecifiers(filePath: string): ImportedSpecifier[] {
  const sourceFile = parse(filePath);
  const specifiers: ImportedSpecifier[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      specifiers.push({ specifier: statement.moduleSpecifier.text });
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      specifiers.push({ specifier: statement.moduleSpecifier.text });
    }
  }
  return specifiers;
}

// ---------------------------------------------------------------------------
// Invariant 1 — the PDF library has exactly one importer (D-08).
// ---------------------------------------------------------------------------

function findPdfLibImporters(root: string): string[] {
  return walkSourceFiles(root)
    .filter((file) => importSpecifiers(file).some((s) => s.specifier === "pdf-lib"))
    .map(relPath);
}

describe("phase invariant 1 — pdf-lib has exactly one importer (D-08: prevents a second rendering path appearing)", () => {
  it("only certificate-pdf-renderer.ts imports pdf-lib under src/", () => {
    const importers = findPdfLibImporters(SRC_ROOT);
    expect(new Set(importers)).toEqual(new Set(["src/server/services/certificate-pdf-renderer.ts"]));
  });
});

// ---------------------------------------------------------------------------
// Invariant 2 — no browser-automation package is imported anywhere in src/
// (D-08's explicit rejection of HTML-to-PDF / headless-browser rendering).
// ---------------------------------------------------------------------------

const BROWSER_AUTOMATION_PACKAGES = ["puppeteer", "puppeteer-core", "playwright", "playwright-core", "chromium"];

function isBrowserAutomationSpecifier(specifier: string): boolean {
  return BROWSER_AUTOMATION_PACKAGES.some((name) => specifier === name || specifier.startsWith(`${name}/`));
}

function findBrowserAutomationImporters(root: string): { file: string; specifier: string }[] {
  const violations: { file: string; specifier: string }[] = [];
  for (const file of walkSourceFiles(root)) {
    for (const { specifier } of importSpecifiers(file)) {
      if (isBrowserAutomationSpecifier(specifier)) {
        violations.push({ file: relPath(file), specifier });
      }
    }
  }
  return violations;
}

describe("phase invariant 2 — no browser-automation package imported under src/ (D-08's explicit rejection)", () => {
  it("no file imports puppeteer, playwright, playwright-core, or chromium (the playwright-cli skill is a test tool and lives outside src/)", () => {
    const violations = findBrowserAutomationImporters(SRC_ROOT);
    expect(
      violations,
      `D-08 rejects a headless-browser rendering path — found: ${violations.map((v) => `${v.file} imports "${v.specifier}"`).join(", ")}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Invariant 3 — verificationRef values are generated in exactly one place
// (Pitfall 1: the entropy decision cannot be locally re-derived at a lower
// strength by a second, independently-written generator).
// ---------------------------------------------------------------------------

function callsRandomCryptoFunction(node: ts.Node): boolean {
  let hit = false;
  function inner(n: ts.Node): void {
    if (hit) return;
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : "";
      if (name === "randomUUID" || name === "randomBytes") hit = true;
    }
    if (!hit) ts.forEachChild(n, inner);
  }
  inner(node);
  return hit;
}

/** True when `filePath` defines a named function (declaration, or a
 *  const-arrow/function-expression) whose name mentions "verificationRef"
 *  (case-insensitive) and whose body calls a node:crypto random function —
 *  the shape `certificate-reference.ts`'s own `generateVerificationRef`
 *  takes. A second, independently-written generator anywhere else in src/
 *  trips this, regardless of what it names its output variable. */
function definesVerificationRefGenerator(filePath: string): boolean {
  const sourceFile = parse(filePath);
  let found = false;

  function visit(node: ts.Node): void {
    if (found) return;

    let name: string | null = null;
    let body: ts.Node | null = null;

    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      name = node.name.text;
      body = node.body;
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      name = node.name.text;
      body = node.initializer.body;
    }

    if (name && body && /verificationref/i.test(name) && callsRandomCryptoFunction(body)) {
      found = true;
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

function findVerificationRefGenerators(root: string): string[] {
  return walkSourceFiles(root).filter(definesVerificationRefGenerator).map(relPath);
}

describe("phase invariant 3 — verificationRef is generated in exactly one place (Pitfall 1's entropy decision)", () => {
  it("only certificate-reference.ts defines a function that mints a verificationRef from a crypto-random call", () => {
    const generators = findVerificationRefGenerators(SRC_ROOT);
    expect(new Set(generators)).toEqual(new Set(["src/server/services/certificate-reference.ts"]));
  });
});

// ---------------------------------------------------------------------------
// Invariant 4 — no route file under src/app/verify/ or
// src/app/api/certificates/ opts into caching (Pitfall 6: Next 16 Cache
// Components must never freeze a verification verdict or a presigned URL).
// ---------------------------------------------------------------------------

const CACHE_EXPORT_NAMES = new Set(["dynamic", "revalidate", "fetchCache"]);
const CACHE_ROUTE_DIRS = [
  "src/app/verify",
  "src/app/verify-certificate",
  "src/app/api/certificates",
];

function exportsCacheDirective(filePath: string): { name: string }[] {
  const sourceFile = parse(filePath);
  const hits: { name: string }[] = [];

  for (const statement of sourceFile.statements) {
    const hasExportModifier = ts.canHaveModifiers(statement)
      ? (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      : false;
    if (hasExportModifier && ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && CACHE_EXPORT_NAMES.has(decl.name.text)) {
          hits.push({ name: decl.name.text });
        }
      }
    }
  }

  function visitForUseCacheDirective(node: ts.Node): void {
    if (
      ts.isExpressionStatement(node) &&
      ts.isStringLiteral(node.expression) &&
      node.expression.text === "use cache"
    ) {
      hits.push({ name: "'use cache'" });
    }
    ts.forEachChild(node, visitForUseCacheDirective);
  }
  visitForUseCacheDirective(sourceFile);

  return hits;
}

function findCacheOptInViolations(): { file: string; name: string }[] {
  const violations: { file: string; name: string }[] = [];
  for (const dir of CACHE_ROUTE_DIRS) {
    const absDir = path.resolve(process.cwd(), dir);
    for (const file of walkSourceFiles(absDir)) {
      for (const hit of exportsCacheDirective(file)) {
        violations.push({ file: relPath(file), name: hit.name });
      }
    }
  }
  return violations;
}

describe("phase invariant 4 — no verify/certificates route opts into caching (Pitfall 6, Next 16 Cache Components)", () => {
  it("no file under src/app/verify/ or src/app/api/certificates/ exports dynamic/revalidate/fetchCache or declares 'use cache'", () => {
    const violations = findCacheOptInViolations();
    expect(
      violations,
      `A cached verification verdict or presigned URL is exactly what Pitfall 6 forbids — found: ${violations
        .map((v) => `${v.file} declares ${v.name}`)
        .join(", ")}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Invariant 5 — the public verification service selects exactly four
// Certificate fields (CRD-04's disclosure contract).
// ---------------------------------------------------------------------------

const VERIFICATION_SERVICE_FILE = path.resolve(
  process.cwd(),
  "src/server/services/certificate-verification-service.ts",
);
const EXPECTED_VERIFICATION_SELECT_KEYS = new Set(["status", "learnerName", "awardTitle", "issuedAt"]);

function findVerificationSelectKeys(filePath: string): string[] | null {
  const sourceFile = parse(filePath);
  let keys: string[] | null = null;

  function visit(node: ts.Node): void {
    if (keys !== null) return;
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "select" &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      keys = node.initializer.properties
        .filter(ts.isPropertyAssignment)
        .filter((p): p is ts.PropertyAssignment & { name: ts.Identifier } => ts.isIdentifier(p.name))
        .map((p) => p.name.text);
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return keys;
}

describe("phase invariant 5 — public verification selects exactly {status, learnerName, awardTitle, issuedAt} (CRD-04)", () => {
  it("certificate-verification-service.ts's Prisma select key set is exactly the four-field disclosure contract", () => {
    const keys = findVerificationSelectKeys(VERIFICATION_SERVICE_FILE);
    expect(keys, "certificate-verification-service.ts has no Prisma `select` object literal — the disclosure contract cannot be verified").not.toBeNull();
    expect(new Set(keys ?? [])).toEqual(EXPECTED_VERIFICATION_SELECT_KEYS);
  });
});

// ---------------------------------------------------------------------------
// Invariant 6 — Certificate is never hard-deleted (CAT-08, CRD-05).
// ---------------------------------------------------------------------------

function isDelegateCallOn(expr: ts.Expression, delegateName: string, methodNames: string[]): boolean {
  if (!ts.isCallExpression(expr)) return false;
  if (!ts.isPropertyAccessExpression(expr.expression)) return false;
  if (!methodNames.includes(expr.expression.name.text)) return false;
  const receiver = expr.expression.expression;
  if (!ts.isPropertyAccessExpression(receiver)) return false;
  return new RegExp(`^${delegateName}$`, "i").test(receiver.name.text);
}

function findCertificateHardDeletes(root: string): string[] {
  const violations = new Set<string>();
  for (const file of walkSourceFiles(root)) {
    const sourceFile = parse(file);
    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node) && isDelegateCallOn(node, "certificate", ["delete", "deleteMany"])) {
        violations.add(relPath(file));
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }
  return [...violations];
}

describe("phase invariant 6 — Certificate is never hard-deleted (CAT-08, CRD-05)", () => {
  it("no file under src/ calls certificate.delete or certificate.deleteMany", () => {
    const offenders = findCertificateHardDeletes(SRC_ROOT);
    expect(offenders, `CAT-08/CRD-05 forbid hard-deleting a Certificate — found in: ${offenders.join(", ")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Invariant 7 — Enrolment.status is set to COMPLETED by exactly one module
// (D-05).
// ---------------------------------------------------------------------------

function writesEnrolmentCompletedStatus(filePath: string): boolean {
  const sourceFile = parse(filePath);
  let found = false;

  function callWritesStatusCompleted(call: ts.CallExpression): boolean {
    let hit = false;
    function inner(n: ts.Node): void {
      if (hit) return;
      if (
        ts.isPropertyAssignment(n) &&
        ts.isIdentifier(n.name) &&
        n.name.text === "status" &&
        ts.isStringLiteral(n.initializer) &&
        n.initializer.text === "COMPLETED"
      ) {
        hit = true;
        return;
      }
      ts.forEachChild(n, inner);
    }
    for (const arg of call.arguments) inner(arg);
    return hit;
  }

  function visit(node: ts.Node): void {
    if (found) return;
    if (
      ts.isCallExpression(node) &&
      isDelegateCallOn(node, "enrolment", ["update", "updateMany"]) &&
      callWritesStatusCompleted(node)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

function findEnrolmentCompletedWriters(root: string): string[] {
  return walkSourceFiles(root).filter(writesEnrolmentCompletedStatus).map(relPath);
}

describe("phase invariant 7 — Enrolment.status -> COMPLETED is written by exactly one module (D-05)", () => {
  it("only certificate-issuance-service.ts writes Enrolment.status = \"COMPLETED\"", () => {
    const writers = findEnrolmentCompletedWriters(SRC_ROOT);
    expect(new Set(writers)).toEqual(new Set(["src/server/services/certificate-issuance-service.ts"]));
  });
});

// ---------------------------------------------------------------------------
// Invariant 8 — issuance never renders or stores a file (plan 11-30, CR-01b).
//
// A render or object-store call inside the caller's transaction can roll the
// caller's lesson-progress / attendance write back (a slow store exceeding
// Prisma's default 5 s interactive-transaction timeout, P2028, aborts the
// transaction no matter what is caught inside it). Issuance is therefore
// database-only; the PDF is produced by certificate-file-service.ts after
// commit. This scan is AST-based: prose in the header comment cannot trip it
// (or hide a violation).
// ---------------------------------------------------------------------------

const ISSUANCE_SERVICE_FILE = path.resolve(
  process.cwd(),
  "src/server/services/certificate-issuance-service.ts",
);
const FORBIDDEN_ISSUANCE_MODULES = ["@/server/services/certificate-pdf-renderer"];
const FORBIDDEN_ISSUANCE_STORAGE_NAMES = new Set(["putGeneratedCertificateObject", "getObjectBytes"]);
const FORBIDDEN_ISSUANCE_IDENTIFIERS = new Set([
  "renderCertificatePdf",
  "putGeneratedCertificateObject",
  "getObjectBytes",
  "parseCertificateTemplateLayout",
]);

function findIssuanceRenderViolations(filePath: string): string[] {
  const sourceFile = parse(filePath);
  const violations: string[] = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (FORBIDDEN_ISSUANCE_MODULES.includes(specifier)) {
      violations.push(`imports ${specifier}`);
    }
    if (specifier === "@/server/services/storage-service") {
      const named = statement.importClause?.namedBindings;
      if (named && ts.isNamedImports(named)) {
        for (const element of named.elements) {
          const imported = (element.propertyName ?? element.name).text;
          if (FORBIDDEN_ISSUANCE_STORAGE_NAMES.has(imported)) {
            violations.push(`imports ${imported} from storage-service`);
          }
        }
      }
    }
  }

  // Any live reference (call, alias, re-export) to the forbidden functions.
  // Identifier nodes never come from comments.
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && FORBIDDEN_ISSUANCE_IDENTIFIERS.has(node.text)) {
      violations.push(`references ${node.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return violations;
}

describe("phase invariant 8 — the issuance service never renders a PDF or writes an object (CR-01b)", () => {
  it("certificate-issuance-service.ts imports neither the renderer nor the object-store functions and never parses a layout", () => {
    expect(findIssuanceRenderViolations(ISSUANCE_SERVICE_FILE)).toEqual([]);
  });

  it("the scan is not vacuous: it flags a synthetic source that renders and stores", () => {
    const probe = path.resolve(process.cwd(), "tests", "__invariant8-probe__.ts");
    // Exercise the detector on in-memory source, not a file on disk.
    const source = [
      'import { renderCertificatePdf } from "@/server/services/certificate-pdf-renderer";',
      'import { putGeneratedCertificateObject } from "@/server/services/storage-service";',
      "// parseCertificateTemplateLayout in a comment is fine",
      "void renderCertificatePdf; void putGeneratedCertificateObject;",
    ].join("\n");
    const sourceFile = ts.createSourceFile(probe, source, ts.ScriptTarget.Latest, true);
    const identifiers: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && FORBIDDEN_ISSUANCE_IDENTIFIERS.has(node.text)) identifiers.push(node.text);
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    expect(identifiers).toContain("renderCertificatePdf");
    expect(identifiers).toContain("putGeneratedCertificateObject");
    expect(identifiers).not.toContain("parseCertificateTemplateLayout");
  });
});
