"use client";

/**
 * The cohort Sessions tab (COH-03) — list, add, repeat-weekly and soft-cancel.
 *
 * A leaf component: plan 05-15 mounts this as a `DetailLayout` tab section,
 * passing `sessions` from `listSessionsForCohort` (the meeting-link URL is
 * already stripped out at the service — see `scheduled-session-service.ts`).
 * This file never receives, stores or renders that URL itself; the
 * Mode/link column shows only whether one is configured (D-25, T-05-86).
 *
 * "Add session" and "Repeat weekly" open an inline panel built from the
 * shared `SessionFormFields` — no new primitive is authorised for this
 * phase, and a full second dialog for two nearly-identical field sets would
 * duplicate markup for no benefit. Soft-cancel routes through the shared
 * `ConfirmModal` with a mandatory reason (D-26).
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ResourceTable, StatusPill, ConfirmModal, type Column, type ResourceTableState } from "@/components/primitives";
import {
  SessionFormFields,
  EMPTY_SESSION_FIELDS,
  toSessionActionFields,
  type SessionFieldsValue,
} from "./SessionFormFields";
import { createSessionAction, repeatWeeklyAction, cancelSessionAction } from "./session-actions";

export type SessionRow = {
  id: string;
  cohortId: string;
  courseId: string | null;
  title: string;
  /** ISO instants — used only to derive the Duration column. */
  startsAt: string;
  endsAt: string;
  /** Already carries the cohort's explicit zone label in mono (D-23). */
  startsAtLabel: string;
  endsAtLabel: string;
  location: string | null;
  facilitatorId: string | null;
  attendanceExpected: boolean;
  cancelledAt: string | null;
  cancellationReason: string | null;
  timezone: string;
  /** Presence only — never the URL itself (D-25). */
  hasMeetingLink: boolean;
};

export type SessionsTabProps = {
  cohortId: string;
  cohortTimezone: string;
  sessions?: SessionRow[];
  denied?: { permission: string };
  /** Present only for a Programme cohort (D-24) — omitted for a Course cohort. */
  courseOptions?: { id: string; title: string }[];
  /** Show add / repeat / cancel (needs cohorts.manage). Default true. */
  canManage?: boolean;
  /** Instructor names by user id, so the Facilitator column shows a person rather than an id. */
  facilitatorNames?: Record<string, string>;
};

const BTN =
  "rounded-md border border-input-border bg-surface px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50";
const BTN_PRIMARY =
  "rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-50";

/** A location of "Virtual" is an online session; anything else is a place to attend in person. */
function whereLabel(s: SessionRow): string {
  const place = s.location?.trim();
  if (place && /^virtual$/i.test(place)) return "Virtual";
  if (place) return `In person, ${place}`;
  return s.hasMeetingLink ? "Virtual" : "—";
}

/** "Mon 7 Sep, 09:00 to 12:00" in the session's own timezone (the end repeats the date only if it differs). */
function formatWhen(s: SessionRow): string {
  const zone = s.timezone || "UTC";
  try {
    const day = (iso: string) =>
      new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: zone }).format(
        new Date(iso),
      );
    const time = (iso: string) =>
      new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone }).format(
        new Date(iso),
      );
    const sameDay = day(s.startsAt) === day(s.endsAt);
    return `${day(s.startsAt)}, ${time(s.startsAt)} to ${sameDay ? "" : `${day(s.endsAt)}, `}${time(s.endsAt)}`;
  } catch {
    return s.startsAtLabel;
  }
}

