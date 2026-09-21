import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  landingPathFor,
  checkoutReturnPathFor,
  STAFF_LANDING_PATH,
  LEARNER_LANDING_PATH,
  CHECKOUT_INTENT_COOKIE,
  CHECKOUT_INTENT_MAX_AGE_SECONDS,
} from "@/server/auth/landing";
import { HOLD_MINUTES_DEFAULT } from "@/server/services/seat-accounting";

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

describe("checkout-intent constants", () => {
  it("CHECKOUT_INTENT_COOKIE is a stable name, distinct from the session cookie", () => {
    expect(CHECKOUT_INTENT_COOKIE).toBe("checkout_intent");
  });

  it("CHECKOUT_INTENT_MAX_AGE_SECONDS is derived from HOLD_MINUTES_DEFAULT plus a margin", () => {
    expect(CHECKOUT_INTENT_MAX_AGE_SECONDS).toBeGreaterThan(HOLD_MINUTES_DEFAULT * 60);
  });
});

describe("checkoutReturnPathFor", () => {
  const VALID_COHORT_ID = "clh3x9f9a0000356k2j5g8h2q";

  // 07-04 — the intent value now carries `${cohortId}.${currency}` (D-07),
  // never a bare cohort id; the output path gains a `?currency=` query
  // parameter constructed from a two-value allowlist this module owns.
  it("returns /enrol/{id}?currency={currency} for a non-staff user with a valid dotted cohort.currency intent", () => {
    expect(checkoutReturnPathFor({ isStaff: false }, `${VALID_COHORT_ID}.NGN`)).toBe(
      `/enrol/${VALID_COHORT_ID}?currency=NGN`,
    );
    expect(checkoutReturnPathFor({ isStaff: false }, `${VALID_COHORT_ID}.USD`)).toBe(
      `/enrol/${VALID_COHORT_ID}?currency=USD`,
    );
  });

  it("round-trips both supported currencies without altering the id half", () => {
    for (const currency of ["NGN", "USD"] as const) {
      const result = checkoutReturnPathFor({ isStaff: false }, `${VALID_COHORT_ID}.${currency}`);
      expect(result).toBe(`/enrol/${VALID_COHORT_ID}?currency=${currency}`);
    }
  });

  it("falls back to the learner landing path when the currency half is unsupported, wrong case, or absent (no separator at all)", () => {
    expect(checkoutReturnPathFor({ isStaff: false }, `${VALID_COHORT_ID}.GBP`)).toBe(LEARNER_LANDING_PATH);
    expect(checkoutReturnPathFor({ isStaff: false }, `${VALID_COHORT_ID}.ngn`)).toBe(LEARNER_LANDING_PATH);
    expect(checkoutReturnPathFor({ isStaff: false }, VALID_COHORT_ID)).toBe(LEARNER_LANDING_PATH);
  });

  it("returns the staff landing path for a staff user, whatever the intent value", () => {
    expect(checkoutReturnPathFor({ isStaff: true }, `${VALID_COHORT_ID}.NGN`)).toBe(STAFF_LANDING_PATH);
    expect(checkoutReturnPathFor({ isStaff: true }, "//evil.example.com")).toBe(
      STAFF_LANDING_PATH,
    );
  });

  it("returns the learner landing path when the intent is null, undefined, or empty", () => {
    expect(checkoutReturnPathFor({ isStaff: false }, null)).toBe(LEARNER_LANDING_PATH);
    expect(checkoutReturnPathFor({ isStaff: false }, undefined)).toBe(LEARNER_LANDING_PATH);
    expect(checkoutReturnPathFor({ isStaff: false }, "")).toBe(LEARNER_LANDING_PATH);
  });

  it("rejects a value beginning with // (protocol-relative)", () => {
    const result = checkoutReturnPathFor({ isStaff: false }, "//evil.example.com");
    expect(result).toBe(LEARNER_LANDING_PATH);
  });

  it("rejects a value containing a scheme separator", () => {
    const result = checkoutReturnPathFor({ isStaff: false }, "https://evil.example.com");
    expect(result).toBe(LEARNER_LANDING_PATH);
  });

  it("rejects a value containing an encoded slash", () => {
    const result = checkoutReturnPathFor({ isStaff: false }, "cohort%2F..%2Fadmin");
    expect(result).toBe(LEARNER_LANDING_PATH);
  });

  it("rejects a value containing a newline", () => {
    const result = checkoutReturnPathFor({ isStaff: false }, "cohortid\nSet-Cookie: evil=1");
    expect(result).toBe(LEARNER_LANDING_PATH);
  });

  it("rejects a value far longer than any real id", () => {
    const result = checkoutReturnPathFor({ isStaff: false }, "a".repeat(500));
    expect(result).toBe(LEARNER_LANDING_PATH);
  });

  it("rejects a value containing a slash, colon, backslash, dot, percent sign, or whitespace", () => {
    for (const hostile of [
      "cohort/id",
      "cohort:id",
      "cohort\\id",
      "cohort.id",
      "cohort%20id",
      "cohort id",
    ]) {
      expect(checkoutReturnPathFor({ isStaff: false }, hostile)).toBe(LEARNER_LANDING_PATH);
    }
  });

  it("every returned value starts with exactly one slash and never contains //", () => {
    const cases: Array<[{ isStaff?: boolean | null }, string | null | undefined]> = [
      [{ isStaff: false }, `${VALID_COHORT_ID}.NGN`],
      [{ isStaff: true }, `${VALID_COHORT_ID}.NGN`],
      [{ isStaff: false }, null],
      [{ isStaff: false }, "//evil.example.com"],
      [{ isStaff: false }, "https://evil.example.com"],
    ];
    for (const [user, intent] of cases) {
      const result = checkoutReturnPathFor(user, intent);
      expect(result.startsWith("/")).toBe(true);
      expect(result.startsWith("//")).toBe(false);
      expect(result).not.toContain("//");
    }
  });

  it("landingPathFor still behaves exactly as before for every existing input", () => {
    expect(landingPathFor({ isStaff: true })).toBe(STAFF_LANDING_PATH);
    expect(landingPathFor({ isStaff: false })).toBe(LEARNER_LANDING_PATH);
    expect(landingPathFor({})).toBe(LEARNER_LANDING_PATH);
    expect(landingPathFor({ isStaff: null })).toBe(LEARNER_LANDING_PATH);
  });
});
