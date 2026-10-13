/**
 * Pure licence state machine, day arithmetic and notice keys (Phase 14, plan
 * 14-04). Restriction is a deterministic function of the signed dates plus the
 * instant passed in as `now`; there is no scheduler dependency (research
 * Pattern 2). Nothing here is a database-wide switch (D-01, D-05).
 *
 * Rules enforced here:
 * - All instants are compared as epoch milliseconds (UTC). Calendar, DST and
 *   leap-day behaviour live only in the display formatter (plan 14-06), so the
 *   day 2028-02-29 or an Africa/Lagos date rollover cannot change a state.
 * - D-11: the grace end is the signed `graceEndsAt`; the LMS never adds days.
 * - Day counts are the ceiling of an integer-millisecond difference over
 *   DAY_MS. No other rounding mode exists in this module.
 * - The wall clock is never read here: `now` is always an argument.
 * - Evaluation always uses the `now` it is given (the current clock) and never
 *   a stored high-water mark (see clock.ts, research Pitfall 3).
 */

import {
  DAY_MS,
  EXPIRING_SOON_DAYS,
  EXPIRY_NOTICE_DAYS,
  GRACE_ENDING_NOTICE_DAYS,
  UNAVAILABLE_WINDOW_MS,
} from "./constants";
import type { LicenceStateName } from "./types";

/**
 * OQ1 decision (14-DECISIONS.md, section "OQ1 never-activated decision",
 * owner answer option-a, 2026-10-01): a deployment that has never activated a
 * licence is fully operational (state UNLICENSED, never restricted). The first
 * successful activation flips the permanent `everActivated` flag, after which
 * enforcement is permanent. This is the single place the policy is named; the
 * schema is identical for every option, only `deriveState` depends on it.
 */
export type NeverActivatedPolicy = "UNRESTRICTED_UNTIL_FIRST_ACTIVATION";
export const NEVER_ACTIVATED_POLICY: NeverActivatedPolicy = "UNRESTRICTED_UNTIL_FIRST_ACTIVATION";

export type LicenceVerification =
  | { kind: "OK" }
  | { kind: "REJECTED"; reasonCode: string }
  | { kind: "UNAVAILABLE" };

export interface DeriveInput {
  everActivated: boolean;
  record: { expiresAt: Date; graceEndsAt: Date } | null;
  verification: LicenceVerification;
  /** Start of the current local-failure window (D-04); null means it starts now. */
  attentionSince: Date | null;
  /** The restricted flag of the last known good evaluation, kept during the window. */
  lastGoodRestricted: boolean;
  now: Date;
}

export interface DerivedState {
  state: LicenceStateName;
  reasonCode: string | null;
  isRestricted: boolean;
  /** Exact graceEndsAt for RESTRICTED_CONTINUITY; null otherwise (the service stamps INVALID). */
  restrictedAt: Date | null;
  daysRemaining: number | null;
  daysToGraceEnd: number | null;
  underOneDay: boolean;
}

/** Whole days from `now` to `target`, rounded up: exactly N days is N, N days plus 1 ms is N+1. */
export function daysUntil(target: Date, now: Date): number {
  // Adding zero normalises a negative zero produced by ceiling a small negative.
  return Math.ceil((target.getTime() - now.getTime()) / DAY_MS) + 0;
}

/** D-01: restricted continuity and invalid are the only restricted states. */
export function isRestrictedState(state: LicenceStateName): boolean {
  return state === "RESTRICTED_CONTINUITY" || state === "INVALID";
}

function result(
  state: LicenceStateName,
  fields: Partial<Omit<DerivedState, "state">> = {},
): DerivedState {
  return {
    state,
    reasonCode: null,
    isRestricted: isRestrictedState(state),
    restrictedAt: null,
    daysRemaining: null,
    daysToGraceEnd: null,
    underOneDay: false,
    ...fields,
  };
}

/** UNLICENSED outcome for a deployment that never activated, per NEVER_ACTIVATED_POLICY. */
function neverActivated(): DerivedState {
  return {
    state: "UNLICENSED",
    reasonCode: null,
    // UNRESTRICTED_UNTIL_FIRST_ACTIVATION: never restricted before first activation.
    isRestricted: false,
    restrictedAt: null,
    daysRemaining: null,
    daysToGraceEnd: null,
    underOneDay: false,
  };
}

