/**
 * Phase 6 close-out — executable phase-wide invariants (06-09).
 *
 * Nine plans each asserted a slice of "Stripe-specific code stays behind
 * the provider boundary" (PAY-09) and "only the webhook writes a paid
 * order" (PAY-10) in prose. This file turns those two assertions into
 * mechanical, TypeScript-compiler-API-based source scans — not a raw-text
 * regex, which would false-positive on a comment or a doc string and be the
 * exact reason a gate like this gets quietly deleted six months later.
 *
 * Deliberately NOT re-asserted here: the actorless-settlement invariant.
 * `tests/boundary.test.ts` already owns a runtime-import-closure assertion
 * proving the Stripe webhook route's closure never touches the permission
 * choke point or the request-scoped actor getter — that is a distinct,
 * already-covered property, and duplicating it here is how one of the two
 * copies silently stops being maintained.
 */

import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".mjs", ".js", ".jsx"];

/** The directory prefix PAY-09's exemption is expressed against — not a
 * per-file allowlist. A fourth provider module landing inside this
 * directory later needs no edit here to stay exempt. */
const STRIPE_PROVIDER_DIR = path.join("server", "payments", "providers", "stripe");

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

/**
 * Every module specifier this file imports (or re-exports) from, via the
 * compiler API's own `ImportDeclaration`/`ExportDeclaration` nodes — never a
 * text search over the raw source, so a specifier mentioned inside a
 * comment or a string literal is invisible to this walk.
 */
function importSpecifiers(filePath: string): string[] {
  const sourceFile = parse(filePath);
  const specifiers: string[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      specifiers.push(statement.moduleSpecifier.text);
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      specifiers.push(statement.moduleSpecifier.text);
    }
  }
  return specifiers;
}

function isInsideProviderDir(filePath: string, root: string): boolean {
  const rel = path.relative(root, filePath);
  return rel === STRIPE_PROVIDER_DIR || rel.startsWith(STRIPE_PROVIDER_DIR + path.sep);
}

export type ProviderIsolationViolation = { file: string; specifier: string };

/**
 * PAY-09's mechanical form: every file under `root` outside the Stripe
 * provider directory must import neither the `stripe` package itself nor
 * any of its namespaced types — and since the package's types are only ever
 * reachable through an import of the `"stripe"` specifier (value or
 * type-only), checking the specifier catches both.
 */
function findProviderIsolationViolations(root: string): ProviderIsolationViolation[] {
  const violations: ProviderIsolationViolation[] = [];
  for (const file of walkSourceFiles(root)) {
    if (isInsideProviderDir(file, root)) continue;
    for (const specifier of importSpecifiers(file)) {
      if (specifier === "stripe") {
        violations.push({ file: path.relative(process.cwd(), file), specifier });
      }
    }
  }
  return violations;
}

/** Throws, naming every offending file, when the provider-isolation scan is not clean. */
function assertNoProviderIsolationViolations(violations: ProviderIsolationViolation[]): void {
  if (violations.length === 0) return;
  const details = violations.map((v) => `  ${v.file} imports "${v.specifier}"`).join("\n");
  throw new Error(
    `PAY-09 provider isolation violated — the following file(s) outside ` +
      `src/${STRIPE_PROVIDER_DIR.replace(/\\/g, "/")}/ import the Stripe SDK or one of its ` +
      `namespaced types:\n${details}`,
  );
}

export type PaidOrderWriter = { file: string };

/**
 * True when `filePath` contains an object-literal property assignment
 * `status: "PAID"` — the shape every write site in this codebase uses for a
 * Prisma `data: { ... }` argument. AST-based, so `order.status === "PAID"`
 * (a comparison, not a write — a `BinaryExpression`, not a
 * `PropertyAssignment`) and a string mentioning the words inside a comment
 * are both structurally invisible to this walk.
 */
