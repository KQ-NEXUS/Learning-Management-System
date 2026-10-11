/**
 * Deterministic Lagos-time formatting for every rendered date and time (D-17, UI-SPEC S6).
 *
 * PURE MODULE, no imports: safe in server and client components alike.
 *
 * Why pinned: `Date.prototype.toLocaleString()` / `toLocaleDateString()` depend
 * on the runtime's own locale and ICU data, which differ between a server render
 * (a container with no locale of its own) and a browser (the visitor's locale).
 * The same instant then renders as two different strings, which is a React
 * hydration mismatch (error #418), not a cosmetic quirk. This module pins the
 * locale ("en-GB") and the zone ("Africa/Lagos"), reads only numeric parts from
 * `Intl.DateTimeFormat#formatToParts`, and assembles the text with fixed
 * separators, so the server render and every browser engine produce
 * byte-identical output.
 *
 * Two ICU differences are deliberately bypassed:
 * - Month names come from a fixed table, not ICU: newer CLDR data renders
 *   September as "Sept" in en-GB and older data as "Sep".
 * - The zone label is the literal " WAT" (LAGOS_ZONE_LABEL), never the
 *   `timeZoneName` option, which prints "GMT+1" for Africa/Lagos in en-GB.
 *
 * Africa/Lagos observes no daylight saving, so WAT (UTC+1) is correct all year.
 *
 * Output shapes:
 * - date and time:            "5 Oct 2026, 14:30 WAT"
 * - date and time, seconds:   "5 Oct 2026, 14:30:12 WAT" (only /staff/audit)
 * - date only (Lagos day):    "5 Oct 2026"
 * - missing or invalid value: "—" (never throws, never prints "Invalid Date")
 *
 * Not in scope (ledger OQ4): session schedules and calendars keep the cohort's
 * own zone; CSV/export contents, certificate PDFs and the licence module's own
 * formatters are unchanged.
 */

/** The zone the product renders in. */
export const LAGOS_TIME_ZONE = "Africa/Lagos";

/** Literal suffix appended to every Lagos date-time (leading space included). */
export const LAGOS_ZONE_LABEL = " WAT";

/** Shown in place of a missing or unparseable timestamp. */
export const MISSING_TIMESTAMP = "—";

export type LagosVariant = "dateTime" | "dateTimeSeconds" | "date";

export type TimestampInput = Date | string | number;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

let lagosParts: Intl.DateTimeFormat | null = null;

function partsFormatter(): Intl.DateTimeFormat {
  if (!lagosParts) {
    lagosParts = new Intl.DateTimeFormat("en-GB", {
      timeZone: LAGOS_TIME_ZONE,
      day: "numeric",
      month: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  }
  return lagosParts;
}

type LagosParts = { day: string; month: string; year: string; hour: string; minute: string; second: string };

function toDate(value: TimestampInput | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Numeric wall-clock parts of `date` in Africa/Lagos, normalised to fixed widths. */
function lagosPartsOf(date: Date): LagosParts {
  const parts = partsFormatter().formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    day: String(pick("day")),
    month: MONTHS[pick("month") - 1] ?? "",
    year: String(pick("year")),
    // Some engines print midnight as "24" even with h23; normalise to 00.
    hour: pad(pick("hour") % 24),
    minute: pad(pick("minute")),
    second: pad(pick("second")),
  };
}

function render(value: TimestampInput | null | undefined, variant: LagosVariant): string {
  const date = toDate(value);
  if (!date) return MISSING_TIMESTAMP;
  const p = lagosPartsOf(date);
  const day = `${p.day} ${p.month} ${p.year}`;
  if (variant === "date") return day;
  const time = variant === "dateTimeSeconds" ? `${p.hour}:${p.minute}:${p.second}` : `${p.hour}:${p.minute}`;
  return `${day}, ${time}${LAGOS_ZONE_LABEL}`;
}

/** "5 Oct 2026, 14:30 WAT" — Lagos date and 24-hour time, minutes precision. */
export function formatTimestamp(date: TimestampInput): string {
  return render(date, "dateTime");
}

/** "5 Oct 2026, 14:30 WAT" — same output as `formatTimestamp`, kept for existing call sites. */
export function formatDateTimeShort(date: TimestampInput): string {
  return render(date, "dateTime");
}

/** "5 Oct 2026, 14:30:12 WAT" — with seconds; used only by the staff audit log. */
export function formatTimestampWithSeconds(date: TimestampInput): string {
  return render(date, "dateTimeSeconds");
}

/** "5 Oct 2026" — the calendar day in Africa/Lagos, no zone label. */
export function formatDateOnly(date: TimestampInput): string {
  return render(date, "date");
}

/** "5 Oct 2026" — same output as `formatDateOnly`, kept for existing call sites. */
export function formatDateShort(date: TimestampInput): string {
  return render(date, "date");
}

/**
 * Null-safe entry point: "—" for null, undefined, empty or unparseable input,
 * otherwise the requested Lagos form (default: date and time).
 */
export function formatLagosOrDash(
  value: TimestampInput | null | undefined,
  variant: LagosVariant = "dateTime",
): string {
  return render(value, variant);
}

/** The ISO 8601 UTC string for a valid timestamp, or null when missing or invalid. */
export function toIsoOrNull(value: TimestampInput | null | undefined): string | null {
  const date = toDate(value);
  return date ? date.toISOString() : null;
}
