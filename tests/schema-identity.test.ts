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
const verificationTokenModel = schema.slice(
  schema.indexOf("model VerificationToken {"),
  schema.indexOf("}", schema.indexOf("model VerificationToken {")),
);

describe("User model supports email-change (D-10)", () => {
  it("holds an unverified new address without touching the live email column", () => {
    expect(userModel).toMatch(/pendingEmail\s+String\?/);
  });
});

describe("VerificationToken model supports the per-address cooldown (D-05)", () => {
  it("records when the token was issued", () => {
    expect(verificationTokenModel).toMatch(/createdAt\s+DateTime\s+@default\(now\(\)\)/);
  });
});
