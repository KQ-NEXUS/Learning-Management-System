/**
 * The v1 `completionRule` payload shape and its parser (D-10, DD-3, DD-9).
 *
 * PURE MODULE — no imports at all. Same discipline as `readiness-service.ts`
 * and `attendance-component.ts`.
 *
 * DD-3: the v1 payload is `{ "version": 1, "requireAllRequiredLessons": true }`.
 * The attendance component of D-10(b) is switched on by
 * `Cohort.attendanceThresholdPct` being non-null — NOT by a field inside the
 * JSON — because D-10(b) names that column as the threshold source. This
 * parser therefore takes the cohort threshold as a separate argument and
 * folds it into the returned rule. An unrecognised `version` in the JSON is
 * a thrown error, never a silent downgrade to v1.
 *
 * DD-9: callers MUST source `json`/`ruleVersion` from the pinned
 * publication payload (`CoursePublication.payload` / `ProgrammePublication.payload`),
 * never from the live `Course`/`Programme` row. D-05 (Phase 4) exists
 * precisely so a live edit cannot retroactively change what an enrolled
 * learner is evaluated against — that scoping is a caller obligation
 * enforced in plan 09-04, not something this parser can check. This parser
 * simply accepts whatever JSON it is handed.
 */

export type CompletionRuleV1 = {
  version: 1;
  requireAllRequiredLessons: true;
  attendanceThresholdPct: number | null;
};

/**
 * The recognised v1 key set. Declared once here so a future phase widens
 * ONE list rather than hunting through branches — Phase 10 will add
 * assessment criteria deliberately (bumping to v2), not silently smuggle a
 * new key into v1's closed set.
 */
const RECOGNISED_V1_KEYS = ["version", "requireAllRequiredLessons"] as const;

export class UnsupportedCompletionRuleVersionError extends Error {
  readonly version: unknown;

  constructor(version: unknown) {
    super(`Unsupported completion rule version: ${JSON.stringify(version)}`);
    this.name = "UnsupportedCompletionRuleVersionError";
    this.version = version;
  }
}

export class UnsupportedCompletionRuleFieldError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(`Unsupported completion rule field: ${key}`);
    this.name = "UnsupportedCompletionRuleFieldError";
    this.key = key;
  }
}

function isRecognisedV1Key(key: string): key is (typeof RECOGNISED_V1_KEYS)[number] {
  return (RECOGNISED_V1_KEYS as readonly string[]).includes(key);
}

/**
 * Parses a stored `completionRule` JSON blob (plus its sibling
 * `completionRuleVersion` column and the cohort's attendance threshold)
 * into the typed v1 rule shape.
 *
 * A `null`/absent `json` still requires all required lessons — D-10(a)
 * always applies, with or without a stored rule. `ruleVersion` is the
 * authoritative version (the `completionRuleVersion` column); if the JSON
 * blob itself carries its own `version` field, the two must agree — either
 * one being anything other than `1` throws, it never silently falls back to
 * v1 behavior.
 */
export function parseCompletionRule(input: {
  json: unknown;
  ruleVersion: number;
  cohortAttendanceThresholdPct: number | null;
}): CompletionRuleV1 {
  const { json, ruleVersion, cohortAttendanceThresholdPct } = input;

  if (ruleVersion !== 1) {
    throw new UnsupportedCompletionRuleVersionError(ruleVersion);
  }

  if (json != null) {
    if (typeof json !== "object" || Array.isArray(json)) {
      throw new UnsupportedCompletionRuleVersionError(json);
    }

    const record = json as Record<string, unknown>;

    for (const key of Object.keys(record)) {
      if (!isRecognisedV1Key(key)) {
        throw new UnsupportedCompletionRuleFieldError(key);
      }
    }

    if ("version" in record && record.version !== 1) {
      throw new UnsupportedCompletionRuleVersionError(record.version);
    }
  }

  return {
    version: 1,
    requireAllRequiredLessons: true,
    attendanceThresholdPct: cohortAttendanceThresholdPct,
  };
}
