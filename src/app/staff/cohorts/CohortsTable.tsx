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
  startsAt: string;
  /** Names of the cohort's assigned instructors (empty when none, or when the viewer cannot read them). */
  instructors: string[];
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

/** "12 Oct 2026", in the cohort's own timezone. */
function formatInZone(iso: string, timezone: string): string {
  const opts = { day: "numeric", month: "short", year: "numeric" } as const;
  try {
    return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: timezone }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(new Date(iso));
  }
}

const columns: Column<CohortRow>[] = [
  {
    key: "code",
    header: "Cohort",
    render: (c) => <span className="font-semibold">{c.offerTitle === "—" ? c.title : c.title}</span>,
    subtitle: (c) => <span className="font-mono text-xs">{c.code}</span>,
    width: "28%",
    sortable: true,
  },
  {
    key: "starts",
    header: "Starts",
    render: (c) => formatInZone(c.startsAt, c.timezone),
    subtitle: (c) => c.timezone,
    width: "12%",
  },
  {
    key: "deliveryMode",
    header: "Format",
    render: (c) => DELIVERY_LABEL[c.deliveryMode] ?? c.deliveryMode,
    width: "14%",
  },
  {
    key: "instructor",
    header: "Instructor",
    render: (c) => (c.instructors.length > 0 ? c.instructors.join(", ") : "—"),
    width: "16%",
    hideOnMobile: true,
  },
  {
    key: "seats",
    header: "Seats",
    render: (c) => (
      <span className="flex items-center gap-3">
        <span aria-hidden className="h-1 w-20 overflow-hidden rounded-full bg-accent-wash">
          <span
            className="block h-full rounded-full bg-progress-fill"
            style={{ width: `${Math.min(100, Math.round((c.seatsTaken / Math.max(c.capacity, 1)) * 100))}%` }}
          />
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {c.seatsTaken}/{c.capacity}
        </span>
      </span>
    ),
    width: "14%",
    sortable: true,
  },
  {
    key: "status",
    header: "Status",
    render: (c) => (
      <StatusPill label={STATUS_LABEL[c.status] ?? c.status} tone={STATUS_TONE[c.status] ?? "neutral"} />
    ),
    width: "14%",
  },
];

const DELIVERY_OPTIONS = [
  { value: "", label: "All formats" },
  { value: "SELF_PACED", label: "Self-paced" },
  { value: "INSTRUCTOR_LED", label: "Instructor-led" },
  { value: "BLENDED", label: "Blended" },
];

// Tab order and wording: the mockup's "Open / In delivery / Completed", plus the two states it
// does not draw. A tab is only shown once at least one cohort is in that status.
const STATUS_TABS = [
  { value: "PUBLISHED", label: "Open" },
  { value: "IN_PROGRESS", label: "In delivery" },
  { value: "COMPLETED", label: "Completed" },
  { value: "DRAFT", label: "Draft" },
  { value: "CANCELLED", label: "Cancelled" },
];

export function CohortsTable({
  canCreate = true,
  rows,
  denied,
}: {
  rows?: CohortRow[];
  /** Hide the create button for staff who cannot create. Default true. */
  canCreate?: boolean;
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

  const statusTabs = [
    { value: "", label: "All", count: rows?.length ?? 0 },
    ...STATUS_TABS.map((tab) => ({ ...tab, count: rows?.filter((r) => r.status === tab.value).length ?? 0 })).filter(
      (tab) => tab.count > 0,
    ),
  ];

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
      asPage
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
          kind: "tabs",
          name: "status",
          label: "Status",
          value: status,
          options: statusTabs,
        },
        {
          kind: "search",
          name: "search",
          label: "Search",
          value: search,
          placeholder: "Search by code or title",
        },
        {
          kind: "select",
          name: "deliveryMode",
          label: "Format",
          value: deliveryMode,
          options: DELIVERY_OPTIONS,
          variant: "select",
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
        canCreate ? (
          // The one accent primary button on this screen (UI-SPEC accent
          // reserved list #1) — always visible, never duplicated in the empty
          // state, so there is exactly one "Create cohort" affordance at a time.
          <Link
            href="/staff/cohorts/new"
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast hover:opacity-90"
          >
            New cohort
          </Link>
        ) : undefined
      }
    />
  );
}
