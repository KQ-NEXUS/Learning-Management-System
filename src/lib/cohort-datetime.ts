import { utcToWallParts } from "./timezone";

/** A datetime-local field has no offset: always interpret it in the cohort zone. */
export function parseCohortDateTime(value: string, timezone: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const [year, month, day, hour, minute] = value.split(/[-T:]/).map(Number);
  if (year < 100) return null;
  const nominal = Date.UTC(year, month - 1, day, hour, minute);
  try {
    // Sample both sides of a possible DST transition. Round-trip validation
    // rejects impossible calendar dates and skipped spring-forward times.
    // For a repeated fall-back time, consistently choose the earlier instant.
    const candidates = [-86_400_000, 0, 86_400_000].map((delta) => {
      const sample = nominal + delta;
      const p = utcToWallParts(new Date(sample), timezone);
      const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - sample;
      return new Date(nominal - offset);
    }).filter((date) => formatCohortDateTime(date, timezone) === value);
    return candidates.length ? new Date(Math.min(...candidates.map((date) => date.getTime()))) : null;
  } catch {
    return null;
  }
}

export function formatCohortDateTime(date: Date, timezone: string): string {
  const p = utcToWallParts(date, timezone);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}
