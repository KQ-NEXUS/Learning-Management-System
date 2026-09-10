import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("docker-compose production configuration", () => {
  it("requires AUTH_SECRET instead of defaulting to a public constant", () => {
    const compose = readFileSync("docker-compose.yml", "utf8");
    expect(compose).toContain("AUTH_SECRET: ${AUTH_SECRET:?AUTH_SECRET must be set}");
    expect(compose).not.toContain("change-me-before-production");
  });
});
