import { beforeAll, describe, expect, it } from "vitest";
import { ESLint } from "eslint";

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

// The first lint pays for loading eslint-config-next, its plugins, and the
// TypeScript parser — 60s or more on a cold filesystem cache. Paying it here,
// under its own generous budget, keeps that cost out of the assertions so a
// slow machine cannot turn a passing rule into a failing test.
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
});
