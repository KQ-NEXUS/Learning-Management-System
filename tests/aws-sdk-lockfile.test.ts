import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
const lock = JSON.parse(readFileSync(resolve("package-lock.json"), "utf8"));

describe("approved managed upload dependency", () => {
  it("pins the exact approved version in the direct and resolved manifests", () => {
    expect(manifest.dependencies["@aws-sdk/lib-storage"]).toBe("3.1125.0");
    expect(lock.packages[""].dependencies["@aws-sdk/lib-storage"]).toBe("3.1125.0");
    expect(lock.packages["node_modules/@aws-sdk/lib-storage"].version).toBe("3.1125.0");
  });

  it("retains both existing S3 sibling specs and resolved versions", () => {
    for (const name of ["@aws-sdk/client-s3", "@aws-sdk/s3-request-presigner"]) {
      expect(manifest.dependencies[name]).toBe("^3.1125.0");
      expect(lock.packages[""].dependencies[name]).toBe("^3.1125.0");
      expect(lock.packages[`node_modules/${name}`].version).toBe("3.1125.0");
    }
  });
});
