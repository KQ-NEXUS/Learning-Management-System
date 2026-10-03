import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { CERTIFICATE_FONT_FILENAME } from "@/server/services/certificate-font";

describe("docker-compose production configuration", () => {
  it("requires AUTH_SECRET instead of defaulting to a public constant", () => {
    const compose = readFileSync("docker-compose.yml", "utf8");
    expect(compose).toContain("AUTH_SECRET: ${AUTH_SECRET:?AUTH_SECRET must be set}");
    expect(compose).not.toContain("change-me-before-production");
  });
});

describe("Docker runtime image", () => {
  // The runner stage copies an explicit list of paths, so a file the app reads
  // from disk at runtime is silently absent unless it is on that list.
  const runnerStage = readFileSync("Dockerfile", "utf8").split(/^FROM .* AS runner$/m)[1] ?? "";

  it("ships the certificate font the PDF renderer reads at runtime", () => {
    expect(existsSync(path.join("assets", "fonts", "certificate", CERTIFICATE_FONT_FILENAME))).toBe(true);
    expect(runnerStage).toMatch(/^COPY --from=builder .*\/app\/assets \.\/assets$/m);
  });

  it("does not exclude assets from the build context", () => {
    const ignored = readFileSync(".dockerignore", "utf8").split(/\r?\n/).map((line) => line.trim());
    expect(ignored).not.toContain("assets");
  });
});
