/**
 * Shared numeric and vocabulary constants for the software-licence module
 * (Phase 14). Pure: no imports, so the verifier, the provider tool and the
 * state machine (plan 14-04) can all depend on one definition.
 *
 * Several constants are not used by the verifier itself; they are exported
 * here once because plan 14-04 (state derivation, notices, high-water mark)
 * reads them and two copies would drift.
 */

/** One UTC day in milliseconds. All licence arithmetic is UTC-instant based. */
export const DAY_MS = 86_400_000;

/** D-12: tolerated clock skew (10 minutes) before a clock anomaly matters. */
export const SKEW_TOLERANCE_MS = 600_000;

/** Maximum accepted licence file length in characters (D-02 envelope limit). */
export const MAX_LICENCE_FILE_CHARS = 8192;

/** D-04: last-known-good window for local verification failures (24 hours). */
export const UNAVAILABLE_WINDOW_MS = 86_400_000;

/** D-10: Administrator expiry-notice cadence, days before expiry. */
export const EXPIRY_NOTICE_DAYS = [60, 30, 14, 7, 3, 1] as const;

/** Days before expiry at which the state becomes EXPIRING_SOON (A4). */
export const EXPIRING_SOON_DAYS = 60;

/** Days before grace end at which the grace-ending notice fires (A4). */
export const GRACE_ENDING_NOTICE_DAYS = 3;

/** D-12: minimum spacing between high-water-mark writes (5 minutes). */
export const HIGH_WATER_WRITE_THROTTLE_MS = 300_000;

/** The published envelope prefix for payload schema version 1 (D-02). */
export const ENVELOPE_PREFIX = "LMS-LIC1";

/**
 * Payload schema versions this build understands. Only ever grows within a
 * licence-term horizon (Pitfall 11): dropping a version restricts every
 * deployment holding a licence of that version.
 */
export const SUPPORTED_SCHEMA_VERSIONS = [1] as const;