function writesPaidOrderStatus(filePath: string): boolean {
  const sourceFile = parse(filePath);
  let found = false;
  function visit(node: ts.Node): void {
    if (found) return;
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "status" &&
      ts.isStringLiteral(node.initializer) &&
      node.initializer.text === "PAID"
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

/** PAY-10's mechanical form: every module under `root` that writes `Order.status = "PAID"`. */
function findPaidOrderWriters(root: string): PaidOrderWriter[] {
  return walkSourceFiles(root)
    .filter((file) => writesPaidOrderStatus(file))
    .map((file) => ({ file: path.relative(process.cwd(), file) }));
}

const SETTLEMENT_SERVICE_SUFFIX = "src/server/services/checkout-webhook-system-service.ts";

/** Throws, naming every writer, unless exactly one exists and it is the settlement service. */
function assertSinglePaidOrderWriter(writers: PaidOrderWriter[]): void {
  if (writers.length !== 1) {
    const details = writers.length > 0 ? writers.map((w) => `  ${w.file}`).join("\n") : "  (none found)";
    throw new Error(
      `PAY-10 single-paid-writer invariant violated — expected exactly one module writing ` +
        `Order.status = "PAID", found ${writers.length}:\n${details}`,
    );
  }
  const sole = writers[0].file.replace(/\\/g, "/");
  if (!sole.endsWith(SETTLEMENT_SERVICE_SUFFIX)) {
    throw new Error(
      `PAY-10 single-paid-writer invariant violated — the sole writer of Order.status = "PAID" is ` +
        `${writers[0].file}, expected it to be ${SETTLEMENT_SERVICE_SUFFIX}.`,
    );
  }
}

describe("phase-wide invariant: provider isolation (PAY-09)", () => {
  it("no file outside the Stripe provider directory imports the Stripe SDK or its namespaced types", () => {
    const violations = findProviderIsolationViolations(path.resolve(process.cwd(), "src"));
    expect(() => assertNoProviderIsolationViolations(violations)).not.toThrow();
  });

  it("names every offending file path when the isolation scan is made to fail (fixture)", () => {
    const tmpRoot = mkdtempSync(path.join(tmpdir(), "pay09-fixture-"));
    try {
      const exemptDir = path.join(tmpRoot, STRIPE_PROVIDER_DIR);
      const violatingDir = path.join(tmpRoot, "server", "services");
      mkdirSync(exemptDir, { recursive: true });
      mkdirSync(violatingDir, { recursive: true });

      // Exempt — inside the provider directory, must NOT be flagged.
      writeFileSync(path.join(exemptDir, "client.ts"), `import Stripe from "stripe";\nexport const s = Stripe;\n`);
      // Violating — a same-named import sitting one level outside the
      // provider directory, proving the exemption is a directory prefix and
      // not a filename coincidence.
      writeFileSync(
        path.join(violatingDir, "leaky-service.ts"),
        `import type Stripe from "stripe";\nexport type T = Stripe.Event;\n`,
      );
      // A comment mentioning the word must never trip the scan (AST, not regex).
      writeFileSync(
        path.join(violatingDir, "innocent.ts"),
        `// this file talks about stripe in a comment only, never imports it\nexport const x = 1;\n`,
      );

      const violations = findProviderIsolationViolations(tmpRoot);

      expect(violations).toHaveLength(1);
      expect(violations[0].file.replace(/\\/g, "/")).toContain("leaky-service.ts");
      expect(() => assertNoProviderIsolationViolations(violations)).toThrowError(/leaky-service\.ts/);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

describe("phase-wide invariant: single paid-order writer (PAY-10)", () => {
  it("exactly one module writes Order.status = \"PAID\", and it is the settlement service", () => {
    const writers = findPaidOrderWriters(path.resolve(process.cwd(), "src"));
    expect(() => assertSinglePaidOrderWriter(writers)).not.toThrow();
  });

  it("names every offending file path when a second writer is made to appear (fixture)", () => {
    const tmpRoot = mkdtempSync(path.join(tmpdir(), "pay10-fixture-"));
    try {
      const servicesDir = path.join(tmpRoot, "server", "services");
      mkdirSync(servicesDir, { recursive: true });

      writeFileSync(
        path.join(servicesDir, "checkout-webhook-system-service.ts"),
        `export function activate(tx: any) {\n  return tx.order.update({ where: { id: "1" }, data: { status: "PAID", paidAt: new Date() } });\n}\n`,
      );
      // A second, convenience write site — exactly the regression this
      // invariant exists to catch (a redirect handler or a staff action
      // marking an order paid without a verified webhook event behind it).
      writeFileSync(
        path.join(servicesDir, "order-shortcut-service.ts"),
        `export function shortcutPaid(tx: any) {\n  return tx.order.update({ where: { id: "1" }, data: { status: "PAID" } });\n}\n`,
      );
      // A read/comparison of the same status value must never be counted as a write.
      writeFileSync(
        path.join(servicesDir, "order-read-service.ts"),
        `export function isPaid(order: { status: string }) {\n  return order.status === "PAID";\n}\n`,
      );

      const writers = findPaidOrderWriters(tmpRoot);

      expect(writers).toHaveLength(2);
      const files = writers.map((w) => w.file.replace(/\\/g, "/"));
      expect(files.some((f) => f.includes("checkout-webhook-system-service.ts"))).toBe(true);
      expect(files.some((f) => f.includes("order-shortcut-service.ts"))).toBe(true);
      expect(files.some((f) => f.includes("order-read-service.ts"))).toBe(false);
      expect(() => assertSinglePaidOrderWriter(writers)).toThrowError(/order-shortcut-service\.ts/);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("rejects a lone writer that is not the settlement service (fixture)", () => {
    const tmpRoot = mkdtempSync(path.join(tmpdir(), "pay10-wrong-writer-"));
    try {
      const servicesDir = path.join(tmpRoot, "server", "services");
      mkdirSync(servicesDir, { recursive: true });
      writeFileSync(
        path.join(servicesDir, "some-other-service.ts"),
        `export function f(tx: any) {\n  return tx.order.update({ where: { id: "1" }, data: { status: "PAID" } });\n}\n`,
      );

      const writers = findPaidOrderWriters(tmpRoot);
      expect(writers).toHaveLength(1);
      expect(() => assertSinglePaidOrderWriter(writers)).toThrowError(/some-other-service\.ts/);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
