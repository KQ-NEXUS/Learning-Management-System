/**
 * Purity guard for src/server/licence (plan 14-02, re-run by every later plan
 * that adds a module there).
 *
 * This test is the automated evidence for the D-01 prohibition: licence
 * verification MUST NOT phone home, collect telemetry, include a remote kill
 * switch, a hidden check or obfuscation (PRD 18.1). It enumerates the
 * directory at test time, so modules added by plans 14-04 and 14-06 are covered
 * automatically, and asserts that each file imports only a closed allow-list
 * and never calls `fetch`.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { runtimeImports } from "./import-graph";

const LICENCE_DIR = path.resolve(process.cwd(), "src/server/licence");

const FORBIDDEN_SPECIFIERS = [
  "@prisma/client",
  "next",
  "@/server/permissions",
  "@/server/services",
  "node:http",
  "node:https",
  "node:net",
  "node:dns",
  "node:tls",
  "undici",
];

function isAllowedSpecifier(specifier: string): boolean {
  return (
    specifier === "node:crypto" ||
    specifier === "zod" ||
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    specifier.startsWith("@/server/licence/")
  );
}

function isForbiddenSpecifier(specifier: string): boolean {
  return FORBIDDEN_SPECIFIERS.some(
    (forbidden) => specifier === forbidden || specifier.startsWith(`${forbidden}/`),
  );
}

/** Lines of call expressions whose callee is the bare identifier `fetch`. */
function findFetchCalls(fileName: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "fetch"
    ) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      found.push(`${fileName}:${line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** Dynamic `import(...)` calls would bypass the static specifier check. */
function findDynamicImports(fileName: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      found.push(fileName);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

const licenceFiles = readdirSync(LICENCE_DIR)
  .filter((name) => name.endsWith(".ts") && !name.endsWith(".d.ts"))
  .sort();

describe("src/server/licence purity (D-01: no phone-home, telemetry, kill switch or hidden check)", () => {
  it("covers the modules that exist (non-vacuous)", () => {
    expect(licenceFiles).toEqual(
      expect.arrayContaining(["constants.ts", "errors.ts", "format.ts", "trust-set.ts", "verify.ts"]),
    );
  });

  it.each(licenceFiles)("%s imports only node:crypto, zod and licence-relative paths", (name) => {
    const file = path.join(LICENCE_DIR, name);
    const specifiers = runtimeImports(file).map((entry) => entry.specifier);
    for (const specifier of specifiers) {
      expect(isForbiddenSpecifier(specifier), `${name} imports forbidden ${specifier}`).toBe(false);
      expect(isAllowedSpecifier(specifier), `${name} imports unlisted ${specifier}`).toBe(true);
    }
  });

  it.each(licenceFiles)("%s makes no fetch call and no dynamic import", (name) => {
    const file = path.join(LICENCE_DIR, name);
    const source = readFileSync(file, "utf8");
    expect(findFetchCalls(name, source)).toEqual([]);
    expect(findDynamicImports(name, source)).toEqual([]);
  });

  it("the detectors are not vacuous: they flag a fetch call, a dynamic import and a forbidden specifier", () => {
    expect(findFetchCalls("probe.ts", "export const x = () => fetch('https://example.com');")).toEqual([
      "probe.ts:1",
    ]);
    expect(findFetchCalls("probe.ts", "const fetchLater = 1; // fetch(")).toEqual([]);
    expect(findDynamicImports("probe.ts", "export const m = () => import('node:https');")).toEqual([
      "probe.ts",
    ]);
    for (const specifier of ["node:https", "node:http", "undici", "next/headers", "@prisma/client"]) {
      expect(isForbiddenSpecifier(specifier), specifier).toBe(true);
      expect(isAllowedSpecifier(specifier), specifier).toBe(false);
    }
    expect(isAllowedSpecifier("node:crypto")).toBe(true);
    expect(isAllowedSpecifier("@/server/licence/format")).toBe(true);
    expect(isAllowedSpecifier("@/server/services/licence-service")).toBe(false);
  });
});
