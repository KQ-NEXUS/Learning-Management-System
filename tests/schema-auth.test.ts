import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const schema = readFileSync(
  path.resolve(process.cwd(), "prisma/schema.prisma"),
  "utf8",
);
const userModel = schema.slice(
  schema.indexOf("model User {"),
  schema.indexOf("}", schema.indexOf("model User {")),
);

describe("User model supports login throttling", () => {
  it("tracks consecutive failed attempts", () => {
    expect(userModel).toMatch(/failedLoginAttempts\s+Int\s+@default\(0\)/);
  });

  it("records a lockout expiry", () => {
    expect(userModel).toMatch(/lockedUntil\s+DateTime\?/);
  });
});