function formatDuration(startsAt: string, endsAt: string): string {
  const ms = new Date(endsAt).getTime() - new Date(startsAt).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function SessionsTab({
  cohortId,
  cohortTimezone,
  sessions,
  denied,
  courseOptions,
  canManage = true,
  facilitatorNames,
}: SessionsTabProps) {
  const router = useRouter();

  const [panel, setPanel] = useState<"none" | "add" | "repeat">("none");
  const [fields, setFields] = useState<SessionFieldsValue>(EMPTY_SESSION_FIELDS);
  const [panelPending, setPanelPending] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);

  const [cancelTarget, setCancelTarget] = useState<SessionRow | null>(null);
  const [cancelPending, setCancelPending] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  function openPanel(next: "add" | "repeat") {
    setPanel(next);
    setFields(EMPTY_SESSION_FIELDS);
    setPanelError(null);
  }

  function closePanel() {
    setPanel("none");
    setPanelError(null);
  }

  async function handleSubmitPanel() {
    setPanelPending(true);
    setPanelError(null);
    const base = toSessionActionFields(cohortId, fields);
    const result =
      panel === "add"
        ? await createSessionAction(base)
        : await repeatWeeklyAction({
            ...base,
            occurrences: Number.parseInt(fields.occurrences, 10) || 0,
          });
    setPanelPending(false);
    if (result.ok) {
      closePanel();
      router.refresh();
    } else {
      setPanelError(result.message);
    }
  }

  async function handleConfirmCancel(reason: string) {
    if (!cancelTarget) return;
    setCancelPending(true);
    setCancelError(null);
    const result = await cancelSessionAction({ sessionId: cancelTarget.id, reason });
    setCancelPending(false);
    if (result.ok) {
      setCancelTarget(null);
      router.refresh();
    } else {
      setCancelError(result.message);
    }
  }

  const columns: Column<SessionRow>[] = [
    {
      key: "title",
      header: "Session",
      render: (s) => s.title,
      width: "16%",
    },
    {
      key: "startsAt",
      header: "When",
      render: (s) => formatWhen(s),
      subtitle: (s) => `${formatDuration(s.startsAt, s.endsAt)} · ${s.timezone}`,
      width: "22%",
      sortable: true,
    },
    {
      key: "where",
      header: "Where",
      render: (s) => whereLabel(s),
      subtitle: (s) => (s.hasMeetingLink ? "Link configured" : undefined),
      width: "14%",
    },
    {
      key: "facilitatorId",
      header: "Facilitator",
      render: (s) => (s.facilitatorId ? (facilitatorNames?.[s.facilitatorId] ?? "—") : "—"),
      width: "11%",
      hideOnMobile: true,
    },
    {
      key: "attendanceExpected",
      header: "Attendance",
      render: (s) => (s.attendanceExpected ? "Expected" : "Not expected"),
      width: "10%",
      hideOnMobile: true,
    },
    {
      key: "status",
      header: "Status",
      render: (s) =>
        s.cancelledAt ? (
          <StatusPill label="Cancelled" tone="warning" />
        ) : (
          <StatusPill label="Scheduled" tone="success" />
        ),
      width: "8%",
    },
    {
      key: "cancel",
      header: "Actions",
      render: (s) =>
        s.cancelledAt ? (
          "—"
        ) : (
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link
              href={`/staff/cohorts/${s.cohortId}/sessions/${s.id}/attendance`}
              className="text-sm font-semibold whitespace-nowrap text-accent hover:underline"
            >
              Mark attendance
            </Link>
            {canManage && (
              <button
                type="button"
                onClick={() => {
                  setCancelTarget(s);
                  setCancelError(null);
                }}
                className="text-sm font-semibold text-danger hover:underline"
              >
                Cancel
              </button>
            )}
          </span>
        ),
      width: "19%",
    },
  ];

  const state: ResourceTableState<SessionRow> = denied
    ? { status: "denied", permission: denied.permission }
    : sessions && sessions.length > 0
      ? { status: "ready", rows: sessions }
      : { status: "empty" };

  return (
    <div className="flex flex-col gap-4">
      <ResourceTable<SessionRow>
        noun="sessions"
        title="Sessions"
        columns={columns}
        state={state}
        getRowKey={(s) => s.id}
        getRowLabel={(s) => s.title}
        getRowHref={(s) => `/staff/cohorts/${s.cohortId}/sessions/${s.id}/attendance`}
        primaryColumnKey="title"
        shownCount={denied ? undefined : sessions?.length}
        emptyHeading="No sessions scheduled"
        emptyBody="Add a session, or set delivery mode to self-paced if this cohort has no live meetings."
        headerActions={
          !denied && canManage && (
            <>
              <button type="button" className={BTN} onClick={() => openPanel("repeat")}>
                Repeat weekly…
              </button>
              <button type="button" className={BTN_PRIMARY} onClick={() => openPanel("add")}>
                Add session
              </button>
            </>
          )
        }
      />

      {panel !== "none" && (
        <div className="flex flex-col gap-4 border-t border-foreground pt-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold tracking-tight text-foreground">
              {panel === "add" ? "Add session" : "Repeat weekly"}
            </h3>
            <button
              type="button"
              onClick={closePanel}
              className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Close
            </button>
          </div>

          {panelError && (
            <p role="alert" className="rounded-md border border-danger/30 bg-danger-surface px-4 py-2 text-sm text-danger">
              {panelError}
            </p>
          )}

          <SessionFormFields
            variant={panel === "add" ? "single" : "repeat"}
            value={fields}
            onChange={setFields}
            cohortTimezone={cohortTimezone}
            courseOptions={courseOptions}
          />

          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={handleSubmitPanel}
              disabled={panelPending || !fields.title.trim() || !fields.date || !fields.startTime || !fields.endTime}
              className={panel === "add" ? BTN_PRIMARY : BTN}
            >
              {panelPending ? "Saving…" : panel === "add" ? "Add session" : "Repeat weekly"}
            </button>
          </div>
        </div>
      )}

      <ConfirmModal
        open={cancelTarget !== null}
        tone="danger"
        minReasonLength={10}
        title={`Cancel ${cancelTarget?.title ?? "session"}?`}
        description="Enrolled learners see it as cancelled. It is not deleted, and any attendance already recorded is kept."
        confirmLabel="Cancel session"
        pending={cancelPending}
        error={cancelError}
        onConfirm={handleConfirmCancel}
        onCancel={() => {
          setCancelTarget(null);
          setCancelError(null);
        }}
      />
    </div>
  );
}
