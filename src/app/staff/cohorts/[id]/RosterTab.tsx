"use client";

/**
 * The cohort Roster tab (COH-07, D-17, D-18) plus the five per-row COH-05
 * enrolment actions.
 *
 * A leaf component: plan 05-15 mounts this as a `DetailLayout` tab section,
 * passing `rows` from `loadCohortRoster` (dates converted to ISO strings at
 * the RSC boundary, the same way `SessionsTab`/`CohortsTable` do — this file
 * never receives a `Date`).
 *
 * The Progress / Assessment / Completion columns render the D-18 named third
 * state — `DeferredColumn` is a `{ kind: "deferred"; phase: 9 | 10 | 11 }`
 * discriminated union with NO numeric member, so there is no cast or
 * numeric fallback (a zero, which would read as "failing") that could
 * produce a fake result here even by accident; the type itself refuses one.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ResourceTable, StatusPill, type Column, type ResourceTableState } from "@/components/primitives";
import type { AttendanceComponent } from "@/server/services/attendance-component";
import type { DeferredColumn } from "@/server/services/roster-service";
import { EnrolmentActionModals, type EnrolmentActionTarget } from "./EnrolmentActionModals";
import { formatTimestamp } from "@/lib/format-timestamp";

export type RosterTransitionView = {
  action: string;
  reason: string | null;
  actorName: string | null;
  /** ISO instant. */
  at: string;
};

export type RosterRowView = {
  learnerId: string;
  learnerName: string;
  learnerEmail: string;
  enrolmentId: string;
  status: string;
  transitionCount: number;
  latestTransition: RosterTransitionView | null;
  /** ISO instants, or null. */
  accessStartsAt: string | null;
  accessEndsAt: string | null;
  instructors: string[];
  attendance: AttendanceComponent;
  progress: DeferredColumn;
  assessment: DeferredColumn;
  completion: DeferredColumn;
};

export type RosterTabProps = {
  cohortId: string;
  rows?: RosterRowView[];
  denied?: { permission: string };
  /** Cohorts of the same course/programme (D-13) — the transfer target picker. */
  siblingCohorts?: { id: string; code: string }[];
  /** Learners eligible for a comped/corporate add — best-effort. */
  candidateLearners?: { id: string; name: string; email: string }[];
};

const STATUS_TONE: Record<string, "success" | "neutral" | "warning" | "danger"> = {
  PENDING_PAYMENT: "warning",
  ACTIVE: "success",
  WITHDRAWN: "neutral",
  TRANSFERRED: "neutral",
  CANCELLED: "danger",
  COMPLETED: "success",
};

const STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: "Pending payment",
  ACTIVE: "Active",
  WITHDRAWN: "Withdrawn",
  TRANSFERRED: "Transferred",
  CANCELLED: "Cancelled",
  COMPLETED: "Completed",
};

/** D-18 — the exact literal labels the grep gate and the component test key
 *  off. Never computed via a template so the strings are physically present
 *  in this file, not merely producible at runtime. */
const DEFERRED_LABEL: Record<9 | 10 | 11, string> = {
  9: "not tracked yet · Phase 9",
  10: "not tracked yet · Phase 10",
  11: "not tracked yet · Phase 11",
};

function DeferredCell({ column }: { column: DeferredColumn }) {
  return (
    <span className="inline-flex items-center gap-2 text-[11px] text-muted-foreground">
      <span aria-hidden className="font-mono">
        •
      </span>
      {DEFERRED_LABEL[column.phase]}
    </span>
  );
}

/** The genuine `no-rule` / `no-sessions` third state — mirrors
 *  `ReadinessPanel`'s `NOT_YET_CHECKED` glyph and colour treatment, never a
 *  fake `0%`. */
function AttendanceCell({ attendance }: { attendance: AttendanceComponent }) {
  if (attendance.kind === "computed") {
    return (
      <span className="font-mono text-[11px] tabular-nums">
        {attendance.earnedPct}% / {attendance.requiredPct}%
      </span>
    );
  }
  const label = attendance.kind === "no-rule" ? "No attendance rule" : "No countable sessions yet";
  return (
    <span className="inline-flex items-center gap-2 text-[11px] text-muted-foreground">
      <span aria-hidden className="font-mono">
        •
      </span>
      {label}
    </span>
  );
}

function formatAccessWindow(startsAt: string | null, endsAt: string | null): string {
  const fmt = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : "—");
  return `${fmt(startsAt)} → ${fmt(endsAt)}`;
}

const ACTION_BTN = "text-[11px] font-semibold underline underline-offset-2";

