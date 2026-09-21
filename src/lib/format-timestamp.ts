/**
 * Deterministic timestamp formatting for staff-facing tables.
 *
 * PURE MODULE. `Date.prototype.toLocaleString()` / `toLocaleDateString()`
 * depend on the runtime's own locale and ICU data, which differ between a
 * server render (Docker container, no locale of its own) and a browser (the
 * visitor's actual locale) — the same instant renders as two different
 * strings, which is a React hydration mismatch (error #418), not a cosmetic
 * quirk. Pinning both the locale and the time zone makes the server render
 * and the client render byte-identical, so hydration always matches.
 */
export function formatTimestamp(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(date);
}

/** Date-only counterpart of `formatTimestamp`, pinned the same way so it hydrates identically. */
export function formatDateOnly(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

/** "12 Jan 2026" — the short, human date the mockup uses for record dates. Pinned like the rest. */
export function formatDateShort(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** "19 Sep 2026, 09:42" — day, short month, year and 24-hour time (UTC-pinned like the rest). */
export function formatDateTimeShort(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(date);
}
