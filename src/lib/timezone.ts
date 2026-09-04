/**
 * Wall-clock <-> UTC conversion for cohort scheduling (D-23).
 *
 * PURE MODULE. No imports, no data access, no UI. Staff enter a session's
 * date and time in the cohort's IANA `timezone`; the value is stored UTC on
 * `ScheduledSession.startsAt` / `endsAt`. This module is the single place
 * that conversion happens, in both directions.
 *
 * Implementation: interpret the entered wall time as if it were UTC, ask
 * `Intl.DateTimeFormat` what that instant looks like in the target zone,
 * and correct by the difference. See RESEARCH 05 "Timezone" code example.
 *
 * SINGLE-PASS DST CAVEAT. `wallTimeToUtc` corrects by the zone's offset at
 * the computed instant in one pass. For a "spring-forward" gap or a
 * "fall-back" overlap that single-pass offset can land an hour off. The
 * schema default `Africa/Lagos` observes no DST, so this is not a
 * today-problem. If a DST-observing zone is ever configured, either iterate
 * the offset correction a second time or adopt the standard "use the offset
 * in effect before the transition" convention. A dedicated date-time
 * library would remove this footgun but the stable options are not
 * available in Node 22.14, so this hand-rolled correction is used instead.
 */

export type WallTimeParts = {
  /** Full year, e.g. 2026. */
  year: number;
  /** 1-12. */
  month: number;
  /** 1-31. */
  day: number;
  /** 0-23. */
  hour: number;
  /** 0-59. */
  minute: number;
};

/**
 * Whether `timeZone` is an IANA zone this runtime knows. The empty string
 * and any typo (`"Mars/Olympus"`) are rejected before they can be stored on
 * a Cohort.
 */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) {
    return false;
  }
  return Intl.supportedValuesOf("timeZone").includes(timeZone);
}

/**
 * Given wall-clock components as entered in `timeZone`, return the UTC
 * instant they name.
 */
export function wallTimeToUtc(parts: WallTimeParts, timeZone: string): Date {
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
  );
  const offsetMs = zoneOffsetMs(asUtc, timeZone);
  return new Date(asUtc - offsetMs);
}

/**
 * Given a UTC instant, return the wall-clock components an observer in
 * `timeZone` would read off the clock, plus a `label` for display.
 */
export function utcToWallParts(
  instant: Date,
  timeZone: string,
): WallTimeParts & { label: string } {
  const p = zoneParts(instant.getTime(), timeZone);
  return {
    year: p.year,
    month: p.month,
    day: p.day,
    hour: p.hour,
    minute: p.minute,
    label:
      `${pad(p.year, 4)}-${pad(p.month, 2)}-${pad(p.day, 2)} ` +
      `${pad(p.hour, 2)}:${pad(p.minute, 2)} (${timeZone})`,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type ZoneParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function zoneParts(epochMs: number, timeZone: string): ZoneParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const map: Record<string, number> = {};
  for (const part of dtf.formatToParts(new Date(epochMs))) {
    if (part.type !== "literal") {
      map[part.type] = Number(part.value);
    }
  }

  // Some engines format midnight as hour "24" rather than "00".
  const hour = map.hour === 24 ? 0 : map.hour;

  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour,
    minute: map.minute,
    second: map.second,
  };
}

/** Milliseconds the zone is ahead of UTC at the instant `asUtc` names. */
function zoneOffsetMs(asUtc: number, timeZone: string): number {
  const p = zoneParts(asUtc, timeZone);
  const tzAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return tzAsUtc - asUtc;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}