export function RosterTab({
  cohortId,
  rows,
  denied,
  siblingCohorts,
  candidateLearners,
}: RosterTabProps) {
  const router = useRouter();
  const [target, setTarget] = useState<EnrolmentActionTarget | null>(null);

  function onSuccess() {
    router.refresh();
  }

  const columns: Column<RosterRowView>[] = [
    {
      key: "learner",
      header: "Learner",
      render: (r) => r.learnerName,
      subtitle: (r) => r.learnerEmail,
      width: "18%",
    },
    {
      key: "status",
      header: "Enrolment status",
      render: (r) => (
        <span className="flex flex-col gap-1">
          <StatusPill label={STATUS_LABEL[r.status] ?? r.status} tone={STATUS_TONE[r.status] ?? "neutral"} />
          <details className="text-[11px]">
            <summary className="cursor-pointer text-accent underline underline-offset-2 [&::-webkit-details-marker]:hidden">
              history{r.transitionCount > 0 ? ` (${r.transitionCount})` : ""}
            </summary>
            <div className="mt-1 flex flex-col gap-1 text-muted-foreground">
              {r.latestTransition ? (
                <span>
                  Latest: {r.latestTransition.action} by {r.latestTransition.actorName ?? "system"} on{" "}
                  {formatTimestamp(new Date(r.latestTransition.at))}
                  {r.latestTransition.reason ? ` — "${r.latestTransition.reason}"` : ""}
                </span>
              ) : (
                <span>No transitions recorded yet.</span>
              )}
            </div>
          </details>
        </span>
      ),
      width: "16%",
    },
    {
      key: "accessWindow",
      header: "Access window",
      render: (r) => formatAccessWindow(r.accessStartsAt, r.accessEndsAt),
      mono: true,
      width: "14%",
    },
    {
      key: "attendance",
      header: "Attendance",
      render: (r) => <AttendanceCell attendance={r.attendance} />,
      width: "12%",
    },
    {
      key: "instructor",
      header: "Instructor",
      render: (r) => (r.instructors.length > 0 ? r.instructors.join(", ") : "No instructor assigned"),
      width: "12%",
      hideOnMobile: true,
    },
    {
      key: "progress",
      header: "Progress",
      render: (r) => <DeferredCell column={r.progress} />,
      width: "9%",
      hideOnMobile: true,
    },
    {
      key: "assessment",
      header: "Assessment",
      render: (r) => <DeferredCell column={r.assessment} />,
      width: "9%",
      hideOnMobile: true,
    },
    {
      key: "completion",
      header: "Completion",
      render: (r) => <DeferredCell column={r.completion} />,
      width: "9%",
      hideOnMobile: true,
    },
    {
      key: "actions",
      header: "Actions",
      render: (r) => {
        const open = (t: EnrolmentActionTarget) => setTarget(t);
        if (r.status === "PENDING_PAYMENT") {
          return (
            <span className="flex flex-wrap gap-2">
              <button
                type="button"
                className={`${ACTION_BTN} text-accent`}
                onClick={() =>
                  open({ action: "approve", cohortId, enrolmentId: r.enrolmentId, learnerName: r.learnerName })
                }
              >
                Approve
              </button>
              <button
                type="button"
                className={`${ACTION_BTN} text-danger`}
                onClick={() =>
                  open({ action: "cancel", cohortId, enrolmentId: r.enrolmentId, learnerName: r.learnerName })
                }
              >
                Cancel
              </button>
            </span>
          );
        }
        if (r.status === "ACTIVE") {
          return (
            <span className="flex flex-wrap gap-2">
              <button
                type="button"
                className={`${ACTION_BTN} text-accent`}
                onClick={() =>
                  open({ action: "transfer", cohortId, enrolmentId: r.enrolmentId, learnerName: r.learnerName })
                }
              >
                Transfer
              </button>
              <button
                type="button"
                className={`${ACTION_BTN} text-danger`}
                onClick={() =>
                  open({ action: "withdraw", cohortId, enrolmentId: r.enrolmentId, learnerName: r.learnerName })
                }
              >
                Withdraw
              </button>
              <button
                type="button"
                className={`${ACTION_BTN} text-danger`}
                onClick={() =>
                  open({ action: "cancel", cohortId, enrolmentId: r.enrolmentId, learnerName: r.learnerName })
                }
              >
                Cancel
              </button>
            </span>
          );
        }
        return "—";
      },
      width: "16%",
    },
  ];

  const state: ResourceTableState<RosterRowView> = denied
    ? { status: "denied", permission: denied.permission }
    : rows && rows.length > 0
      ? { status: "ready", rows }
      : { status: "empty" };

  return (
    <div className="flex flex-col gap-4">
      <ResourceTable<RosterRowView>
        noun="enrolments"
        title="Roster"
        columns={columns}
        state={state}
        getRowKey={(r) => r.enrolmentId}
        getRowLabel={(r) => r.learnerName}
        primaryColumnKey="learner"
        shownCount={denied ? undefined : rows?.length}
        emptyHeading="No one is enrolled yet"
        emptyBody="Add an enrolment for a comped or corporate learner, or publish the cohort so learners can register."
        headerActions={
          !denied && (
            <button
              type="button"
              onClick={() => setTarget({ action: "add", cohortId })}
              className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast shadow-[0_6px_18px_var(--accent-glow)] hover:opacity-90"
            >
              Add enrolment
            </button>
          )
        }
      />

      <EnrolmentActionModals
        target={target}
        onClose={() => setTarget(null)}
        onSuccess={onSuccess}
        siblingCohorts={siblingCohorts}
        candidateLearners={candidateLearners}
      />
    </div>
  );
}
