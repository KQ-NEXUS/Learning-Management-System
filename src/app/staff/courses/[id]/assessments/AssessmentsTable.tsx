"use client";

import { useState } from "react";
import Link from "next/link";
import { ClipboardList, ListChecks } from "lucide-react";
import { ResourceTable, StatusPill, type Column } from "@/components/primitives";

/**
 * The Course-scoped assessment list (ASM-01, ASM-03 — `10-UI-SPEC.md` §7.1).
 *
 * Four columns only: Title, Type, Status, Version. Type renders as an icon
 * plus text rather than a `StatusPill` — it is a fixed fact about the row
 * (QUIZ/ASSIGNMENT never changes once created), not a state.
 */

export type AssessmentRow = {
  id: string;
  title: string;
  type: string;
  status: string;
  version: number;
};

const STATUS_TONE: Record<string, "success" | "neutral" | "warning"> = {
  PUBLISHED: "success",
  DRAFT: "neutral",
  // Matches CoursesTable's own ARCHIVED tone (`CoursesTable.tsx`).
  ARCHIVED: "warning",
};

const TYPE_LABEL: Record<string, string> = {
  QUIZ: "Quiz",
  ASSIGNMENT: "Assignment",
};

const columns: Column<AssessmentRow>[] = [
  {
    key: "title",
    header: "Title",
    render: (row) => row.title,
    width: "46%",
    sortable: true,
  },
  {
    key: "type",
    header: "Type",
    render: (row) => (
      <span className="inline-flex items-center gap-1">
        {row.type === "QUIZ" ? (
          <ListChecks aria-hidden className="size-3.5 text-muted-foreground" />
        ) : (
          <ClipboardList aria-hidden className="size-3.5 text-muted-foreground" />
        )}
        {TYPE_LABEL[row.type] ?? row.type}
      </span>
    ),
    width: "22%",
  },
  {
    key: "status",
    header: "Status",
    render: (row) => <StatusPill label={row.status} tone={STATUS_TONE[row.status] ?? "neutral"} />,
    width: "18%",
  },
  {
    key: "version",
    header: "Version",
    render: (row) => row.version,
    align: "right",
    mono: true,
    width: "14%",
  },
];

const UNAVAILABLE = "Not available on this screen";

export function AssessmentsTable({
  courseId,
  rows,
  denied,
}: {
  courseId: string;
  rows?: AssessmentRow[];
  denied?: { permission: string };
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const state = denied
    ? ({ status: "denied", permission: denied.permission } as const)
    : rows && rows.length > 0
      ? ({ status: "ready", rows } as const)
      : ({ status: "empty" } as const);

  return (
    <ResourceTable<AssessmentRow>
      noun="assessments"
      title="Assessments"
      columns={columns}
      state={state}
      getRowKey={(row) => row.id}
      getRowLabel={(row) => row.title}
      getRowHref={(row) => `/staff/courses/${courseId}/assessments/${row.id}`}
      primaryColumnKey="title"
      shownCount={denied ? undefined : rows?.length}
      totalCount={denied ? undefined : rows?.length}
      emptyHeading="No assessments yet"
      emptyBody="Create a quiz or assignment to get started."
      selection={{
        selectedIds,
        onChange: setSelectedIds,
        // Archive replaces delete throughout (PRD CAT-08). This mirrors
        // `CoursesTable.tsx`'s own still-open Archive action rather than
        // inventing a second unimplemented pattern — the only real bulk
        // action this phase ships is plan 10-12's batch release, and that
        // lives on the grading queue, not here.
        actions: [
          { label: "Archive…", onClick: () => {}, disabled: true, description: UNAVAILABLE },
        ],
      }}
      headerActions={
        <Link
          href={`/staff/courses/${courseId}/assessments/new`}
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast hover:opacity-90"
        >
          New assessment
        </Link>
      }
    />
  );
}