export function deriveState(input: DeriveInput): DerivedState {
  const { everActivated, record, verification, attentionSince, lastGoodRestricted, now } = input;

  // Deterministic rejection: restricted at once; the service records the first observation.
  if (verification.kind === "REJECTED") {
    return result("INVALID", { reasonCode: verification.reasonCode, isRestricted: true });
  }

  // Nothing was ever activated: there is no licence to verify or to lose (OQ1 option-a).
  if (record === null && !everActivated) {
    return neverActivated();
  }

  // D-04: transient failure keeps the last known restricted flag for exactly 24 hours.
  if (verification.kind === "UNAVAILABLE") {
    const since = attentionSince ?? now;
    if (now.getTime() - since.getTime() >= UNAVAILABLE_WINDOW_MS) {
      return result("INVALID", { reasonCode: "VALIDATION_WINDOW_EXHAUSTED", isRestricted: true });
    }
    return result("VALIDATION_ATTENTION", { isRestricted: lastGoodRestricted });
  }

  if (record === null) {
    // Activated before, yet no record is readable: enforcement is permanent.
    return result("INVALID", { reasonCode: "RECORD_MISSING", isRestricted: true });
  }

  const nowMs = now.getTime();
  const untilExpiryMs = record.expiresAt.getTime() - nowMs;
  const untilGraceEndMs = record.graceEndsAt.getTime() - nowMs;

  if (untilGraceEndMs <= 0) {
    // Time-derived restriction began at the signed instant, not at evaluation time.
    return result("RESTRICTED_CONTINUITY", {
      isRestricted: true,
      restrictedAt: new Date(record.graceEndsAt.getTime()),
    });
  }

  if (untilExpiryMs <= 0) {
    return result("GRACE", {
      daysToGraceEnd: daysUntil(record.graceEndsAt, now),
      underOneDay: untilGraceEndMs < DAY_MS,
    });
  }

  return result(untilExpiryMs <= EXPIRING_SOON_DAYS * DAY_MS ? "EXPIRING_SOON" : "ACTIVE", {
    daysRemaining: daysUntil(record.expiresAt, now),
    underOneDay: untilExpiryMs < DAY_MS,
  });
}

/**
 * D-10: the smallest notice day (60, 30, 14, 7, 3, 1) that is at least the
 * remaining days; null when more than the largest remain; 1 below one day.
 */
export function noticeBucket(daysRemaining: number): number | null {
  const buckets = [...EXPIRY_NOTICE_DAYS].sort((a, b) => a - b);
  if (daysRemaining > buckets[buckets.length - 1]) return null;
  for (const bucket of buckets) {
    if (daysRemaining <= bucket) return bucket;
  }
  return null;
}

/**
 * Notice dedupe keys due for a derived state (research Pattern 8). Only the
 * current bucket is reported, so a task that was down for a week emits one
 * notice, not six. Keys: expiring-{60|30|14|7|3|1}, expired, grace-ending,
 * restricted, invalid-{reasonCode}, validation-attention-{epoch seconds}.
 */
export function dueNoticeKeys(input: {
  derived: DerivedState;
  attentionSince: Date | null;
}): string[] {
  const { derived, attentionSince } = input;
  switch (derived.state) {
    case "EXPIRING_SOON": {
      if (derived.daysRemaining === null) return [];
      const bucket = noticeBucket(derived.daysRemaining);
      return bucket === null ? [] : [`expiring-${bucket}`];
    }
    case "GRACE": {
      const keys = ["expired"];
      if (derived.daysToGraceEnd !== null && derived.daysToGraceEnd <= GRACE_ENDING_NOTICE_DAYS) {
        keys.push("grace-ending");
      }
      return keys;
    }
    case "RESTRICTED_CONTINUITY":
      return ["restricted"];
    case "INVALID":
      return [`invalid-${derived.reasonCode ?? "UNKNOWN"}`];
    case "VALIDATION_ATTENTION":
      return attentionSince === null
        ? []
        : [`validation-attention-${Math.floor(attentionSince.getTime() / 1000)}`];
    default:
      return [];
  }
}
