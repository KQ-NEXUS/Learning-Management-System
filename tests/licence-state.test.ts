/**
 * Pure licence state machine (plan 14-04): exact-boundary proofs for LIC-05.
 *
 * Fixture licence: expiresAt 2026-11-30T22:59:59.000Z, graceEndsAt
 * 2026-12-14T22:59:59.000Z. Every instant is a fixed literal; the module under
 * test never reads the wall clock.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DAY_MS, UNAVAILABLE_WINDOW_MS } from "@/server/licence/constants";
import {
  NEVER_ACTIVATED_POLICY,
  daysUntil,
  deriveState,
  dueNoticeKeys,
  isRestrictedState,
  noticeBucket,
  type DeriveInput,
  type DerivedState,
} from "@/server/licence/state";
import { LICENCE_STATES } from "@/server/licence/types";

const EXPIRES_AT = new Date("2026-11-30T22:59:59.000Z");
const GRACE_ENDS_AT = new Date("2026-12-14T22:59:59.000Z");
const RECORD = { expiresAt: EXPIRES_AT, graceEndsAt: GRACE_ENDS_AT };

function at(base: Date, offsetMs: number): Date {
  return new Date(base.getTime() + offsetMs);
}

function derive(now: Date, overrides: Partial<DeriveInput> = {}): DerivedState {
  return deriveState({
    everActivated: true,
    record: RECORD,
    verification: { kind: "OK" },
    attentionSince: null,
    lastGoodRestricted: false,
    now,
    ...overrides,
  });
}

describe("deriveState time boundaries (LIC-05, D-10, D-11)", () => {
  it("Test 1: EXPIRING_SOON begins exactly 60 days before expiry; 1 ms earlier is ACTIVE", () => {
    const before = derive(at(EXPIRES_AT, -(60 * DAY_MS) - 1));
    expect(before.state).toBe("ACTIVE");
    expect(before.daysRemaining).toBe(61);
    expect(before.isRestricted).toBe(false);

    const exactly = derive(at(EXPIRES_AT, -(60 * DAY_MS)));
    expect(exactly.state).toBe("EXPIRING_SOON");
    expect(exactly.daysRemaining).toBe(60);
    expect(exactly.isRestricted).toBe(false);
  });

  it("Test 2: 1 ms before expiry is EXPIRING_SOON, 1 day, under one day, not restricted", () => {
    const result = derive(at(EXPIRES_AT, -1));
    expect(result.state).toBe("EXPIRING_SOON");
    expect(result.daysRemaining).toBe(1);
    expect(result.daysToGraceEnd).toBeNull();
    expect(result.underOneDay).toBe(true);
    expect(result.isRestricted).toBe(false);
    expect(result.restrictedAt).toBeNull();
  });

  it("Test 3: exactly at expiry the state is GRACE with 14 days to grace end; 1 ms later is still 14 (ceiling)", () => {
    const exactly = derive(EXPIRES_AT);
    expect(exactly.state).toBe("GRACE");
    expect(exactly.daysToGraceEnd).toBe(14);
    expect(exactly.daysRemaining).toBeNull();
    expect(exactly.isRestricted).toBe(false);
    expect(exactly.restrictedAt).toBeNull();

    const later = derive(at(EXPIRES_AT, 1));
    expect(later.state).toBe("GRACE");
    expect(later.daysToGraceEnd).toBe(14);
  });

  it("Test 4: 1 ms before grace end is GRACE, 1 day, under one day", () => {
    const result = derive(at(GRACE_ENDS_AT, -1));
    expect(result.state).toBe("GRACE");
    expect(result.daysToGraceEnd).toBe(1);
    expect(result.underOneDay).toBe(true);
    expect(result.isRestricted).toBe(false);
  });

  it("Test 5: exactly at grace end the state is RESTRICTED_CONTINUITY and restrictedAt is exactly graceEndsAt, never the evaluation time", () => {
    const exactly = derive(GRACE_ENDS_AT);
    expect(exactly.state).toBe("RESTRICTED_CONTINUITY");
    expect(exactly.isRestricted).toBe(true);
    expect(exactly.restrictedAt?.getTime()).toBe(GRACE_ENDS_AT.getTime());
    expect(exactly.daysRemaining).toBeNull();
    expect(exactly.daysToGraceEnd).toBeNull();
    expect(exactly.underOneDay).toBe(false);

    const later = derive(at(GRACE_ENDS_AT, 10 * DAY_MS));
    expect(later.state).toBe("RESTRICTED_CONTINUITY");
    expect(later.restrictedAt?.getTime()).toBe(GRACE_ENDS_AT.getTime());
  });

  it("Test 6: leap year: exactly 24 hours is 1 day and not under one day; 48 hours is 2", () => {
    const record = { expiresAt: new Date("2028-03-01T00:00:00.000Z"), graceEndsAt: new Date("2028-03-15T00:00:00.000Z") };
    const exactDay = derive(new Date("2028-02-29T00:00:00.000Z"), { record });
    expect(exactDay.daysRemaining).toBe(1);
    expect(exactDay.underOneDay).toBe(false);
    expect(exactDay.state).toBe("EXPIRING_SOON");

    const twoDays = derive(new Date("2028-02-28T00:00:00.000Z"), { record });
    expect(twoDays.daysRemaining).toBe(2);
  });

  it("Test 7: daysUntil is an integer ceiling of the millisecond difference over 86,400,000", () => {
    const now = new Date("2026-10-01T00:00:00.000Z");
    expect(daysUntil(at(now, DAY_MS), now)).toBe(1);
    expect(daysUntil(at(now, DAY_MS + 1), now)).toBe(2);
    expect(daysUntil(at(now, 1), now)).toBe(1);
    expect(daysUntil(at(now, 7 * DAY_MS), now)).toBe(7);
    expect(daysUntil(now, now)).toBe(0);
    expect(Object.is(daysUntil(at(now, -1), now), -0)).toBe(false);
  });

  it("is a pure function of its input: repeated calls agree", () => {
    const now = at(EXPIRES_AT, -5 * DAY_MS);
    expect(derive(now)).toEqual(derive(now));
  });
});

describe("deriveState verification outcomes and OQ1", () => {
  it("a deterministic rejection is INVALID immediately, restricted, with a null restrictedAt (service records first observation)", () => {
    const result = derive(at(EXPIRES_AT, -100 * DAY_MS), {
      verification: { kind: "REJECTED", reasonCode: "BAD_SIGNATURE" },
    });
    expect(result.state).toBe("INVALID");
    expect(result.reasonCode).toBe("BAD_SIGNATURE");
    expect(result.isRestricted).toBe(true);
    expect(result.restrictedAt).toBeNull();
    expect(result.daysRemaining).toBeNull();
  });

  it("OQ1 option-a: the policy constant names unrestricted-until-first-activation", () => {
    expect(NEVER_ACTIVATED_POLICY).toBe("UNRESTRICTED_UNTIL_FIRST_ACTIVATION");
  });

  it("OQ1 option-a: a deployment that never activated is UNLICENSED and never restricted", () => {
    const result = derive(new Date("2026-10-01T00:00:00.000Z"), { everActivated: false, record: null });
    expect(result.state).toBe("UNLICENSED");
    expect(result.isRestricted).toBe(false);
    expect(result.reasonCode).toBeNull();
    expect(result.restrictedAt).toBeNull();
    expect(result.daysRemaining).toBeNull();
    expect(result.daysToGraceEnd).toBeNull();
    expect(result.underOneDay).toBe(false);
  });

  it("OQ1 option-a: a never-activated deployment stays unrestricted when the licence store is unreadable (nothing to verify)", () => {
    const now = new Date("2026-10-01T00:00:00.000Z");
    const result = derive(now, {
      everActivated: false,
      record: null,
      verification: { kind: "UNAVAILABLE" },
      attentionSince: at(now, -3 * DAY_MS),
    });
    expect(result.state).toBe("UNLICENSED");
    expect(result.isRestricted).toBe(false);
  });

  it("OQ1 option-a: enforcement is permanent after first activation: a missing record is INVALID RECORD_MISSING and restricted", () => {
    const result = derive(new Date("2026-10-01T00:00:00.000Z"), { everActivated: true, record: null });
    expect(result.state).toBe("INVALID");
    expect(result.reasonCode).toBe("RECORD_MISSING");
    expect(result.isRestricted).toBe(true);
    expect(result.restrictedAt).toBeNull();
  });
});

describe("D-04 attention window", () => {
  const now = new Date("2026-10-01T12:00:00.000Z");

  it("Test 1: a first failure (null attentionSince) is VALIDATION_ATTENTION and keeps the last-known restricted flag", () => {
    const kept = derive(now, { verification: { kind: "UNAVAILABLE" }, lastGoodRestricted: false });
    expect(kept.state).toBe("VALIDATION_ATTENTION");
    expect(kept.isRestricted).toBe(false);
    expect(kept.restrictedAt).toBeNull();

    const restrictedKept = derive(now, { verification: { kind: "UNAVAILABLE" }, lastGoodRestricted: true });
    expect(restrictedKept.state).toBe("VALIDATION_ATTENTION");
    expect(restrictedKept.isRestricted).toBe(true);
  });

  it("one millisecond short of 24 hours is still VALIDATION_ATTENTION", () => {
    const result = derive(now, {
      verification: { kind: "UNAVAILABLE" },
      attentionSince: at(now, -(UNAVAILABLE_WINDOW_MS - 1)),
    });
    expect(result.state).toBe("VALIDATION_ATTENTION");
    expect(result.isRestricted).toBe(false);
  });

  it("exactly 24 hours is INVALID with VALIDATION_WINDOW_EXHAUSTED and restricted", () => {
    const result = derive(now, {
      verification: { kind: "UNAVAILABLE" },
      attentionSince: at(now, -UNAVAILABLE_WINDOW_MS),
    });
    expect(result.state).toBe("INVALID");
    expect(result.reasonCode).toBe("VALIDATION_WINDOW_EXHAUSTED");
    expect(result.isRestricted).toBe(true);
    expect(result.restrictedAt).toBeNull();
  });

  it("an exhausted window stays INVALID well beyond 24 hours", () => {
    const result = derive(now, {
      verification: { kind: "UNAVAILABLE" },
      attentionSince: at(now, -10 * DAY_MS),
    });
    expect(result.state).toBe("INVALID");
    expect(result.reasonCode).toBe("VALIDATION_WINDOW_EXHAUSTED");
  });
});

describe("noticeBucket (D-10)", () => {
  it("returns the smallest of 60, 30, 14, 7, 3, 1 that is at least the remaining days", () => {
    const expected: Array<[number, number | null]> = [
      [61, null],
      [60, 60],
      [31, 60],
      [30, 30],
      [15, 30],
      [14, 14],
      [8, 14],
      [7, 7],
      [4, 7],
      [3, 3],
      [2, 3],
      [1, 1],
      [0, 1],
      [-4, 1],
    ];
    for (const [days, bucket] of expected) {
      expect(noticeBucket(days), `days=${days}`).toBe(bucket);
    }
  });
});

describe("dueNoticeKeys (D-10, research Pattern 8)", () => {
  const base: DerivedState = {
    state: "ACTIVE",
    reasonCode: null,
    isRestricted: false,
    restrictedAt: null,
    daysRemaining: null,
    daysToGraceEnd: null,
    underOneDay: false,
  };

  it("EXPIRING_SOON emits only the current bucket, never the buckets that were missed", () => {
    expect(
      dueNoticeKeys({ derived: { ...base, state: "EXPIRING_SOON", daysRemaining: 31 }, attentionSince: null }),
    ).toEqual(["expiring-60"]);
    expect(
      dueNoticeKeys({ derived: { ...base, state: "EXPIRING_SOON", daysRemaining: 1 }, attentionSince: null }),
    ).toEqual(["expiring-1"]);
    expect(
      dueNoticeKeys({ derived: { ...base, state: "EXPIRING_SOON", daysRemaining: 8 }, attentionSince: null }),
    ).toEqual(["expiring-14"]);
  });

  it("GRACE emits expired, plus grace-ending within 3 days of grace end", () => {
    expect(
      dueNoticeKeys({ derived: { ...base, state: "GRACE", daysToGraceEnd: 14 }, attentionSince: null }),
    ).toEqual(["expired"]);
    expect(
      dueNoticeKeys({ derived: { ...base, state: "GRACE", daysToGraceEnd: 4 }, attentionSince: null }),
    ).toEqual(["expired"]);
    expect(
      dueNoticeKeys({ derived: { ...base, state: "GRACE", daysToGraceEnd: 3 }, attentionSince: null }),
    ).toEqual(["expired", "grace-ending"]);
    expect(
      dueNoticeKeys({ derived: { ...base, state: "GRACE", daysToGraceEnd: 1 }, attentionSince: null }),
    ).toEqual(["expired", "grace-ending"]);
  });

  it("RESTRICTED_CONTINUITY emits restricted", () => {
    expect(
      dueNoticeKeys({ derived: { ...base, state: "RESTRICTED_CONTINUITY", isRestricted: true }, attentionSince: null }),
    ).toEqual(["restricted"]);
  });

  it("INVALID emits invalid- followed by the reason code", () => {
    expect(
      dueNoticeKeys({
        derived: { ...base, state: "INVALID", reasonCode: "BAD_SIGNATURE", isRestricted: true },
        attentionSince: null,
      }),
    ).toEqual(["invalid-BAD_SIGNATURE"]);
  });

  it("VALIDATION_ATTENTION emits validation-attention- followed by the epoch seconds of attentionSince", () => {
    const attentionSince = new Date("2026-10-01T00:00:00.000Z");
    expect(
      dueNoticeKeys({ derived: { ...base, state: "VALIDATION_ATTENTION" }, attentionSince }),
    ).toEqual([`validation-attention-${Math.floor(attentionSince.getTime() / 1000)}`]);
    expect(
      dueNoticeKeys({ derived: { ...base, state: "VALIDATION_ATTENTION" }, attentionSince }),
    ).toEqual(["validation-attention-1790812800"]);
  });

  it("ACTIVE and UNLICENSED emit nothing", () => {
    expect(dueNoticeKeys({ derived: base, attentionSince: null })).toEqual([]);
    expect(dueNoticeKeys({ derived: { ...base, state: "UNLICENSED" }, attentionSince: null })).toEqual([]);
  });

  it("derived time-based states feed the keys end to end at the exact expiry boundary (tracer)", () => {
    const justBefore = derive(at(EXPIRES_AT, -1));
    expect(dueNoticeKeys({ derived: justBefore, attentionSince: null })).toEqual(["expiring-1"]);
    const atExpiry = derive(EXPIRES_AT);
    expect(dueNoticeKeys({ derived: atExpiry, attentionSince: null })).toEqual(["expired"]);
    const atGraceEnd = derive(GRACE_ENDS_AT);
    expect(dueNoticeKeys({ derived: atGraceEnd, attentionSince: null })).toEqual(["restricted"]);
  });
});

describe("isRestrictedState (D-01, D-05)", () => {
  it("is true for RESTRICTED_CONTINUITY and INVALID only", () => {
    const restricted = LICENCE_STATES.filter((state) => isRestrictedState(state));
    expect(restricted).toEqual(["RESTRICTED_CONTINUITY", "INVALID"]);
  });

  it("the state vocabulary keeps the seven separately named states", () => {
    expect([...LICENCE_STATES]).toEqual([
      "UNLICENSED",
      "ACTIVE",
      "EXPIRING_SOON",
      "GRACE",
      "RESTRICTED_CONTINUITY",
      "INVALID",
      "VALIDATION_ATTENTION",
    ]);
  });
});

describe("state.ts never reads the wall clock", () => {
  it("contains neither a no-argument Date construction nor a Date.now call", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/server/licence/state.ts"), "utf8");
    expect(source.includes("new Date()")).toBe(false);
    expect(source.includes("Date.now()")).toBe(false);
  });
});
