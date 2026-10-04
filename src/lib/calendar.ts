/**
 * Civil-date helpers for the session calendar.
 *
 * A calendar is laid out in CIVIL dates ("2026-10-05"), not instants: a day
 * cell means "the 5th", wherever the viewer is. Each session is placed on the
 * civil date it falls on in ITS OWN cohort's timezone, the same wall-clock
 * reading the session form uses (D-23), so a session entered as "Monday
 * 09:00" always sits on Monday.
 *
 * All grid arithmetic is done on UTC dates built from those civil strings,
 * which makes it independent of the server's and the browser's own timezone.
 * Weeks start on Monday.
 */

export type CivilDate = string; // "YYYY-MM-DD"
export type YearMonth = string; // "YYYY-MM"

const DAY_MS = 24 * 60 * 60 * 1000;

function toUtc(date: CivilDate): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function fromUtc(at: Date): CivilDate {
  return at.toISOString().slice(0, 10);
}

/** The civil date an instant falls on when read on a clock in `timeZone`. */
export function civilDateIn(instant: Date | string, timeZone: string): CivilDate {
  // en-CA formats a date as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(instant),
  );
}

/** "09:00" — an instant's time of day on a 24-hour clock in `timeZone`. */
export function wallTimeIn(instant: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(instant),
  );
}

export function addDays(date: CivilDate, days: number): CivilDate {
  return fromUtc(new Date(toUtc(date).getTime() + days * DAY_MS));
}

export function yearMonthOf(date: CivilDate): YearMonth {
  return date.slice(0, 7);
}

export function addMonths(month: YearMonth, months: number): YearMonth {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber - 1 + months, 1)).toISOString().slice(0, 7);
}

/** The Monday of the week `date` falls in. */
export function startOfWeek(date: CivilDate): CivilDate {
  const weekday = toUtc(date).getUTCDay(); // 0 = Sunday
  return addDays(date, weekday === 0 ? -6 : 1 - weekday);
}

/** The seven days, Monday to Sunday, of the week `date` falls in. */
export function weekOf(date: CivilDate): CivilDate[] {
  const monday = startOfWeek(date);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

/**
 * Whole weeks covering `month`: each row is Monday to Sunday, so the first and
 * last rows may include days of the neighbouring months.
 */
export function monthGrid(month: YearMonth): CivilDate[][] {
  const first = `${month}-01`;
  const lastOfMonth = addDays(`${addMonths(month, 1)}-01`, -1);
  const weeks: CivilDate[][] = [];
  for (let monday = startOfWeek(first); monday <= lastOfMonth; monday = addDays(monday, 7)) {
    weeks.push(weekOf(monday));
  }
  return weeks;
}

/** "October 2026" */
export function monthLabel(month: YearMonth): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long", year: "numeric" }).format(
    toUtc(`${month}-01`),
  );
}

/**
 * "Monday 5 October 2026" — the full name of a day, for labels and screen readers.
 * Assembled from two formats: asked for in one, some runtimes write "Monday, 5 October 2026".
 */
export function dayLabel(date: CivilDate): string {
  const at = toUtc(date);
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long" }).format(at);
  const rest = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(at);
  return `${weekday} ${rest}`;
}

/** "Mon 5 Oct" */
export function shortDayLabel(date: CivilDate): string {
  const at = toUtc(date);
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short" }).format(at);
  const rest = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" }).format(at);
  return `${weekday} ${rest}`;
}

/** "5 to 11 October 2026", or "28 September to 4 October 2026" across a month end. */
export function weekLabel(date: CivilDate): string {
  const days = weekOf(date);
  const first = toUtc(days[0]);
  const last = toUtc(days[6]);
  const sameMonth = first.getUTCMonth() === last.getUTCMonth();
  const dayMonth = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long" });
  const full = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });
  return `${sameMonth ? first.getUTCDate() : dayMonth.format(first)} to ${full.format(last)}`;
}

export const WEEKDAY_LABELS: readonly string[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
