/**
 * The v1 `completionRule` payload shape and its parser (D-10, DD-3, DD-9).
 *
 * PURE MODULE — no imports at all. Same discipline as `readiness-service.ts`
 * and `attendance-component.ts`.
 *
 * DD-3: the v1 payload is `{ "version": 1, "requireAllRequiredLessons": true }`;
 * v2 (see `CompletionRuleV2`) adds `requirePassingAssessments`.
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
 * v2 adds one per-course switch: every assessment linked from the pinned
 * lessons must have a released, non-failing result. Stored as
 * `{ "version": 2, "requireAllRequiredLessons": true, "requirePassingAssessments": true }`
 * with `completionRuleVersion = 2`. A course that never opts in stays v1.
 */
export type CompletionRuleV2 = {
  version: 2;
  requireAllRequiredLessons: true;
  attendanceThresholdPct: number | null;
  requirePassingAssessments: boolean;
};

export type CompletionRule = CompletionRuleV1 | CompletionRuleV2;

/**
 * The recognised key set per version. Declared once here so a future version
 * widens ONE list rather than hunting through branches, and an unknown key is
 * never silently smuggled into an older version's closed set.
 */
const RECOGNISED_KEYS: Record<1 | 2, readonly string[]> = {
  1: ["version", "requireAllRequiredLessons"],
  2: ["version", "requireAllRequiredLessons", "requirePassingAssessments"],
};

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

/**
 * Parses a stored `completionRule` JSON blob (plus its sibling
 * `completionRuleVersion` column and the cohort's attendance threshold)
 * into the typed v1 rule shape.
 *
 * A `null`/absent `json` still requires all required lessons — D-10(a)
 * always applies, with or without a stored rule. `ruleVersion` is the
 * authoritative version (the `completionRuleVersion` column); if the JSON
 * blob itself carries its own `version` field, the two must agree — any
 * version other than `1` or `2` throws, it never silently falls back to
 * v1 behavior.
 */
export function parseCompletionRule(input: {
  json: unknown;
  ruleVersion: number;
  cohortAttendanceThresholdPct: number | null;
}): CompletionRule {
  const { json, ruleVersion, cohortAttendanceThresholdPct } = input;

  if (ruleVersion !== 1 && ruleVersion !== 2) {
    throw new UnsupportedCompletionRuleVersionError(ruleVersion);
  }

  let requirePassingAssessments = false;

  if (json != null) {
    if (typeof json !== "object" || Array.isArray(json)) {
      throw new UnsupportedCompletionRuleVersionError(json);
    }

    const record = json as Record<string, unknown>;

    for (const key of Object.keys(record)) {
      if (!RECOGNISED_KEYS[ruleVersion].includes(key)) {
        throw new UnsupportedCompletionRuleFieldError(key);
      }
    }

    if ("version" in record && record.version !== ruleVersion) {
      throw new UnsupportedCompletionRuleVersionError(record.version);
    }

    if ("requirePassingAssessments" in record) {
      if (typeof record.requirePassingAssessments !== "boolean") {
        throw new UnsupportedCompletionRuleFieldError("requirePassingAssessments");
      }
      requirePassingAssessments = record.requirePassingAssessments;
    }
  }

  if (ruleVersion === 2) {
    return {
      version: 2,
      requireAllRequiredLessons: true,
      attendanceThresholdPct: cohortAttendanceThresholdPct,
      requirePassingAssessments,
    };
  }

  return {
    version: 1,
    requireAllRequiredLessons: true,
    attendanceThresholdPct: cohortAttendanceThresholdPct,
  };
}
