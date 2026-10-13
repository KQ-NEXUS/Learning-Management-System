"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import {
  addDays,
  addMonths,
  civilDateIn,
  dayLabel,
  monthGrid,
  monthLabel,
  shortDayLabel,
  wallTimeIn,
  weekLabel,
  weekOf,
  WEEKDAY_LABELS,
  yearMonthOf,
  type CivilDate,
} from "@/lib/calendar";

/**
 * SessionCalendar — scheduled sessions on a month or week calendar.
 *
 * One component serves both audiences:
 *   - staff, on a cohort's Sessions tab: `onDayClick` makes each day a control
 *     that starts a new session on that date, and `onItemClick` opens a
 *     session for editing;
 *   - learners, on their own calendar: read-only, with each session optionally
 *     a link (`href`) to that course's sessions page.
 *
 * It only ever receives what its caller chose to pass. In particular an item
 * has no meeting-link field at all, so the calendar cannot show a link before
 * its visibility window opens (D-25); that stays the sessions page's job.
 *
 * Each session sits on the civil date it falls on in its OWN timezone (see
 * `@/lib/calendar`). Weeks run Monday to Sunday.
 */

export type CalendarSession = {
  id: string;
  title: string;
  /** ISO instants. */
  startsAt: string;
  endsAt: string;
  /** The cohort's timezone: decides which day the session sits on and the times shown. */
  timezone: string;
  cancelled?: boolean;
  /** A second line in the week view: a location, or the course a learner's session belongs to. */
  meta?: string;
  /** Makes the session a link (learner calendar). Ignored when `onItemClick` is given. */
  href?: string;
};

export type SessionCalendarProps = {
  sessions: CalendarSession[];
  /** Today's civil date in the timezone the calendar is read in. */
  today: CivilDate;
  defaultView?: "month" | "week";
  /** Staff: start a new session on this day. Omitted, days are not interactive. */
  onDayClick?: (date: CivilDate) => void;
  /** Staff: open this session. */
  onItemClick?: (id: string) => void;
};

type Placed = CalendarSession & { date: CivilDate; start: string; end: string; past: boolean };

const NAV_BTN =
  "inline-flex size-10 items-center justify-center rounded-md border border-input-border bg-surface text-foreground hover:bg-surface-2";
const TEXT_BTN =
  "inline-flex min-h-10 items-center rounded-md border border-input-border bg-surface px-4 text-sm font-semibold text-foreground hover:bg-surface-2";
const SEGMENT = "min-h-10 px-4 text-sm font-semibold first:rounded-l-md last:rounded-r-md border border-input-border -ml-px first:ml-0";

function chipClasses(item: Placed): string {
  if (item.cancelled) return "border-border bg-surface-2 text-muted-foreground line-through";
  if (item.past) return "border-border bg-surface-2 text-muted-foreground";
  // An upcoming session is the thing the calendar exists to point at.
  return "border-accent/40 bg-accent-wash text-foreground";
}

function statusSuffix(item: Placed): string {
  if (item.cancelled) return ", cancelled";
  return item.past ? ", finished" : ", upcoming";
}

function SessionChip({
  item,
  onItemClick,
  detailed,
}: {
  item: Placed;
  onItemClick?: (id: string) => void;
  detailed: boolean;
}) {
  const label = `${item.title}, ${item.start} to ${item.end}${statusSuffix(item)}`;
  const body = detailed ? (
    <>
      <span className="block font-mono text-xs tabular-nums">
        {item.start} to {item.end}
      </span>
      <span className="block text-sm font-semibold break-words">{item.title}</span>
      {item.meta && <span className="block text-xs break-words text-muted-foreground no-underline">{item.meta}</span>}
      {item.cancelled && <span className="block text-xs no-underline">Cancelled</span>}
    </>
  ) : (
    <span className="block truncate text-xs">
      <span className="font-mono tabular-nums">{item.start}</span> {item.title}
    </span>
  );
  const classes = `block w-full rounded-md border px-2 py-1 text-left ${chipClasses(item)}`;

  if (onItemClick) {
    return (
      <button type="button" aria-label={label} onClick={() => onItemClick(item.id)} className={`${classes} hover:border-accent`}>
        {body}
      </button>
    );
  }
  if (item.href) {
    return (
      <Link href={item.href} aria-label={label} className={`${classes} hover:border-accent`}>
        {body}
      </Link>
    );
  }
  return (
    <div aria-label={label} className={classes}>
      {body}
    </div>
  );
}

