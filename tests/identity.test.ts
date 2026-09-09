import { describe, expect, it } from "vitest";
import { POLICY_TYPE, POLICY_VERSIONS } from "@/lib/identity";

describe("POLICY_TYPE / POLICY_VERSIONS", () => {
  it("defines REFUND_CANCELLATION as a new, additive policy type", () => {
    expect(POLICY_TYPE.REFUND_CANCELLATION).toBe("refund_cancellation");
  });

  it("carries a non-empty, date-shaped version string for REFUND_CANCELLATION", () => {
    const version = POLICY_VERSIONS[POLICY_TYPE.REFUND_CANCELLATION];
    expect(version).toBeTruthy();
    expect(version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("leaves MARKETING unchanged — checkout writes to this same key, never a new one", () => {
    expect(POLICY_TYPE.MARKETING).toBe("marketing");
    expect(POLICY_VERSIONS[POLICY_TYPE.MARKETING]).toBe("2026-09-02");
  });
});
