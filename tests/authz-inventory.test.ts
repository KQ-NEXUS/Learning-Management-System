/**
 * Inventory guard for the authorization registry (Phase 15, plan 15-25, Task 2;
 * NFR-05, D-09, T-15-25-01).
 *
 * A server action is a public POST endpoint whatever the UI renders (Next.js
 * server-actions guide: an action "is reachable to anyone who can send the same
 * POST"), and a route handler is reachable at its URL. So nothing may be added
 * without a decision about who can call it. This test parses `src/app` with the
 * TypeScript compiler API (the same `createSourceFile` approach as
 * `tests/support/licence-write-scan.ts`) and fails when:
 *
 *   - an export of a "use server" file, or an HTTP verb of a route.ts, is not in
 *     `tests/support/authz-registry.ts` (an unregistered export);
 *   - a registry entry names an export or verb the source no longer has (stale);
 *   - an entry is class "public" or "public-signature" without being on the
 *     reviewed PUBLIC_ALLOW_LIST (pre-session auth actions, health, signed
 *     webhooks, pure validators), or the allow-list names something not registered;
 *   - an entry is malformed (unknown permission, scope missing, global-only
 *     permission at a narrower scope, unknown table, no input builder);
 *   - the scan finds zero files or the registry is empty, so a broken glob or an
 *     emptied registry cannot pass vacuously;
 *   - a function body carries an inline "use server" directive (an action the
 *     file-level scan cannot see);
 *   - the registry is not sorted by file then export, which keeps the matrix and
 *     its evidence deterministic.
 *
 * No database is needed: this is a static check over source text.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { isGlobalOnly, isPermission } from "@/server/permissions/catalogue";
import {
  ACTION_REGISTRY,
  PUBLIC_ALLOW_LIST,
  ROUTE_REGISTRY,
  type ActionRegistryEntry,
  type RouteRegistryEntry,
} from "./support/authz-registry";
import { ACTION_INPUTS, ROUTE_INPUTS } from "./support/authz-inputs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const APP_DIR = path.join(REPO_ROOT, "src", "app");

const HTTP_VERBS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function listSourceFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      listSourceFiles(full, found);
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      found.push(full);
    }
  }
  return found;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false);
}

/** The names a statement exports as values (type-only exports are erased and callable by nobody). */
function exportedValueNames(statement: ts.Statement): string[] {
  if (ts.isFunctionDeclaration(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
    return hasModifier(statement, ts.SyntaxKind.DefaultKeyword) ? ["default"] : statement.name ? [statement.name.text] : [];
  }
  if (ts.isClassDeclaration(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
    return statement.name ? [statement.name.text] : [];
  }
  if (ts.isVariableStatement(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
    const names: string[] = [];
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text);
      else {
        // `export const { a, b } = ...` still exports value names.
        const collect = (binding: ts.BindingName): void => {
          if (ts.isIdentifier(binding)) names.push(binding.text);
          else for (const element of binding.elements) if (!ts.isOmittedExpression(element)) collect(element.name);
        };
        collect(declaration.name);
      }
    }
    return names;
  }
  if (ts.isEnumDeclaration(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
    return [statement.name.text];
  }
  if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
    const clause = statement.exportClause;
    if (clause && ts.isNamedExports(clause)) {
      return clause.elements.filter((element) => !element.isTypeOnly).map((element) => element.name.text);
    }
    // `export * from "..."` re-exports names the scan cannot see statically.
    return ["*"];
  }
  if (ts.isExportAssignment(statement)) return ["default"];
  return [];
}

function startsWithUseServer(sourceFile: ts.SourceFile): boolean {
  const first = sourceFile.statements[0];
  return (
    first !== undefined &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === "use server"
  );
}

type ScanResult = {
  /** `file#exportName`, one per exported value of a "use server" file. */
  actionKeys: string[];
  /** `file#METHOD`, one per exported HTTP verb of a route.ts. */
  routeKeys: string[];
  actionFiles: string[];
  routeFiles: string[];
  inlineUseServer: string[];
  wildcardExports: string[];
  scannedFileCount: number;
};

function scanApp(): ScanResult {
  if (!existsSync(APP_DIR) || !statSync(APP_DIR).isDirectory()) {
    throw new Error(`App directory not found: ${APP_DIR}`);
  }
  const result: ScanResult = {
    actionKeys: [],
    routeKeys: [],
    actionFiles: [],
    routeFiles: [],
    inlineUseServer: [],
    wildcardExports: [],
    scannedFileCount: 0,
  };
  for (const absolute of listSourceFiles(APP_DIR)) {
    const relative = toPosix(path.relative(REPO_ROOT, absolute));
    const text = readFileSync(absolute, "utf8");
    const sourceFile = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true);
    result.scannedFileCount += 1;

    const isRouteFile = /(^|\/)route\.(ts|tsx)$/.test(relative);
    const isActionFile = startsWithUseServer(sourceFile);

    if (isActionFile) {
      result.actionFiles.push(relative);
      for (const statement of sourceFile.statements) {
        for (const name of exportedValueNames(statement)) {
          if (name === "*") result.wildcardExports.push(relative);
          else result.actionKeys.push(`${relative}#${name}`);
        }
      }
    }

    if (isRouteFile) {
      result.routeFiles.push(relative);
      for (const statement of sourceFile.statements) {
        for (const name of exportedValueNames(statement)) {
          if (name === "*") result.wildcardExports.push(relative);
          else if (HTTP_VERBS.has(name)) result.routeKeys.push(`${relative}#${name}`);
        }
      }
    }

    // An inline directive inside a function body makes that function a public
    // endpoint the file-level scan above would miss.
    const visit = (node: ts.Node): void => {
      if (
        (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) &&
        node.body &&
        ts.isBlock(node.body)
      ) {
        const first = node.body.statements[0];
        if (
          first &&
          ts.isExpressionStatement(first) &&
          ts.isStringLiteral(first.expression) &&
          first.expression.text === "use server" &&
          !isActionFile
        ) {
          const line = sourceFile.getLineAndCharacterOfPosition(first.getStart(sourceFile)).line + 1;
          result.inlineUseServer.push(`${relative}:${line}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  result.actionKeys.sort(compareKeys);
  result.routeKeys.sort(compareKeys);
  return result;
}

/** Byte-wise comparison so the order never depends on the machine's locale. */
function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const actionKey = (entry: ActionRegistryEntry) => `${entry.file}#${entry.exportName}`;
const routeKey = (entry: RouteRegistryEntry) => `${entry.file}#${entry.method}`;

function prismaModelNames(): Set<string> {
  const schema = readFileSync(path.join(REPO_ROOT, "prisma", "schema.prisma"), "utf8");
  const names = new Set<string>();
  for (const match of schema.matchAll(/^model\s+(\w+)\s*\{/gm)) names.add(match[1]!);
  return names;
}

let cachedScan: ScanResult | null = null;
const scan = (): ScanResult => (cachedScan ??= scanApp());

describe("authorization inventory: the scan sees the real surface", () => {
  it("finds server action files and route handlers, so an empty scan cannot pass vacuously", () => {
    const result = scan();
    expect(result.scannedFileCount, "no source files were scanned under src/app").toBeGreaterThan(0);
    expect(result.actionFiles.length, "no \"use server\" files were found").toBeGreaterThan(0);
    expect(result.routeFiles.length, "no route.ts files were found").toBeGreaterThan(0);
    expect(result.actionKeys.length, "no server action exports were found").toBeGreaterThan(0);
    expect(result.routeKeys.length, "no route verbs were found").toBeGreaterThan(0);
  });

  it("fails if the registry is empty", () => {
    expect(ACTION_REGISTRY.length).toBeGreaterThan(0);
    expect(ROUTE_REGISTRY.length).toBeGreaterThan(0);
  });

  it("finds no inline \"use server\" directive and no export-star in a scanned file", () => {
    const result = scan();
    expect(result.inlineUseServer, "inline server actions need a registry decision").toEqual([]);
    expect(result.wildcardExports, "export * hides names from the scan").toEqual([]);
  });
});

describe("authorization inventory: registry matches source", () => {
  it("every export of every \"use server\" file is registered", () => {
    const registered = new Set(ACTION_REGISTRY.map(actionKey));
    const unregistered = scan().actionKeys.filter((key) => !registered.has(key));
    expect(unregistered, `unregistered server action export(s): ${unregistered.join(", ")}`).toEqual([]);
  });

  it("every HTTP verb of every route.ts is registered", () => {
    const registered = new Set(ROUTE_REGISTRY.map(routeKey));
    const unregistered = scan().routeKeys.filter((key) => !registered.has(key));
    expect(unregistered, `unregistered route verb(s): ${unregistered.join(", ")}`).toEqual([]);
  });

  it("no action registry entry is stale", () => {
    const present = new Set(scan().actionKeys);
    const stale = ACTION_REGISTRY.map(actionKey).filter((key) => !present.has(key));
    expect(stale, `stale action registry entr(ies): ${stale.join(", ")}`).toEqual([]);
  });

  it("no route registry entry is stale", () => {
    const present = new Set(scan().routeKeys);
    const stale = ROUTE_REGISTRY.map(routeKey).filter((key) => !present.has(key));
    expect(stale, `stale route registry entr(ies): ${stale.join(", ")}`).toEqual([]);
  });

  it("registers each export or verb once", () => {
    const keys = [...ACTION_REGISTRY.map(actionKey), ...ROUTE_REGISTRY.map(routeKey)];
    const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
    expect(duplicates, `duplicate registry key(s): ${duplicates.join(", ")}`).toEqual([]);
  });

  it("keeps both registries sorted by file, then export or method (deterministic matrix order)", () => {
    const actions = ACTION_REGISTRY.map(actionKey);
    const routes = ROUTE_REGISTRY.map(routeKey);
    expect(actions).toEqual([...actions].sort(compareKeys));
    expect(routes).toEqual([...routes].sort(compareKeys));
  });

  it("registers at least the 133 action exports counted for this phase and every route verb", () => {
    expect(ACTION_REGISTRY.length).toBeGreaterThanOrEqual(133);
    const routeFiles = new Set(ROUTE_REGISTRY.map((entry) => entry.file));
    expect(routeFiles.has("src/app/api/health/route.ts")).toBe(true);
    expect(routeFiles.has("src/app/api/lesson-resources/[id]/captions/route.ts")).toBe(true);
    expect([...routeFiles].sort(compareKeys)).toEqual(scan().routeFiles.sort(compareKeys));
  });
});

describe("authorization inventory: classification is reviewed", () => {
  const all: Array<ActionRegistryEntry | RouteRegistryEntry> = [...ACTION_REGISTRY, ...ROUTE_REGISTRY];
  const keyOf = (entry: ActionRegistryEntry | RouteRegistryEntry) =>
    "exportName" in entry ? actionKey(entry) : routeKey(entry);

  it("a public or public-signature entry is on the reviewed allow-list, with a reason", () => {
    const outside = all
      .filter((entry) => entry.class === "public" || entry.class === "public-signature")
      .map(keyOf)
      .filter((key) => !(key in PUBLIC_ALLOW_LIST));
    expect(outside, `public entr(ies) outside the allow-list: ${outside.join(", ")}`).toEqual([]);
    for (const [key, reason] of Object.entries(PUBLIC_ALLOW_LIST)) {
      expect(reason.trim().length, `allow-list reason for ${key}`).toBeGreaterThan(10);
    }
  });

  it("the allow-list names only registered public entries (no stale approvals)", () => {
    const publicKeys = new Set(
      all.filter((entry) => entry.class === "public" || entry.class === "public-signature").map(keyOf),
    );
    const stale = Object.keys(PUBLIC_ALLOW_LIST).filter((key) => !publicKeys.has(key));
    expect(stale, `allow-list entr(ies) that are not registered as public: ${stale.join(", ")}`).toEqual([]);
  });

  it("a permission entry names a catalogue permission and a scope; global-only permissions are Global", () => {
    for (const entry of all.filter((candidate) => candidate.class === "permission")) {
      const key = keyOf(entry);
      expect(entry.permission && isPermission(entry.permission), `${key}: permission "${entry.permission}" is not in the catalogue`).toBe(true);
      expect(["GLOBAL", "COLLECTION", "RECORD"], `${key}: scope`).toContain(entry.scope);
      if (entry.permission && isPermission(entry.permission) && isGlobalOnly(entry.permission)) {
        expect(entry.scope, `${key}: ${entry.permission} is global-only`).toBe("GLOBAL");
      }
    }
  });

  it("a non-permission entry carries no permission or scope", () => {
    for (const entry of all.filter((candidate) => candidate.class !== "permission")) {
      expect(entry.permission, `${keyOf(entry)} must not name a permission`).toBeUndefined();
      expect(entry.scope, `${keyOf(entry)} must not name a scope`).toBeUndefined();
    }
  });

  it("every entry points at a real file, a real input builder, and real tables", () => {
    const models = prismaModelNames();
    for (const entry of all) {
      const key = keyOf(entry);
      expect(existsSync(path.join(REPO_ROOT, entry.file)), `${key}: file does not exist`).toBe(true);
      const builders = "exportName" in entry ? ACTION_INPUTS : ROUTE_INPUTS;
      expect(builders[entry.inputId], `${key}: no input builder "${entry.inputId}"`).toBeTypeOf("function");
      expect(entry.domain.trim().length, `${key}: domain`).toBeGreaterThan(0);
      for (const table of entry.writes) {
        expect(models.has(table), `${key}: "${table}" is not a Prisma model`).toBe(true);
      }
    }
  });

  it("a route entry lists the statuses that count as a refusal (a public route refuses nobody)", () => {
    for (const entry of ROUTE_REGISTRY) {
      if (entry.class !== "public") {
        expect(entry.deniedStatuses.length, `${routeKey(entry)}: deniedStatuses`).toBeGreaterThan(0);
      }
      expect(entry.route.startsWith("/"), `${routeKey(entry)}: route`).toBe(true);
      for (const variant of entry.variantInputIds ?? []) {
        expect(ROUTE_INPUTS[variant], `${routeKey(entry)}: no input builder for variant "${variant}"`).toBeTypeOf("function");
      }
    }
  });

  it("an entry with a documented exception (no denial row, valid empty input, view permission suffices) says why", () => {
    for (const entry of all.filter((candidate) => candidate.denialAudit === false || candidate.emptyInputIsValid === true || candidate.viewPermissionSuffices === true)) {
      expect(entry.reason?.trim().length ?? 0, `${keyOf(entry)}: reason`).toBeGreaterThan(10);
    }
  });
});

describe("authorization inventory: summary", () => {
  it("counts the surface by class", () => {
    const counts = (entries: ReadonlyArray<ActionRegistryEntry | RouteRegistryEntry>) => {
      const byClass: Record<string, number> = {};
      for (const entry of entries) byClass[entry.class] = (byClass[entry.class] ?? 0) + 1;
      return byClass;
    };
    const summary = {
      actionFiles: scan().actionFiles.length,
      actions: ACTION_REGISTRY.length,
      routeFiles: scan().routeFiles.length,
      routes: ROUTE_REGISTRY.length,
      actionsByClass: counts(ACTION_REGISTRY),
      routesByClass: counts(ROUTE_REGISTRY),
    };
    // Surfaced in the test report so the plan summary can quote it.
    console.log(`[authz-inventory] ${JSON.stringify(summary)}`);
    expect(summary.actions).toBe(scan().actionKeys.length);
    expect(summary.routes).toBe(scan().routeKeys.length);
  });
});
