import { beforeAll, describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const PRISMA_IMPORT = `import { PrismaClient } from "@prisma/client";\nexport const x = PrismaClient;\n`;

// One instance for the whole file. Constructing ESLint per call reloads the
// Next.js config and the TypeScript parser each time, which costs seconds.
const eslint = new ESLint();

async function lintAs(filePath: string) {
  const [result] = await eslint.lintText(PRISMA_IMPORT, {
    filePath,
    warnIgnored: false,
  });
  return result.messages.filter((m) => m.ruleId === "no-restricted-imports");
}

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".mjs", ".js", ".jsx"];

function resolveProjectImport(fromFile: string, specifier: string): string | null {
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

function runtimeImports(filePath: string): Array<{
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
 * `workerRuntimeClosure()` and `webhookRuntimeClosure()` below — the walk
 * itself is written once so the two entrypoint sets can never drift apart
 * (Pitfall 3's own warning: "two copies of an import-graph traversal is
 * exactly the drift the boundary test exists to prevent").
 */
function runtimeClosureFrom(entrypoints: string[]): string[] {
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

function workerRuntimeClosure(): string[] {
  // The Netlify Scheduled Functions are the only always-off-request runtime
  // now — the pg-boss worker is gone. Their transitive import closure must
  // stay clear of request-only APIs for the same reason the worker's did.
  const functionsRoot = path.resolve(process.cwd(), "netlify/functions");
  const entrypoints = readdirSync(functionsRoot)
    .filter((name) => name.endsWith(".ts") || name.endsWith(".mts"))
    .map((name) => path.join(functionsRoot, name));
  return runtimeClosureFrom(entrypoints);
}

/**
 * The Stripe webhook route's own runtime import closure — the second
 * instance of this walk, proving the same "no request-only API" guarantee
 * `workerRuntimeClosure()` already proves for the hold-release worker
 * (T-06-33). Its one entrypoint is the route file itself; from there the
 * walk follows `checkout-webhook-system-service.ts` and everything it
 * imports transitively.
 */
function webhookRuntimeClosure(): string[] {
  const entrypoints = [
    path.resolve(process.cwd(), "src", "app", "api", "webhooks", "stripe", "route.ts"),
  ];
  return runtimeClosureFrom(entrypoints);
}

/**
 * The specifier set both closure assertions flag — a request-only API that
 * must never reach an actorless worker/webhook module. Shared so the two
 * assertions can never flag a different set by accident.
 */
function findRequestOnlyOffenders(closure: string[]): Array<{ file: string; specifier: string }> {
  return closure.flatMap((filePath) =>
    runtimeImports(filePath)
      .filter(
        ({ specifier, importsCurrentActor }) =>
          specifier === "next/headers" ||
          specifier === "@/server/permissions" ||
          specifier.startsWith("@/server/permissions/") ||
          importsCurrentActor,
      )
      .map(({ specifier }) => ({
        file: path.relative(process.cwd(), filePath),
        specifier,
      })),
  );
}

// The first lint pays for loading eslint-config-next, its plugins, and the
// TypeScript parser. Paying it here keeps that cost out of the assertions.
beforeAll(async () => {
  await lintAs("src/server/db.ts");
}, 300_000);

describe("service-layer boundary", () => {
  it("rejects a Prisma import from a route", async () => {
    expect(await lintAs("src/app/page.tsx")).toHaveLength(1);
  });

  it("rejects a Prisma import from a component", async () => {
    expect(await lintAs("src/components/primitives/ResourceTable.tsx")).toHaveLength(1);
  });

  it("rejects a Prisma import from a non-service server module", async () => {
    expect(await lintAs("src/server/audit/writer.ts")).toHaveLength(1);
  });

  it("rejects a Prisma import from the permissions module", async () => {
    expect(await lintAs("src/server/permissions/scope.ts")).toHaveLength(1);
  });

  it("allows a Prisma import from a service", async () => {
    expect(await lintAs("src/server/services/course-service.ts")).toHaveLength(0);
  });

  it("allows a Prisma import from the db client module", async () => {
    expect(await lintAs("src/server/db.ts")).toHaveLength(0);
  });

  it("rejects a Prisma import from a Netlify scheduled function", async () => {
    expect(await lintAs("netlify/functions/release-expired-holds.ts")).toHaveLength(1);
  });

  it("keeps the scheduled-function runtime import closure away from request-only APIs", () => {
    expect(findRequestOnlyOffenders(workerRuntimeClosure())).toEqual([]);
  });

  it("keeps the Stripe webhook route's runtime import closure away from request-only APIs", () => {
    expect(findRequestOnlyOffenders(webhookRuntimeClosure())).toEqual([]);
  });

  it("the webhook closure actually reaches the settlement service (the assertion above is not vacuous)", () => {
    const closure = webhookRuntimeClosure();
    const touchesSettlementService = closure.some((filePath) =>
      filePath.replace(/\\/g, "/").endsWith("src/server/services/checkout-webhook-system-service.ts"),
    );
    expect(touchesSettlementService).toBe(true);
  });
});
