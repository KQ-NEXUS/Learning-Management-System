/**
 * Task 3 (plan 10-01): Submission-scoped storage key builders (T-10-06).
 *
 * Asserts the two builders produce the documented prefixes and embed both
 * ids, that two successive calls with identical inputs produce different
 * keys (the `randomUUID()` component), that `finalSubmissionKeyFor` maps a
 * staged submission key to its final key, and that the promote path is
 * isolated from the Lesson domain in both directions.
 */

import { describe, expect, it } from "vitest";
import {
  buildSubmissionStorageKey,
  buildStagedSubmissionStorageKey,
  finalSubmissionKeyFor,
  finalStorageKeyFor,
} from "@/server/services/storage-service";

const enrolmentId = "enr-1";
const assessmentId = "asm-1";

describe("buildSubmissionStorageKey", () => {
  it("produces a submissions/<enrolmentId>/<assessmentId>/<uuid> key", () => {
    const key = buildSubmissionStorageKey({ enrolmentId, assessmentId });
    expect(key).toMatch(/^submissions\/enr-1\/asm-1\/[^/]+$/);
  });

  it("two successive calls with identical inputs produce different keys", () => {
    const a = buildSubmissionStorageKey({ enrolmentId, assessmentId });
    const b = buildSubmissionStorageKey({ enrolmentId, assessmentId });
    expect(a).not.toBe(b);
  });
});

describe("buildStagedSubmissionStorageKey", () => {
  it("produces a submission-uploads/<enrolmentId>/<assessmentId>/<uuid> key", () => {
    const key = buildStagedSubmissionStorageKey({ enrolmentId, assessmentId });
    expect(key).toMatch(/^submission-uploads\/enr-1\/asm-1\/[^/]+$/);
  });

  it("two successive calls with identical inputs produce different keys", () => {
    const a = buildStagedSubmissionStorageKey({ enrolmentId, assessmentId });
    const b = buildStagedSubmissionStorageKey({ enrolmentId, assessmentId });
    expect(a).not.toBe(b);
  });
});

describe("finalSubmissionKeyFor", () => {
  it("maps submission-uploads/... to submissions/...", () => {
    const staged = buildStagedSubmissionStorageKey({ enrolmentId, assessmentId });
    const final = finalSubmissionKeyFor(staged);
    expect(final).toBe(staged.replace(/^submission-uploads\//, "submissions/"));
    expect(final.startsWith("submissions/")).toBe(true);
  });

  it("throws for a lesson-uploads/ key", () => {
    expect(() => finalSubmissionKeyFor("lesson-uploads/lesson-1/abc")).toThrow();
  });

  it("throws for a bare submissions/ key (already-final, not staged)", () => {
    expect(() => finalSubmissionKeyFor("submissions/enr-1/asm-1/abc")).toThrow();
  });
});

describe("finalStorageKeyFor (existing Lesson function) stays isolated from the Submission domain", () => {
  it("throws for a submission-uploads/ key", () => {
    expect(() => finalStorageKeyFor("submission-uploads/enr-1/asm-1/abc")).toThrow();
  });
});
