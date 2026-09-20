import { Clock, MapPin, Video } from "lucide-react";
import { utcToWallParts } from "@/lib/timezone";
import { StatusPill } from "@/components/primitives/ResourceTable";
import type { SessionView } from "@/server/services/learner-session-service";

/**
 * SessionCard — one row of the LRN-06 sessions list (09-10, UI-SPEC 7.4).
 * Server Component, no client JS.
 *
 * The meeting link is rendered exactly as `SessionView` hands it over: an
 * accent "Join session" link when `meetingUrl` is present on the object, or
 * the muted "opens in N minutes" copy when only `meetingUrlAvailableFrom` is
 * present — this component never re-derives visibility, it only renders
 * whichever key the server-side gate (DD-24) already decided to include.
 * `N` here is presentation arithmetic on two already-disclosed timestamps
 * (`startsAt` minus `meetingUrlAvailableFrom`), not a copy of the gate's own
 * `now >= opensAt` decision.
 */

const ATTENDANCE_PILL: Record<
  SessionView["attendance"],
  { tone: "success" | "warning" | "danger" | "neutral"; label: string }
> = {
  PRESENT: { tone: "success", label: "Attended" },
  LATE: { tone: "warning", label: "Late" },
  ABSENT: { tone: "danger", label: "Absent" },
  EXCUSED: { tone: "neutral", label: "Excused" },
  NOT_RECORDED: { tone: "neutral", label: "Not recorded" },
};

function minutesBetween(later: Date, earlier: Date): number {
  return Math.round((later.getTime() - earlier.getTime()) / 60_000);
}

export type SessionCardProps = {
  session: SessionView;
  /** The owning Cohort's IANA timezone. */
  timezone: string;
  /** Whether this session has already ended relative to the page's render instant — controls whether the attendance pill renders. */
  isPast: boolean;
};

export function SessionCard({ session, timezone, isPast }: SessionCardProps) {
  const isCancelled = session.cancelledAt !== null;
  const startLabel = utcToWallParts(session.startsAt, timezone).label;
  const endLabel = utcToWallParts(session.endsAt, timezone).label;
  const attendancePill = ATTENDANCE_PILL[session.attendance];

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-4 py-3 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3
          className={`text-[16px] font-semibold text-foreground ${isCancelled ? "line-through decoration-muted-foreground" : ""}`}
        >
          {session.title}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          {isCancelled && <StatusPill tone="neutral" label="Cancelled" />}
          {!isCancelled && isPast && (
            <StatusPill tone={attendancePill.tone} label={attendancePill.label} />
          )}
        </div>
      </div>

      {isCancelled && session.cancellationReason && (
        <p className="break-words text-sm text-muted-foreground">{session.cancellationReason}</p>
      )}

      <p className="inline-flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
        <Clock aria-hidden className="size-3.5 shrink-0" />
        {startLabel} → {endLabel}
      </p>

      {session.location && (
        <p className="inline-flex items-start gap-2 text-sm text-muted-foreground">
          <MapPin aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span className="break-words">{session.location}</span>
        </p>
      )}

      {session.mode === "virtual" && !isCancelled && (
        <p className="inline-flex items-center gap-2 text-sm">
          <Video aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          {session.meetingUrl ? (
            <a
              href={session.meetingUrl}
              className="font-semibold text-accent underline underline-offset-2"
              target="_blank"
              rel="noopener noreferrer"
            >
              Join session
            </a>
          ) : session.meetingUrlAvailableFrom ? (
            <span className="text-muted-foreground">
              The meeting link opens {minutesBetween(session.startsAt, session.meetingUrlAvailableFrom)}{" "}
              minutes before this session starts
            </span>
          ) : null}
        </p>
      )}
    </div>
  );
}
