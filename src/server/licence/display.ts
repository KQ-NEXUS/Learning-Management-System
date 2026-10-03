/**
 * Instant formatting for the licence screens, notices and emails (Phase 14,
 * plan 14-06, D-11).
 *
 * Every instant is shown as `d MMM yyyy, HH:mm {zone abbreviation}` in the
 * licence's signed IANA zone (fallback Africa/Lagos), 24-hour clock, with the
 * exact UTC instant shown beside it by the caller (`formatUtcInstant`). The
 * formatter is built from `Intl.DateTimeFormat` with an explicit `timeZone`,
 * locale `en-GB` and `hourCycle: "h23"`, so server and browser output are
 * byte-identical and midnight is `00:00`, never `24:00`.
 *
 * PURE MODULE: no Prisma, no Next.js, no wall-clock read. The zone is display
 * only; it never influences a state decision (state.ts compares epoch ms).
 */

/** UI-SPEC Date format rule: the fallback zone when the signed zone is absent or unusable. */
export const DEFAULT_DISPLAY_ZONE = "Africa/Lagos";

/**
 * Month abbreviations are fixed here, not taken from ICU: newer CLDR data
 * renders September as "Sept" in en-GB and older data as "Sep", which would
 * make server and browser output differ (D-11, byte-identical rendering).
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * en-GB short zone names are numeric offsets ("GMT+1") for most African zones,
 * but the UI-SPEC prints "WAT". These named abbreviations are pinned for the
 * zones the product serves; any other zone uses the en-GB short name from
 * Intl (BST, GMT, CET, UTC or a GMT offset).
 */
const ZONE_ABBREVIATIONS: Readonly<Record<string, string>> = {
  "Africa/Lagos": "WAT",
  "Africa/Johannesburg": "SAST",
  "Africa/Nairobi": "EAT",
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function buildFormatter(zone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hourCycle: "h23",
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function formatterFor(zone: string | null): Intl.DateTimeFormat {
  const wanted = zone ?? DEFAULT_DISPLAY_ZONE;
  const cached = formatterCache.get(wanted);
  if (cached) return cached;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = buildFormatter(wanted);
  } catch {
    // An unknown IANA name throws RangeError: fall back rather than fail a render.
    formatter = buildFormatter(DEFAULT_DISPLAY_ZONE);
  }
  formatterCache.set(wanted, formatter);
  return formatter;
}

/** `30 Nov 2026, 23:59 WAT` for an instant in the licence's zone (null or invalid: Africa/Lagos). */
export function formatLicenceInstant(date: Date, zone: string | null): string {
  const formatter = formatterFor(zone);
  const parts = formatter.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  const month = MONTHS[Number(pick("month")) - 1] ?? "";
  const resolvedZone = formatter.resolvedOptions().timeZone;
  const abbreviation = ZONE_ABBREVIATIONS[resolvedZone] ?? pick("timeZoneName");
  // Day is normalised to a bare number: ICU may pad it when the time fields are two-digit.
  const day = String(Number(pick("day")));
  return `${day} ${month} ${pick("year")}, ${pick("hour")}:${pick("minute")} ${abbreviation}`;
}

/** The exact UTC instant without milliseconds, e.g. `2026-11-30T22:59:59Z`. */
export function formatUtcInstant(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}
