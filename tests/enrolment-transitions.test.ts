/**
 * Plan 11-01: certificate-driven completion reversal (D-06, CRD-06).
 */

import { describe, expect, it } from "vitest";
import {
  assertTransition,
  IllegalTransitionError,
  VALID_TRANSITIONS,
} from "@/server/services/enrolment-transitions";

describe("completion re-evaluation transitions", () => {
  it("allows COMPLETED to return to ACTIVE", () => {
    expect(() => assertTransition("COMPLETED", "ACTIVE")).not.toThrow();
  });

  it.each(["WITHDRAWN", "CANCELLED", "TRANSFERRED"] as const)(
    "refuses COMPLETED to %s",
    (status) => {
      expect(() => assertTransition("COMPLETED", status)).toThrow(
        IllegalTransitionError,
      );
    },
  );

  it("keeps the other terminal states closed", () => {
    expect(VALID_TRANSITIONS.WITHDRAWN).toEqual([]);
    expect(VALID_TRANSITIONS.TRANSFERRED).toEqual([]);
    expect(VALID_TRANSITIONS.CANCELLED).toEqual([]);
  });

  it("keeps the existing ACTIVE destinations unchanged", () => {
    expect(VALID_TRANSITIONS.ACTIVE).toEqual([
      "WITHDRAWN",
      "TRANSFERRED",
      "COMPLETED",
      "CANCELLED",
    ]);
  });
});
