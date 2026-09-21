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

/** 07-04 — the second provider directory this generalized scan covers. */
const PAYSTACK_PROVIDER_DIR = path.join("server", "payments", "providers", "paystack");

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

type ImportedSpecifier = { specifier: string; typeOnly: boolean };

/**
 * Every module specifier this file imports (or re-exports) from, via the
 * compiler API's own `ImportDeclaration`/`ExportDeclaration` nodes — never a
 * text search over the raw source, so a specifier mentioned inside a
 * comment or a string literal is invisible to this walk. `typeOnly` is true
 * for `import type ... from "..."` and `export type ... from "..."` forms —
 * 07-04's Paystack rule (below) only cares about this shape, since a
 * type-only import is the only way to reach a provider's own request/
 * response TYPE from outside it, whereas a plain value import (calling the
 * adapter's exported function, exactly as `checkout-service.ts` already does
 * for `getStripe()`/`buildCheckoutSessionParams`) is the sanctioned,
 * pre-existing call shape for BOTH providers.
 */
function importSpecifiers(filePath: string): ImportedSpecifier[] {
  const sourceFile = parse(filePath);
  const specifiers: ImportedSpecifier[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      specifiers.push({
        specifier: statement.moduleSpecifier.text,
        typeOnly: statement.importClause?.isTypeOnly === true,
      });
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      specifiers.push({ specifier: statement.moduleSpecifier.text, typeOnly: statement.isTypeOnly === true });
    }
  }
  return specifiers;
}

function isInsideProviderDir(filePath: string, root: string, dir: string): boolean {
  const rel = path.relative(root, filePath);
  return rel === dir || rel.startsWith(dir + path.sep);
}

/**
 * One provider's isolation boundary, generalized (07-RESEARCH.md Pitfall 5 —
 * do not duplicate the scan function for a second provider):
 *
 *   - `specifiers`: exact module specifiers that are ALWAYS a violation when
 *     imported from outside `dir`, value or type-only alike — Stripe's own
 *     npm package, whose namespaced types are only ever reachable through
 *     this one specifier.
 *   - `typeOnlySpecifierPrefixes`: specifier prefixes that are a violation
 *     ONLY for a type-only import — Paystack's narrower concern, since there
 *     is no npm package to name (07-RESEARCH.md): the violation this rule
 *     actually guards against is a Paystack-specific request/response TYPE
 *     (e.g. `PaystackVerifiedTransaction`) leaking outside the adapter, not
 *     the ordinary value-level reuse of an exported function every call site
 *     in this codebase already relies on for Stripe.
 */
type ProviderIsolationRule = {
  dir: string;
  specifiers: string[];
  typeOnlySpecifierPrefixes?: string[];
};

const PROVIDER_ISOLATION_RULES: ProviderIsolationRule[] = [
  { dir: STRIPE_PROVIDER_DIR, specifiers: ["stripe"] },
  {
    dir: PAYSTACK_PROVIDER_DIR,
    specifiers: [],
    typeOnlySpecifierPrefixes: [
      "@/server/payments/providers/paystack/client",
      "@/server/payments/providers/paystack/initialize",
      "@/server/payments/providers/paystack/webhook",
      // 07-08 — refund.ts declares its own PaystackRefundRequest/
      // PaystackRefundOutcome types; refund-service.ts calls its exported
      // functions as plain VALUE imports (the sanctioned shape), never a
      // type-only one, exactly like every other Paystack call site outside
      // this directory.
      "@/server/payments/providers/paystack/refund",
    ],
  },
];

export type ProviderIsolationViolation = { file: string; specifier: string };

/**
 * PAY-09's mechanical form, generalized to a rule list (07-04) — ONE shared
 * file walk, not a second copy of it, per this file's own header comment and
 * 07-RESEARCH.md Pitfall 5. For each rule, every file under `root` outside
 * `rule.dir` must import neither an exact `rule.specifiers` entry nor,
 * type-only, a specifier starting with one of `rule.typeOnlySpecifierPrefixes`.
 */
