import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";

const REQUIRED_DIRECTORIES = [
  "src/app",
  "src/server/services",
  "src/server/permissions",
  "src/server/auth",
  "src/server/audit",
  "src/server/payments/providers",
  "src/components/primitives",
  "src/lib",
  "prisma",
];

describe("project structure", () => {
  it.each(REQUIRED_DIRECTORIES)("has %s", (dir) => {
    expect(existsSync(path.resolve(process.cwd(), dir))).toBe(true);
  });

  it("resolves the @ import alias to src", async () => {
    const tsconfig = await import("../tsconfig.json");
    expect(tsconfig.default.compilerOptions.paths["@/*"]).toEqual(["./src/*"]);
  });
});
