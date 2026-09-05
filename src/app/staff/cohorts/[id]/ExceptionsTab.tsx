"use client";

/**
 * The cohort Exceptions tab (ATT-04, D-19) — missing registers, at-risk and
 * disputed/corrected attendance, filterable, with a bounded per-cohort CSV
 * download built from the SAME filters.
 *
 * A leaf component: plan 05-15 mounts this as a `DetailLayout` tab section,
 * passing `rows` from `loadAttendanceExceptions({ cohortId, categories,
 * search })` — the RSC re-runs that call whenever `categories`/`search`
 * change in the URL, so this file never re-derives or re-filters what the
 * server already authorized and filtered (T-05-63 structural parity).
 *
 * Filters live in the URL (mirrors `AuditTable.tsx`'s `useSearchParams` +
 * `router.push` pattern) so a reload or a shared link returns to exactly
 * this view, and so the "Download CSV" link can read the SAME query string
 * values the screen is currently showing.
 */

import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { ResourceTable, StatusPill, type Column, type ResourceTableState } from "@/components/primitives";
import { formatTimestamp } from "@/lib/format-timestamp";

export type MissingRegisterExceptionView = {
  category: "missing-register";
  sessionId: string;
  sessionTitle: string;
  /** ISO instant. */
  sessionStartsAt: string;
  /** ISO instant — the marking-window deadline. */
  markingClosesAt: string;
  unmarkedLearnerCount: number;
};

export type AtRiskExceptionView = {
  category: "at-risk";
  enrolmentId: string;
  learnerName: string;
  earnedPct: number;
  requiredPct: number;
};

export type DisputedExceptionView = {
  category: "disputed";
  enrolmentId: string;
  learnerName: string;
  sessionId: string;
  sessionTitle: string;
  correctionReason: string;
  correctedByName: string | null;
  /** ISO instant, or null. */
  correctedAt: string | null;
};

export type AttendanceExceptionView =
  | MissingRegisterExceptionView
  | AtRiskExceptionView
  | DisputedExceptionView;

export const EXCEPTION_CATEGORY_OPTIONS = [
  { value: "missing-register", label: "Missing register" },
  { value: "at-risk", label: "At risk" },
  { value: "disputed", label: "Disputed" },
] as const;

export type ExceptionsTabProps = {
  cohortId: string;
  rows?: AttendanceExceptionView[];
  denied?: { permission: string };
  /** The current filters, as read from the URL by the mounting page. */
  categories?: string[];
  search?: string;
};

const CATEGORY_TONE: Record<string, "warning" | "danger" | "neutral"> = {
  "at-risk": "warning",
  disputed: "danger",
  "missing-register": "neutral",
};

const CATEGORY_LABEL: Record<string, string> = {
  "at-risk": "At risk",
  disputed: "Disputed",
  "missing-register": "Missing register",
};

function exceptionKey(row: AttendanceExceptionView): string {
  if (row.category === "missing-register") return `missing-register:${row.sessionId}`;
  if (row.category === "at-risk") return `at-risk:${row.enrolmentId}`;
  return `disputed:${row.enrolmentId}:${row.sessionId}`;
}

function subject(row: AttendanceExceptionView): string {
  return row.category === "missing-register" ? row.sessionTitle : row.learnerName;
}

function detail(row: AttendanceExceptionView): string {
  if (row.category === "missing-register") {
    return `${row.unmarkedLearnerCount} learner${row.unmarkedLearnerCount === 1 ? "" : "s"} unmarked`;
  }
  if (row.category === "at-risk") {
    return `${row.earnedPct}% / ${row.requiredPct}%`;
  }
  const who = row.correctedByName ?? "an unknown corrector";
  const when = row.correctedAt ? formatTimestamp(new Date(row.correctedAt)) : "an unknown time";
  return `${row.correctionReason} — corrected by ${who} on ${when}`;
}

function sessionHref(cohortId: string, row: AttendanceExceptionView): string | null {
  if (row.category === "at-risk") return null;
  return `/staff/cohorts/${cohortId}/sessions/${row.sessionId}/attendance`;
}

const BTN =
  "border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50";

export function ExceptionsTab({
  cohortId,
  rows,
  denied,
  categories = [],
  search = "",
}: ExceptionsTabProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  function setParam(name: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(name, value);
    else params.delete(name);
    startTransition(() => {
      router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
    });
  }

  function toggleCategory(value: string) {
    const next = categories.includes(value)
      ? categories.filter((c) => c !== value)
      : [...categories, value];
    setParam("categories", next.join(","));
  }

  const csvQuery = new URLSearchParams();
  if (categories.length > 0) csvQuery.set("categories", categories.join(","));
  if (search) csvQuery.set("search", search);
  const csvHref = `/staff/cohorts/${cohortId}/exceptions/csv${
    csvQuery.toString() ? `?${csvQuery.toString()}` : ""
  }`;

  const columns: Column<AttendanceExceptionView>[] = [
    {
      key: "subject",
      header: "Learner / session",
      render: subject,
      width: "24%",
    },
    {
      key: "category",
      header: "Category",
      render: (r) => <StatusPill label={CATEGORY_LABEL[r.category]} tone={CATEGORY_TONE[r.category]} />,
      width: "16%",
    },
    {
      key: "detail",
      header: "Detail",
      render: detail,
      width: "36%",
    },
    {
      key: "session",
      header: "Session",
      render: (r) => {
        const href = sessionHref(cohortId, r);
        return href ? (
          <Link href={href} className="text-accent underline underline-offset-2">
            Open attendance
          </Link>
        ) : (
          "—"
        );
      },
      width: "24%",
    },
  ];

  const activeFilterCount = categories.length + (search ? 1 : 0);
  const state: ResourceTableState<AttendanceExceptionView> = denied
    ? { status: "denied", permission: denied.permission }
    : rows && rows.length > 0
      ? { status: "ready", rows }
      : { status: "empty", activeFilterCount };

  return (
    <div className="flex flex-col gap-4">
      {!denied && (
        <div className="flex flex-wrap items-center gap-3 border border-zinc-200 bg-zinc-50/60 px-3 py-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
            Category
          </span>
          {EXCEPTION_CATEGORY_OPTIONS.map((option) => (
            <label key={option.value} className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={categories.includes(option.value)}
                onChange={() => toggleCategory(option.value)}
                className="accent-accent"
              />
              {option.label}
            </label>
          ))}
          <a href={csvHref} className={`${BTN} ml-auto`}>
            Download CSV
          </a>
        </div>
      )}

      <ResourceTable<AttendanceExceptionView>
        noun="attendance exceptions"
        title="Exceptions"
        columns={columns}
        state={state}
        getRowKey={exceptionKey}
        getRowLabel={subject}
        primaryColumnKey="subject"
        shownCount={denied ? undefined : rows?.length}
        emptyHeading="No attendance exceptions"
        emptyBody="Every past session has a complete register and no learner is below the attendance threshold."
        filters={
          denied
            ? undefined
            : [
                {
                  kind: "search",
                  name: "search",
                  label: "Search",
                  value: search,
                  placeholder: "Learner name",
                },
              ]
        }
        onFilterChange={(name, value) => {
          if (name === "search") setParam("search", value);
        }}
        activeQuery={activeFilterCount > 0 ? `?${searchParams.toString()}` : undefined}
        onClearFilters={
          activeFilterCount > 0
            ? () => startTransition(() => router.push(pathname))
            : undefined
        }
      />
    </div>
  );
}
