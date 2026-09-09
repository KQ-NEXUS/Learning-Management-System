"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ResourceTable,
  StatusPill,
  type Column,
  type SortState,
} from "@/components/primitives";

/**
 * The Cohorts index row shape (COH-02). Kept intentionally flat — dates are
 * ISO strings (converted once in `page.tsx`, at the RSC boundary, the same
 * way `courses/[id]/page.tsx` does for `expectedUpdatedAt`) and the Offer
 * column's title/kind are resolved server-side from `courseId`/`programmeId`
 * since `cohortService.list` returns bare Cohort columns with no join.
 *
 * Exported so plan 05-15's detail page can reuse the same shape.
 */
export type CohortRow = {
  id: string;
  code: string;
  title: string;
  courseId: string | null;
  programmeId: string | null;
  offerKind: "Course" | "Programme";
  offerTitle: string;
  deliveryMode: string;
  timezone: string;
  enrolmentOpensAt: string;
  enrolmentClosesAt: string;
  capacity: number;
  seatsTaken: number;
  status: string;
};

const STATUS_TONE: Record<string, "success" | "neutral" | "warning" | "danger"> = {
  DRAFT: "neutral",
  PUBLISHED: "success",
  IN_PROGRESS: "success",
  COMPLETED: "neutral",
  CANCELLED: "danger",
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const DELIVERY_LABEL: Record<string, string> = {
  SELF_PACED: "Self-paced",
  INSTRUCTOR_LED: "Instructor-led",
  BLENDED: "Blended",
};

/** Formats a UTC ISO instant as the date shown in the cohort's own timezone. */
function formatInZone(iso: string, timezone: string): string {
  try {
    const dtf = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return dtf.format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

const columns: Column<CohortRow>[] = [
  {
    key: "code",
    header: "Code",
    render: (c) => c.code,
    mono: true,
    width: "12%",
    sortable: true,
  },
  {
    key: "offer",
    header: "Offer",
    render: (c) => c.offerTitle,
    subtitle: (c) => c.offerKind,
    width: "28%",
  },
  {
    key: "deliveryMode",
    header: "Delivery mode",
    render: (c) => <StatusPill label={DELIVERY_LABEL[c.deliveryMode] ?? c.deliveryMode} />,
    width: "16%",
  },
  {
    key: "window",
    header: "Window",
    render: (c) =>
      `${formatInZone(c.enrolmentOpensAt, c.timezone)} → ${formatInZone(
        c.enrolmentClosesAt,
        c.timezone,
      )}`,
    subtitle: (c) => c.timezone,
    mono: true,
    width: "22%",
  },
  {
    key: "seats",
    header: "Seats",
    // `seatsTaken` renders as "{seatsTaken}/{capacity}" — mono, right-aligned.
    render: (c) => `${c.seatsTaken}/${c.capacity}`,
    align: "right",
    mono: true,
    width: "10%",
    sortable: true,
  },
  {
    key: "status",
    header: "Status",
    render: (c) => (
      <StatusPill label={STATUS_LABEL[c.status] ?? c.status} tone={STATUS_TONE[c.status] ?? "neutral"} />
    ),
    width: "12%",
  },
];

const DELIVERY_OPTIONS = [
  { value: "", label: "Any" },
  { value: "SELF_PACED", label: "Self-paced" },
  { value: "INSTRUCTOR_LED", label: "Instructor-led" },
  { value: "BLENDED", label: "Blended" },
];

const STATUS_OPTIONS = [
  { value: "", label: "Any" },
  { value: "DRAFT", label: "Draft" },
  { value: "PUBLISHED", label: "Published" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
];

export function CohortsTable({
  rows,
  denied,
}: {
  rows?: CohortRow[];
  denied?: { permission: string };
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [deliveryMode, setDeliveryMode] = useState("");
  const [sort, setSort] = useState<SortState>({ key: "code", direction: "asc" });

  const visible = useMemo(() => {
    if (!rows) return [];
    const needle = search.trim().toLowerCase();
    const filtered = rows.filter(
      (row) =>
        (!needle ||
          row.code.toLowerCase().includes(needle) ||
          row.title.toLowerCase().includes(needle)) &&
        (!status || row.status === status) &&
        (!deliveryMode || row.deliveryMode === deliveryMode),
    );

    return [...filtered].sort((a, b) => {
      const dir = sort.direction === "asc" ? 1 : -1;
      if (sort.key === "seats") {
        return (a.seatsTaken / Math.max(a.capacity, 1) - b.seatsTaken / Math.max(b.capacity, 1)) * dir;
      }
      return a.code.localeCompare(b.code) * dir;
    });
  }, [rows, search, status, deliveryMode, sort]);

  const activeFilterCount = (search ? 1 : 0) + (status ? 1 : 0) + (deliveryMode ? 1 : 0);
  const query = [
    search ? `search=${search}` : null,
    status ? `status=${status}` : null,
    deliveryMode ? `deliveryMode=${deliveryMode}` : null,
    `sort=${sort.direction === "desc" ? "-" : ""}${sort.key}`,
  ]
    .filter(Boolean)
    .join("&");

  function clearFilters() {
    setSearch("");
    setStatus("");
    setDeliveryMode("");
  }

  // Two panels resolve to identical copy on purpose:
  //  - denied: RBAC-06 — no cohort count, code or title ever leaks here.
  //  - empty (unfiltered): with `noun="cohorts"` the shared primitive renders
  //    the heading "No cohorts yet" and, filtered, "No cohorts match these
  //    filters" — the exact UI-SPEC copy, generated rather than duplicated.
  const state = denied
    ? ({ status: "denied", permission: denied.permission } as const)
    : visible.length > 0
      ? ({ status: "ready", rows: visible } as const)
      : ({
          status: "empty",
          activeFilterCount,
          totalWithoutFilters: rows?.length,
        } as const);

  return (
    <ResourceTable<CohortRow>
      noun="cohorts"
      title="Cohorts"
      columns={columns}
      state={state}
      getRowKey={(c) => c.id}
      getRowLabel={(c) => c.code}
      getRowHref={(c) => `/staff/cohorts/${c.id}`}
      primaryColumnKey="code"
      shownCount={denied ? undefined : visible.length}
      totalCount={denied ? undefined : rows?.length}
      emptyBody="Create a cohort to schedule sessions and open enrolment."
      filters={[
        {
          kind: "search",
          name: "search",
          label: "Search",
          value: search,
          placeholder: "Code or title",
        },
        {
          kind: "select",
          name: "status",
          label: "Status",
          value: status,
          options: STATUS_OPTIONS,
        },
        {
          kind: "select",
          name: "deliveryMode",
          label: "Delivery mode",
          value: deliveryMode,
          options: DELIVERY_OPTIONS,
        },
      ]}
      onFilterChange={(name, value) => {
        if (name === "search") setSearch(value);
        else if (name === "status") setStatus(value);
        else setDeliveryMode(value);
      }}
      activeQuery={activeFilterCount > 0 ? `?${query}` : undefined}
      onClearFilters={activeFilterCount > 0 ? clearFilters : undefined}
      sort={sort}
      onSortChange={(key) =>
        setSort((prev) =>
          prev.key === key
            ? { key, direction: prev.direction === "asc" ? "desc" : "asc" }
            : { key, direction: "asc" },
        )
      }
      headerActions={
        // The one accent primary button on this screen (UI-SPEC accent
        // reserved list #1) — always visible, never duplicated in the empty
        // state, so there is exactly one "Create cohort" affordance at a time.
        <Link
          href="/staff/cohorts/new"
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast hover:opacity-90"
        >
          Create cohort
        </Link>
      }
    />
  );
}
