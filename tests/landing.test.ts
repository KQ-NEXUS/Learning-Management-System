import { describe, expect, it } from "vitest";
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
