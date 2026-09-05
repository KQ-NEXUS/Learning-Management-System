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
