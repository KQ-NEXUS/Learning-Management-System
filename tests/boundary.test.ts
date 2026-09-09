import { beforeAll, describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
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

function workerRuntimeClosure(): string[] {
  const workerRoot = path.resolve(process.cwd(), "worker");
  const handlersRoot = path.join(workerRoot, "handlers");
  const entrypoints = [
    path.join(workerRoot, "index.ts"),
    ...readdirSync(handlersRoot)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => path.join(handlersRoot, name)),
  ];
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

  it("rejects a Prisma import from the worker entrypoint", async () => {
    expect(await lintAs("worker/index.ts")).toHaveLength(1);
  });

  it("rejects a Prisma import from a worker handler", async () => {
    expect(await lintAs("worker/handlers/scan-lesson-resource.ts")).toHaveLength(1);
  });

  it("keeps the worker runtime import closure away from request-only APIs", () => {
    const offenders = workerRuntimeClosure().flatMap((filePath) =>
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

    expect(offenders).toEqual([]);
  });
});
