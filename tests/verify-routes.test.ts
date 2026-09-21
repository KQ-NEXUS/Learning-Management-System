/**
 * Route-table guard (plan 11-21, UAT test 13, threat T-11-87).
 *
 * `/verify` belongs to IAM-02 email verification (`(auth)/verify/page.tsx`,
 * linked from already-dispatched emails). Next.js refuses two pages on one
 * path, so the public reference-entry page lives at `/verify-certificate`.
 * These assertions fail loudly if a bare `src/app/verify/page.tsx` is ever
 * added or the auth page is moved.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const exists = (rel: string) => fs.existsSync(path.resolve(process.cwd(), rel));

describe("verification route table", () => {
  it("keeps the IAM-02 email-verification page at /verify", () => {
    expect(exists("src/app/(auth)/verify/page.tsx")).toBe(true);
  });

  it("keeps the public result page at /verify/[verificationRef]", () => {
    expect(exists("src/app/verify/[verificationRef]/page.tsx")).toBe(true);
  });

  it("serves the reference-entry page at the non-colliding /verify-certificate", () => {
    expect(exists("src/app/verify-certificate/page.tsx")).toBe(true);
    expect(exists("src/app/verify-certificate/layout.tsx")).toBe(true);
  });

  it("has NO src/app/verify/page.tsx (would collide with the auth page)", () => {
    expect(exists("src/app/verify/page.tsx")).toBe(false);
  });
});
