import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { landingPathFor, STAFF_LANDING_PATH, LEARNER_LANDING_PATH } from "@/server/auth/landing";

describe("landingPathFor", () => {
  it("resolves to the staff route when isStaff is true", () => {
    expect(landingPathFor({ isStaff: true })).toBe(STAFF_LANDING_PATH);
  });

  it("resolves to the account route when isStaff is false", () => {
    expect(landingPathFor({ isStaff: false })).toBe(LEARNER_LANDING_PATH);
  });

  it("resolves to the account route when isStaff is absent", () => {
    expect(landingPathFor({})).toBe(LEARNER_LANDING_PATH);
  });

  it("resolves to the account route when isStaff is null", () => {
    expect(landingPathFor({ isStaff: null })).toBe(LEARNER_LANDING_PATH);
  });
});

describe("staff layout guard resolves its non-staff destination via landing.ts (G-03-7)", () => {
  // Reads the source as text at test time, in the style of
  // tests/schema-identity.test.ts — a server-component redirect target
  // cannot be exercised without a browser, so this pins the code shape
  // instead. The landing module's own header comment promises that the
  // redirect target lives in one place; that promise only holds if callers
  // actually use the constant, and this is the only check that can verify
  // that without a browser.
  const source = readFileSync(
    path.resolve(process.cwd(), "src/app/staff/layout.tsx"),
    "utf8",
  );

  it("imports LEARNER_LANDING_PATH from the landing module", () => {
    expect(source).toMatch(
      /import\s*\{\s*LEARNER_LANDING_PATH\s*\}\s*from\s*"@\/server\/auth\/landing"/,
    );
  });

  it("does not redirect the non-staff branch to a literal sign-in path", () => {
    // Scoped to the non-staff branch specifically — the unauthenticated
    // branch legitimately keeps the "/signin" literal (that path is
    // correct and untouched), so an assertion over the whole file would be
    // wrong.
    const nonStaffBranch = source.match(/if \(!actor\.isStaff\)[^\n]*/);
    expect(nonStaffBranch).not.toBeNull();
    expect(nonStaffBranch![0]).not.toContain('"/signin"');
    expect(nonStaffBranch![0]).toContain("LEARNER_LANDING_PATH");
  });

  it("keeps the literal sign-in redirect for the unauthenticated branch", () => {
    const unauthenticatedBranch = source.match(/if \(!actor\)[^\n]*/);
    expect(unauthenticatedBranch).not.toBeNull();
    expect(unauthenticatedBranch![0]).toContain('"/signin"');
  });
});
