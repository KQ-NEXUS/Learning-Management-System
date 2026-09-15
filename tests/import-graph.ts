/**
 * The project-local runtime import-graph traversal — extracted (09-14) out
 * of `tests/boundary.test.ts` into its own plain (non-`*.test.ts`) module.
 *
 * `tests/boundary.test.ts`'s own header already warns that two
 * independently-maintained copies of this walk is exactly the drift a
 * boundary/invariants test exists to prevent, and 09-14's phase-invariants
 * test needs the identical traversal for its own import-freedom /
 * no-runtime-permission-import checks. Importing `boundary.test.ts` directly
 * would work for the traversal itself, but it is a Vitest spec file — its
 * module body calls `describe`/`it`/`beforeAll` at the top level, so
 * importing it from ANY other module executes those calls too and silently
 * registers `boundary.test.ts`'s own suite a second time inside whatever
 * file imported it. Moving the pure traversal here (a module Vitest's
 * `tests/**\/*.test.ts` include glob never collects on its own) is what lets
 * both spec files import the same one implementation with zero double-run
 * risk — not a third copy of the walk, and not two test files sharing test
 * registrations by accident.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".mjs", ".js", ".jsx"];

export function resolveProjectImport(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) {
    base = path.resolve(process.cwd(), "src", specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else {
    return null;
  }

  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
  ];
  // A bare specifier resolving to a DIRECTORY (e.g. `@/server/permissions`,
  // which has its own `index.ts`) must not be returned as-is — `existsSync`
  // is true for directories too, and `base` is always the first candidate,
  // so without the `isFile()` check the walk below would try to
  // `readFileSync` a directory and crash with EISDIR before ever trying the
  // `index.ts` candidate later in this same list (06-06 — first surfaced by
  // `webhookRuntimeClosure()` walking into exactly this shape).
  return (
    candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null
  );
}

export function runtimeImports(filePath: string): Array<{
  specifier: string;
  importsCurrentActor: boolean;
}> {
  const source = readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const imports: Array<{ specifier: string; importsCurrentActor: boolean }> = [];

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      if (clause?.isTypeOnly) continue;

      const named = clause?.namedBindings;
      const onlyTypeSpecifiers =
        named &&
        ts.isNamedImports(named) &&
        !clause.name &&
        named.elements.length > 0 &&
        named.elements.every((element) => element.isTypeOnly);
      if (onlyTypeSpecifiers) continue;

      imports.push({
        specifier: statement.moduleSpecifier.text,
        importsCurrentActor: statement.getText(sourceFile).includes("getCurrentActor"),
      });
    }

    if (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      imports.push({
        specifier: statement.moduleSpecifier.text,
        importsCurrentActor: false,
      });
    }
  }

  return imports;
}

/**
 * Walks the runtime import closure from `entrypoints`, following every
 * project-local (`@/...` or relative) import transitively. Shared by
 * `tests/boundary.test.ts`'s `workerRuntimeClosure()`/`webhookRuntimeClosure()`/
 * `paystackWebhookRuntimeClosure()` — the walk itself is written once so
 * those entrypoint sets can never drift apart (Pitfall 3's own warning: "two
 * copies of an import-graph traversal is exactly the drift the boundary test
 * exists to prevent").
 */
export function runtimeClosureFrom(entrypoints: string[]): string[] {
  const visited = new Set<string>();
  const pending = [...entrypoints];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    for (const imported of runtimeImports(current)) {
      const resolved = resolveProjectImport(current, imported.specifier);
      if (resolved && !visited.has(resolved)) pending.push(resolved);
    }
  }

  return [...visited];
}