export function SessionCalendar({ sessions, today, defaultView = "month", onDayClick, onItemClick }: SessionCalendarProps) {
  const [view, setView] = useState<"month" | "week">(defaultView);
  // One cursor for both views: the month shown is the cursor's month, the week shown is its week.
  const [cursor, setCursor] = useState<CivilDate>(today);
  // Read once when the calendar mounts: "finished" does not need to tick over while it is open.
  const [now] = useState(() => Date.now());

  const byDate = useMemo(() => {
    const map = new Map<CivilDate, Placed[]>();
    for (const session of sessions) {
      const date = civilDateIn(session.startsAt, session.timezone);
      const placed: Placed = {
        ...session,
        date,
        start: wallTimeIn(session.startsAt, session.timezone),
        end: wallTimeIn(session.endsAt, session.timezone),
        past: new Date(session.endsAt).getTime() <= now,
      };
      map.set(date, [...(map.get(date) ?? []), placed]);
    }
    for (const list of map.values()) list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return map;
  }, [sessions, now]);

  const month = yearMonthOf(cursor);
  const heading = view === "month" ? monthLabel(month) : weekLabel(cursor);

  function step(direction: -1 | 1) {
    setCursor((current) =>
      view === "month" ? `${addMonths(yearMonthOf(current), direction)}-01` : addDays(current, 7 * direction),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button type="button" className={NAV_BTN} onClick={() => step(-1)} aria-label={view === "month" ? "Previous month" : "Previous week"}>
            <ChevronLeft aria-hidden className="size-5" />
          </button>
          <button type="button" className={NAV_BTN} onClick={() => step(1)} aria-label={view === "month" ? "Next month" : "Next week"}>
            <ChevronRight aria-hidden className="size-5" />
          </button>
          <button type="button" className={TEXT_BTN} onClick={() => setCursor(today)}>
            Today
          </button>
          <h3 aria-live="polite" className="pl-2 text-[18px] font-semibold tracking-[-0.01em] text-foreground">
            {heading}
          </h3>
        </div>

        <div role="group" aria-label="Calendar view" className="flex">
          {(["month", "week"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => setView(option)}
              className={`${SEGMENT} ${view === option ? "bg-foreground text-surface" : "bg-surface text-foreground hover:bg-surface-2"}`}
            >
              {option === "month" ? "Month" : "Week"}
            </button>
          ))}
        </div>
      </div>

      {view === "month" ? (
        <div className="overflow-hidden rounded-md border border-border">
          <div className="grid grid-cols-7 border-b border-border bg-surface-2">
            {WEEKDAY_LABELS.map((weekday) => (
              <div key={weekday} className="px-2 py-2 text-center text-xs font-semibold text-muted-foreground">
                {weekday}
              </div>
            ))}
          </div>
          {monthGrid(month).map((week) => (
            <div key={week[0]} className="grid grid-cols-7 border-b border-border last:border-b-0">
              {week.map((date) => {
                const items = byDate.get(date) ?? [];
                const outside = yearMonthOf(date) !== month;
                const isToday = date === today;
                const dayNumber = Number(date.slice(8));
                const count = items.length;
                const summary = `${dayLabel(date)}${isToday ? ", today" : ""}, ${count === 0 ? "no sessions" : `${count} session${count === 1 ? "" : "s"}`}`;
                return (
                  <div
                    key={date}
                    className={`flex min-h-[72px] min-w-0 flex-col gap-1 border-r border-border p-1 last:border-r-0 sm:min-h-[104px] sm:p-2 ${outside ? "bg-surface-2/60" : "bg-surface"}`}
                  >
                    {onDayClick ? (
                      <button
                        type="button"
                        onClick={() => onDayClick(date)}
                        aria-label={`Add a session on ${summary}`}
                        className={`group flex w-full items-center justify-between rounded-md px-1 text-sm font-semibold hover:bg-accent-wash ${outside ? "text-muted-foreground" : "text-foreground"}`}
                      >
                        <span
                          className={isToday ? "inline-flex size-7 items-center justify-center rounded-full bg-accent text-accent-contrast" : "inline-flex size-7 items-center justify-center"}
                        >
                          {dayNumber}
                        </span>
                        <Plus aria-hidden className="size-4 text-accent opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
                      </button>
                    ) : (
                      <p className={`px-1 text-sm font-semibold ${outside ? "text-muted-foreground" : "text-foreground"}`}>
                        <span className="sr-only">{summary}</span>
                        <span
                          aria-hidden
                          className={isToday ? "inline-flex size-7 items-center justify-center rounded-full bg-accent text-accent-contrast" : "inline-flex size-7 items-center justify-center"}
                        >
                          {dayNumber}
                        </span>
                      </p>
                    )}

                    {/* Phones: a count only. The Week view lists the sessions in full. */}
                    {count > 0 && (
                      <span aria-hidden className="mx-auto inline-flex min-w-6 items-center justify-center rounded-full bg-accent-wash px-1 text-xs font-semibold text-foreground sm:hidden">
                        {count}
                      </span>
                    )}
                    <ul className="hidden min-w-0 flex-col gap-1 sm:flex">
                      {items.map((item) => (
                        <li key={item.id} className="min-w-0">
                          <SessionChip item={item} onItemClick={onItemClick} detailed={false} />
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
          {weekOf(cursor).map((date) => {
            const items = byDate.get(date) ?? [];
            const isToday = date === today;
            return (
              <section
                key={date}
                aria-label={`${dayLabel(date)}${isToday ? ", today" : ""}`}
                className={`flex min-w-0 flex-col gap-2 rounded-md border p-2 ${isToday ? "border-accent" : "border-border"}`}
              >
                <h4 className="text-sm font-semibold text-foreground">
                  {shortDayLabel(date)}
                  {isToday && <span className="ml-2 text-xs font-medium text-accent">Today</span>}
                </h4>
                {items.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No sessions</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {items.map((item) => (
                      <li key={item.id}>
                        <SessionChip item={item} onItemClick={onItemClick} detailed />
                      </li>
                    ))}
                  </ul>
                )}
                {onDayClick && (
                  <button
                    type="button"
                    onClick={() => onDayClick(date)}
                    aria-label={`Add a session on ${dayLabel(date)}`}
                    className="mt-auto inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-accent hover:underline"
                  >
                    <Plus aria-hidden className="size-4" />
                    Add session
                  </button>
                )}
              </section>
            );
          })}
        </div>
      )}

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="inline-block size-3 rounded-sm border border-accent/40 bg-accent-wash" />
          Upcoming
        </span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="inline-block size-3 rounded-sm border border-border bg-surface-2" />
          Finished or cancelled
        </span>
      </p>
    </div>
  );
}
