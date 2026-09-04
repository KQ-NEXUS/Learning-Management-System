"use client";

/**
 * The global scoped enrolments list (UI-SPEC line 186) — `enrolments.view`,
 * NOT cohort-scoped. Row actions reuse the exact same `EnrolmentActionModals`
 * the cohort Roster tab uses, so the five COH-05 actions behave identically
 * everywhere they are reachable from.
 *
 * A COHORT-scoped grant never reaches this screen: `page.tsx` calls
 * `loadStaffEnrolments`, which is gated with NO scope resolver (an empty
 * `ResourceScope`), so the authorization core denies anything short of a
 * GLOBAL grant BEFORE a single row is read (T-05-95) — there is no
 * fetch-everything-then-filter path here to get wrong.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ResourceTable, StatusPill, type Column, type ResourceTableState } from "@/components/primitives";
import { EnrolmentActionModals, type EnrolmentActionTarget } from "@/app/staff/cohorts/[id]/EnrolmentActionModals";

/** Dates are ISO strings — converted once at the RSC boundary in `page.tsx`,
 *  the same way `CohortsTable`/`SessionsTab` do. */
export type EnrolmentListRow = {
  id: string;
  status: string;
  learnerName: string;
  learnerEmail: string;
  cohortId: string;
  cohortCode: string;
  offerTitle: string;
  accessStartsAt: string | null;
  accessEndsAt: string | null;
  createdAt: string;
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

const STATUS_OPTIONS = [
  { value: "", label: "Any" },
  { value: "PENDING_PAYMENT", label: "Pending payment" },
  { value: "ACTIVE", label: "Active" },
  { value: "WITHDRAWN", label: "Withdrawn" },
  { value: "TRANSFERRED", label: "Transferred" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "COMPLETED", label: "Completed" },
];

function formatAccessWindow(startsAt: string | null, endsAt: string | null): string {
  const fmt = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : "—");
  return `${fmt(startsAt)} → ${fmt(endsAt)}`;
}

const ACTION_BTN = "text-xs font-medium underline underline-offset-2";

export function EnrolmentsTable({
  rows,
  denied,
}: {
  rows?: EnrolmentListRow[];
  denied?: { permission: string };
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [cohortId, setCohortId] = useState("");
  const [target, setTarget] = useState<EnrolmentActionTarget | null>(null);

  const cohortOptions = useMemo(() => {
    if (!rows) return [{ value: "", label: "Any" }];
    const byId = new Map<string, string>();
    for (const r of rows) byId.set(r.cohortId, r.cohortCode);
    return [
      { value: "", label: "Any" },
      ...[...byId.entries()]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ];
  }, [rows]);

  const visible = useMemo(() => {
    if (!rows) return [];
    const needle = search.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!needle ||
          r.learnerName.toLowerCase().includes(needle) ||
          r.learnerEmail.toLowerCase().includes(needle) ||
          r.cohortCode.toLowerCase().includes(needle)) &&
        (!status || r.status === status) &&
        (!cohortId || r.cohortId === cohortId),
    );
  }, [rows, search, status, cohortId]);

  const activeFilterCount = (search ? 1 : 0) + (status ? 1 : 0) + (cohortId ? 1 : 0);

  function clearFilters() {
    setSearch("");
    setStatus("");
    setCohortId("");
  }

  const columns: Column<EnrolmentListRow>[] = [
    {
      key: "learner",
      header: "Learner",
      render: (r) => r.learnerName,
      subtitle: (r) => r.learnerEmail,
      width: "18%",
    },
    {
      key: "cohortCode",
      header: "Cohort code",
      render: (r) => (
        <Link
          href={`/staff/cohorts/${r.cohortId}`}
          className="font-mono text-xs text-zinc-900 underline-offset-2 hover:underline"
        >
          {r.cohortCode}
        </Link>
      ),
      mono: true,
      width: "12%",
    },
    {
      key: "offer",
      header: "Offer",
      render: (r) => r.offerTitle,
      width: "16%",
      hideOnMobile: true,
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <StatusPill label={STATUS_LABEL[r.status] ?? r.status} tone={STATUS_TONE[r.status] ?? "neutral"} />
      ),
      width: "12%",
    },
    {
      key: "accessWindow",
      header: "Access window",
      render: (r) => formatAccessWindow(r.accessStartsAt, r.accessEndsAt),
      mono: true,
      width: "14%",
    },
    {
      key: "createdAt",
      header: "Created",
      render: (r) => new Date(r.createdAt).toISOString().slice(0, 10),
      mono: true,
      width: "10%",
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
                onClick={() => open({ action: "approve", cohortId: r.cohortId, enrolmentId: r.id, learnerName: r.learnerName })}
              >
                Approve
              </button>
              <button
                type="button"
                className={`${ACTION_BTN} text-danger`}
                onClick={() => open({ action: "cancel", cohortId: r.cohortId, enrolmentId: r.id, learnerName: r.learnerName })}
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
                onClick={() => open({ action: "transfer", cohortId: r.cohortId, enrolmentId: r.id, learnerName: r.learnerName })}
              >
                Transfer
              </button>
              <button
                type="button"
                className={`${ACTION_BTN} text-danger`}
                onClick={() => open({ action: "withdraw", cohortId: r.cohortId, enrolmentId: r.id, learnerName: r.learnerName })}
              >
                Withdraw
              </button>
              <button
                type="button"
                className={`${ACTION_BTN} text-danger`}
                onClick={() => open({ action: "cancel", cohortId: r.cohortId, enrolmentId: r.id, learnerName: r.learnerName })}
              >
                Cancel
              </button>
            </span>
          );
        }
        return "—";
      },
      width: "18%",
    },
  ];

  const state: ResourceTableState<EnrolmentListRow> = denied
    ? { status: "denied", permission: denied.permission }
    : visible.length > 0
      ? { status: "ready", rows: visible }
      : { status: "empty", activeFilterCount, totalWithoutFilters: rows?.length };

  return (
    <div className="flex flex-col gap-4">
      <ResourceTable<EnrolmentListRow>
        noun="enrolments"
        title="Enrolments"
        columns={columns}
        state={state}
        getRowKey={(r) => r.id}
        getRowLabel={(r) => r.learnerName}
        primaryColumnKey="learner"
        shownCount={denied ? undefined : visible.length}
        totalCount={denied ? undefined : rows?.length}
        emptyHeading="No enrolments yet"
        emptyBody="Enrolments appear here once cohorts are published and learners register."
        filters={[
          { kind: "search", name: "search", label: "Search", value: search, placeholder: "Learner or cohort" },
          { kind: "select", name: "status", label: "Status", value: status, options: STATUS_OPTIONS },
          { kind: "select", name: "cohortId", label: "Cohort", value: cohortId, options: cohortOptions },
        ]}
        onFilterChange={(name, value) => {
          if (name === "search") setSearch(value);
          else if (name === "status") setStatus(value);
          else setCohortId(value);
        }}
        activeQuery={
          activeFilterCount > 0
            ? `?${[
                search ? `search=${search}` : null,
                status ? `status=${status}` : null,
                cohortId ? `cohortId=${cohortId}` : null,
              ]
                .filter(Boolean)
                .join("&")}`
            : undefined
        }
        onClearFilters={activeFilterCount > 0 ? clearFilters : undefined}
      />

      <EnrolmentActionModals
        target={target}
        onClose={() => setTarget(null)}
        onSuccess={() => router.refresh()}
      />
    </div>
  );
}
