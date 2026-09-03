"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ResourceTable,
  StatusPill,
  type Column,
  type SortState,
} from "@/components/primitives";
import type { ProgrammeIndexRow } from "@/server/services/programme-service";

/**
 * Mirrors `CoursesTable.tsx`, with two deliberate differences:
 *  - Status and public listing are TWO pills, not one — D-08 makes them
 *    independent facts and this table is where staff scan for "is it on sale".
 *  - No bulk-selection actions. `CoursesTable` wires its bulk buttons to
 *    no-op handlers (a known concern in STATE.md); rather than copy that dead
 *    affordance, this table omits bulk actions until they are wired.
 */

const TONE: Record<string, "success" | "neutral" | "warning"> = {
  PUBLISHED: "success",
  DRAFT: "neutral",
  ARCHIVED: "warning",
};

const columns: Column<ProgrammeIndexRow>[] = [
  {
    key: "title",
    header: "Title",
    render: (p) => p.title,
    subtitle: (p) => p.summary ?? "—",
    width: "36%",
    sortable: true,
  },
  {
    key: "slug",
    header: "Slug",
    render: (p) => p.slug,
    mono: true,
    width: "20%",
    hideOnMobile: true,
  },
  {
    key: "courseCount",
    header: "Courses",
    render: (p) => p.courseCount,
    align: "right",
    mono: true,
    width: "10%",
    sortable: true,
  },
  {
    key: "sequential",
    header: "Order",
    render: (p) => (p.sequential ? "Sequential" : "Any order"),
    width: "12%",
    hideOnMobile: true,
  },
  {
    key: "status",
    header: "Status",
    render: (p) => (
      <span className="flex flex-wrap gap-1">
        <StatusPill label={p.status} tone={TONE[p.status] ?? "neutral"} />
        {p.publiclyListed && <StatusPill label="Listed" tone="accent" />}
      </span>
    ),
    width: "22%",
  },
];

export function ProgrammesTable({
  rows,
  denied,
}: {
  rows?: ProgrammeIndexRow[];
  denied?: { permission: string };
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<SortState>({ key: "title", direction: "asc" });

  const visible = useMemo(() => {
    if (!rows) return [];
    const needle = search.trim().toLowerCase();
    const filtered = rows.filter(
      (row) =>
        (!needle ||
          row.title.toLowerCase().includes(needle) ||
          row.slug.toLowerCase().includes(needle)) &&
        (!status || row.status === status),
    );
    return [...filtered].sort((a, b) => {
      const dir = sort.direction === "asc" ? 1 : -1;
      if (sort.key === "courseCount") return (a.courseCount - b.courseCount) * dir;
      return a.title.localeCompare(b.title) * dir;
    });
  }, [rows, search, status, sort]);

  const activeFilterCount = (search ? 1 : 0) + (status ? 1 : 0);

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
    <ResourceTable<ProgrammeIndexRow>
      noun="programmes"
      title="Programmes"
      columns={columns}
      state={state}
      getRowKey={(p) => p.id}
      getRowLabel={(p) => p.slug}
      getRowHref={(p) => `/staff/programmes/${p.id}`}
      primaryColumnKey="title"
      shownCount={denied ? undefined : visible.length}
      totalCount={denied ? undefined : rows?.length}
      filters={[
        {
          kind: "search",
          name: "search",
          label: "Search",
          value: search,
          placeholder: "Title or slug",
        },
        {
          kind: "select",
          name: "status",
          label: "Status",
          value: status,
          options: [
            { value: "", label: "Any" },
            { value: "DRAFT", label: "Draft" },
            { value: "PUBLISHED", label: "Published" },
            { value: "ARCHIVED", label: "Archived" },
          ],
        },
      ]}
      onFilterChange={(name, value) =>
        name === "search" ? setSearch(value) : setStatus(value)
      }
      onClearFilters={
        activeFilterCount > 0
          ? () => {
              setSearch("");
              setStatus("");
            }
          : undefined
      }
      sort={sort}
      onSortChange={(key) =>
        setSort((prev) =>
          prev.key === key
            ? { key, direction: prev.direction === "asc" ? "desc" : "asc" }
            : { key, direction: "asc" },
        )
      }
      headerActions={
        <Link
          href="/staff/programmes/new"
          className="bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-contrast hover:opacity-90"
        >
          New programme
        </Link>
      }
    />
  );
}