function findProviderIsolationViolations(
  root: string,
  rules: ProviderIsolationRule[] = PROVIDER_ISOLATION_RULES,
): ProviderIsolationViolation[] {
  const violations: ProviderIsolationViolation[] = [];
  // ONE parse per file — `importSpecifiers` re-parses the source with the
  // TypeScript compiler API, which is the expensive step; calling it once
  // per file and checking every rule against the same result is what keeps
  // this scan linear in file count rather than in file-count-times-rules.
  for (const file of walkSourceFiles(root)) {
    const applicableRules = rules.filter((rule) => !isInsideProviderDir(file, root, rule.dir));
    if (applicableRules.length === 0) continue;
    for (const { specifier, typeOnly } of importSpecifiers(file)) {
      for (const rule of applicableRules) {
        const exactViolation = rule.specifiers.includes(specifier);
        const typeOnlyViolation =
          typeOnly && (rule.typeOnlySpecifierPrefixes ?? []).some((prefix) => specifier.startsWith(prefix));
        if (exactViolation || typeOnlyViolation) {
          violations.push({ file: path.relative(process.cwd(), file), specifier });
        }
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
    `PAY-09 provider isolation violated — the following file(s) import a provider SDK, ` +
      `or a provider-specific type from outside that provider's own directory:\n${details}`,
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

/**
 * 07-11 — the legacy `Cohort.priceMinor`/`Cohort.currency` pair's mechanical
 * form. Neither field survives full type-checker inference in this file (the
 * two existing invariants above deliberately don't build a `ts.Program` —
 * see this file's header — so "declared or inferred shape is a Cohort"
 * cannot mean full type inference here). Instead:
 *
 *   - `priceMinor` is flagged on ANY property access, unconditionally. No
 *     other model in this schema has ever had a field named `priceMinor`
 *     (Order/PaymentAttempt's snapshot columns are `baseAmountMinor`,
 *     `platformFeeMinor`, `gatewayFeeEstimateMinor`, `amountMinor`) — so "any
 *     `.priceMinor` access" and "a Cohort-shaped `.priceMinor` access" are
 *     the same set in this codebase. Flagging it unconditionally means one
 *     fewer place this invariant can silently miss a real regression.
 *   - `currency` genuinely is shared across several models (Order,
 *     PaymentAttempt, GatewayFeeSchedule, Refund all have their own), so it
 *     is flagged only when the base expression resolves to a Cohort-shaped
 *     identifier — tracked structurally: a parameter/variable whose type
 *     annotation names a Cohort-ish type (`Cohort`, `CohortRecord`,
 *     `CohortAggregateRow`, `PublicCohort`, ...), a variable initialized
 *     from a `<...>.cohort.<method>(...)` / `<...>.cohortDelegate.<method>(...)`
 *     call, or a `.map()`/`.forEach()` callback parameter propagated from
 *     either of those. `cohorts[i].currency` is covered by the same
 *     propagation through `ElementAccessExpression`.
 */
const LEGACY_COHORT_FIELD_NAMES = new Set(["priceMinor", "currency"]);

/**
 * Directory-prefix exemption for a deliberately reviewed compatibility site,
 * mirroring `STRIPE_PROVIDER_DIR`/`PAYSTACK_PROVIDER_DIR`'s shape above —
 * empty today. If a future phase needs one, add its directory here rather
 * than an ad hoc filename check, so the exemption is legible as a boundary,
 * not a one-off carve-out.
 */
const LEGACY_COHORT_PRICE_EXEMPT_DIRS: string[] = [];

export type LegacyCohortPriceViolation = { file: string; property: string };

function isCohortShapedTypeName(name: string): boolean {
  return /Cohort/.test(name);
}

/** Matches `<...>.cohort.findUnique(...)`, `<...>.cohortDelegate.findMany(...)`,
 *  `tx.cohort.update(...)`, etc. — any call whose receiver's own property
 *  name is `cohort` or `cohortDelegate`, case-insensitively. */
function isCohortDelegateCall(expr: ts.Expression): boolean {
  if (!ts.isCallExpression(expr)) return false;
  if (!ts.isPropertyAccessExpression(expr.expression)) return false;
  const receiver = expr.expression.expression;
  if (!ts.isPropertyAccessExpression(receiver)) return false;
  return /^cohort(Delegate)?$/i.test(receiver.name.text);
}

function unwrap(expr: ts.Expression): ts.Expression {
  let current = expr;
  while (
    ts.isAwaitExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** Array methods that preserve the element shape without transforming it —
 *  safe to recurse through when tracing whether a chain's base is
 *  cohort-shaped (`rows.filter(cb).map(cb2)`). Deliberately excludes
 *  `map`/`flatMap`/`reduce`, which can change the element shape entirely —
 *  those are handled by their own explicit, parameter-level propagation
 *  (see the `propagate` pass below), not by this base-chain check. */
const ARRAY_SHAPE_PRESERVING_METHODS = new Set(["filter", "sort", "slice", "reverse", "flat"]);

function findLegacyCohortPriceReads(root: string): LegacyCohortPriceViolation[] {
  const violations: LegacyCohortPriceViolation[] = [];

  for (const file of walkSourceFiles(root)) {
    if (LEGACY_COHORT_PRICE_EXEMPT_DIRS.some((dir) => isInsideProviderDir(file, root, dir))) continue;

    const sourceFile = parse(file);
    const cohortShapedNames = new Set<string>();

    function isCohortShapedExpr(expr: ts.Expression): boolean {
      const target = unwrap(expr);
      if (ts.isIdentifier(target)) return cohortShapedNames.has(target.text);
      if (ts.isElementAccessExpression(target)) return isCohortShapedExpr(target.expression);
      if (
        ts.isCallExpression(target) &&
        ts.isPropertyAccessExpression(target.expression) &&
        ARRAY_SHAPE_PRESERVING_METHODS.has(target.expression.name.text)
      ) {
        return isCohortShapedExpr(target.expression.expression);
      }
      return isCohortDelegateCall(target);
    }

    // Pass 1 — seed cohort-shaped identifiers from explicit type annotations
    // and from direct cohort-delegate call initializers.
    function seed(node: ts.Node): void {
      if (
        (ts.isParameter(node) || ts.isVariableDeclaration(node)) &&
        node.type &&
        ts.isTypeReferenceNode(node.type) &&
        ts.isIdentifier(node.name)
      ) {
        const typeName = node.type.typeName.getText(sourceFile);
        if (isCohortShapedTypeName(typeName)) cohortShapedNames.add(node.name.text);
      }
      if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
        if (isCohortShapedExpr(node.initializer)) cohortShapedNames.add(node.name.text);
      }
      ts.forEachChild(node, seed);
    }
    seed(sourceFile);

    // Pass 2 — propagate cohort-shape through `.map()`/`.forEach()` callbacks
    // whose receiver is already known cohort-shaped (covers the common
    // `rows.map((row) => ({ ...row.priceMinor... }))` transform shape).
    function propagate(node: ts.Node): void {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        (node.expression.name.text === "map" || node.expression.name.text === "forEach") &&
        isCohortShapedExpr(node.expression.expression) &&
        node.arguments.length > 0
      ) {
        const callback = node.arguments[0];
        if ((ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) && callback.parameters.length > 0) {
          const parameter = callback.parameters[0];
          if (ts.isIdentifier(parameter.name)) {
            cohortShapedNames.add(parameter.name.text);
          } else if (ts.isObjectBindingPattern(parameter.name)) {
            for (const element of parameter.name.elements) {
              if (!ts.isBindingElement(element) || !ts.isIdentifier(element.name)) continue;
              const propName = element.propertyName && ts.isIdentifier(element.propertyName)
                ? element.propertyName.text
                : element.name.text;
              if (LEGACY_COHORT_FIELD_NAMES.has(propName)) {
                violations.push({ file: path.relative(process.cwd(), file), property: propName });
              }
            }
          }
        }
      }
      ts.forEachChild(node, propagate);
    }
    propagate(sourceFile);

    // Pass 3 — flag actual reads: property access and destructuring.
    function visit(node: ts.Node): void {
      if (ts.isPropertyAccessExpression(node) && LEGACY_COHORT_FIELD_NAMES.has(node.name.text)) {
        const property = node.name.text;
        if (property === "priceMinor" || isCohortShapedExpr(node.expression)) {
          violations.push({ file: path.relative(process.cwd(), file), property });
        }
      }
      if (ts.isVariableDeclaration(node) && node.initializer && ts.isObjectBindingPattern(node.name)) {
        const baseIsCohortShaped = isCohortShapedExpr(node.initializer);
        for (const element of node.name.elements) {
          if (!ts.isBindingElement(element) || !ts.isIdentifier(element.name)) continue;
          const propName = element.propertyName && ts.isIdentifier(element.propertyName)
            ? element.propertyName.text
            : element.name.text;
          if (!LEGACY_COHORT_FIELD_NAMES.has(propName)) continue;
          if (propName === "priceMinor" || baseIsCohortShaped) {
            violations.push({ file: path.relative(process.cwd(), file), property: propName });
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }

  return violations;
}

/** Throws, naming every offending file and property, when a legacy Cohort price read exists. */
function assertNoLegacyCohortPriceReads(violations: LegacyCohortPriceViolation[]): void {
  if (violations.length === 0) return;
  const details = violations.map((v) => `  ${v.file} reads .${v.property}`).join("\n");
  throw new Error(
    `COH-02 legacy-price invariant violated — the following file(s) still read the legacy ` +
      `Cohort.priceMinor/currency pair (07-11 removed the underlying columns):\n${details}`,
  );
}

describe("phase-wide invariant: no legacy Cohort price reads (COH-02, 07-11)", () => {
  it(
    "nothing under src/ reads Cohort.priceMinor or Cohort.currency",
    () => {
      const violations = findLegacyCohortPriceReads(path.resolve(process.cwd(), "src"));
      expect(() => assertNoLegacyCohortPriceReads(violations)).not.toThrow();
    },
    15_000,
  );

  it("does not flag Order.amountMinor, Order.currency, or PaymentAttempt.currency (fixture)", () => {
    const tmpRoot = mkdtempSync(path.join(tmpdir(), "coh02-safe-fixture-"));
    try {
      const servicesDir = path.join(tmpRoot, "server", "services");
      mkdirSync(servicesDir, { recursive: true });
      writeFileSync(
        path.join(servicesDir, "order-read-service.ts"),
        [
          "type Order = { amountMinor: number; currency: string };",
          "type PaymentAttempt = { currency: string };",
          "export function total(order: Order, attempt: PaymentAttempt): number {",
          "  const learnerTotal = order.amountMinor;",
          "  const orderCurrency = order.currency;",
          "  const attemptCurrency = attempt.currency;",
          "  return learnerTotal + orderCurrency.length + attemptCurrency.length;",
          "}",
        ].join("\n"),
      );

      const violations = findLegacyCohortPriceReads(tmpRoot);
      expect(violations).toHaveLength(0);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("names the offending file and property when a legacy Cohort price read is deliberately introduced (fixture)", () => {
    const tmpRoot = mkdtempSync(path.join(tmpdir(), "coh02-violation-fixture-"));
    try {
      const servicesDir = path.join(tmpRoot, "server", "services");
      mkdirSync(servicesDir, { recursive: true });
      writeFileSync(
        path.join(servicesDir, "leaky-cohort-read.ts"),
        [
          "type CohortAggregateRow = { priceMinor: number; currency: string };",
          "export function toInput(row: CohortAggregateRow) {",
          "  return { priceMinor: row.priceMinor, currency: row.currency };",
          "}",
        ].join("\n"),
      );
      // A comment mentioning the legacy field names must never trip the scan (AST, not regex).
      writeFileSync(
        path.join(servicesDir, "innocent.ts"),
        "// this file talks about priceMinor and currency in a comment only\nexport const x = 1;\n",
      );

      const violations = findLegacyCohortPriceReads(tmpRoot);

      expect(violations.length).toBeGreaterThanOrEqual(2);
      const files = violations.map((v) => v.file.replace(/\\/g, "/"));
      expect(files.every((f) => f.includes("leaky-cohort-read.ts"))).toBe(true);
      const properties = violations.map((v) => v.property).sort();
      expect(properties).toEqual(["currency", "priceMinor"]);
      expect(() => assertNoLegacyCohortPriceReads(violations)).toThrowError(/leaky-cohort-read\.ts/);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("exempts a file inside an allow-listed compatibility directory by prefix, not by filename (fixture)", () => {
    const tmpRoot = mkdtempSync(path.join(tmpdir(), "coh02-exempt-fixture-"));
    try {
      const exemptDirName = path.join("server", "legacy-compat");
      const exemptDir = path.join(tmpRoot, exemptDirName);
      mkdirSync(exemptDir, { recursive: true });
      writeFileSync(
        path.join(exemptDir, "leaky-cohort-read.ts"),
        [
          "type CohortAggregateRow = { priceMinor: number; currency: string };",
          "export function toInput(row: CohortAggregateRow) {",
          "  return { priceMinor: row.priceMinor, currency: row.currency };",
          "}",
        ].join("\n"),
      );

      // Same file content as the violation fixture above, but this time the
      // exemption list names its directory — proving the exemption is a
      // directory-prefix match, mirroring STRIPE_PROVIDER_DIR's own shape,
      // not a filename coincidence with the violation fixture.
      const originalLength = LEGACY_COHORT_PRICE_EXEMPT_DIRS.length;
      LEGACY_COHORT_PRICE_EXEMPT_DIRS.push(exemptDirName);
      try {
        const violations = findLegacyCohortPriceReads(tmpRoot);
        expect(violations).toHaveLength(0);
      } finally {
        LEGACY_COHORT_PRICE_EXEMPT_DIRS.length = originalLength;
      }
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

describe("phase-wide invariant: provider isolation (PAY-09)", () => {
  it("no file outside the Stripe or Paystack provider directories imports a provider SDK or a provider-specific type", () => {
    const violations = findProviderIsolationViolations(path.resolve(process.cwd(), "src"));
    expect(() => assertNoProviderIsolationViolations(violations)).not.toThrow();
  });

  it("names every offending file path when the isolation scan is made to fail (Stripe fixture)", () => {
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

  it("flags a type-only import of a Paystack adapter type from outside providers/paystack/, but not a plain value import or the same type-only import from inside it (Paystack fixture)", () => {
    const tmpRoot = mkdtempSync(path.join(tmpdir(), "pay09-paystack-fixture-"));
    try {
      const exemptDir = path.join(tmpRoot, PAYSTACK_PROVIDER_DIR);
      const violatingDir = path.join(tmpRoot, "server", "services");
      mkdirSync(exemptDir, { recursive: true });
      mkdirSync(violatingDir, { recursive: true });

      // Exempt — inside the adapter directory, a type-only import of a
      // sibling module's type must NOT be flagged.
      writeFileSync(
        path.join(exemptDir, "initialize.ts"),
        `import type { PaystackVerifiedTransaction } from "@/server/payments/providers/paystack/client";\nexport type T = PaystackVerifiedTransaction;\n`,
      );
      // Exempt — a PLAIN VALUE import from outside the directory (the
      // sanctioned shape both `checkout-service.ts` and the webhook route
      // already use) must NOT be flagged. This is what makes the rule
      // "narrower than Stripe's," per 07-RESEARCH.md.
      writeFileSync(
        path.join(violatingDir, "value-caller.ts"),
        `import { initiatePaystackTransaction } from "@/server/payments/providers/paystack/initialize";\nexport const f = initiatePaystackTransaction;\n`,
      );
      // Violating — a TYPE-ONLY import of the adapter's own request/response
      // type, sitting outside the directory.
      writeFileSync(
        path.join(violatingDir, "leaky-paystack-service.ts"),
        `import type { PaystackVerifiedTransaction } from "@/server/payments/providers/paystack/client";\nexport type T = PaystackVerifiedTransaction;\n`,
      );

      const violations = findProviderIsolationViolations(tmpRoot);

      expect(violations).toHaveLength(1);
      expect(violations[0].file.replace(/\\/g, "/")).toContain("leaky-paystack-service.ts");
      expect(() => assertNoProviderIsolationViolations(violations)).toThrowError(/leaky-paystack-service\.ts/);
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
