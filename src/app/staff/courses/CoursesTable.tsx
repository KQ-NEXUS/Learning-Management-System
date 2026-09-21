"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ResourceTable,
  StatusPill,
  type Column,
  type SortState,
} from "@/components/primitives";

export type CourseRow = {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  status: string;
  durationHours: number | null;
  certificateEnabled: boolean;
};

const TONE: Record<string, "success" | "neutral" | "warning"> = {
  PUBLISHED: "success",
  DRAFT: "neutral",
  ARCHIVED: "warning",
};

const columns: Column<CourseRow>[] = [
  {
    key: "title",
    header: "Title",
    render: (c) => c.title,
    subtitle: (c) => c.summary ?? "—",
    width: "40%",
    sortable: true,
  },
  {
    key: "slug",
    header: "Slug",
    render: (c) => c.slug,
    mono: true,
    width: "24%",
    hideOnMobile: true,
  },
  {
    key: "certificate",
    header: "Certificate",
    render: (c) => (c.certificateEnabled ? "Enabled" : "—"),
    width: "12%",
  },
  {
    key: "durationHours",
    header: "Hours",
    render: (c) => c.durationHours ?? "—",
    align: "right",
    mono: true,
    width: "10%",
    sortable: true,
  },
  {
    key: "status",
    header: "Status",
    render: (c) => <StatusPill label={c.status} tone={TONE[c.status] ?? "neutral"} />,
    width: "14%",
  },
];

export function CoursesTable({
  canCreate = true,
  rows,
  denied,
}: {
  rows?: CourseRow[];
  /** Hide the create button for staff who cannot create. Default true. */
  canCreate?: boolean;
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
      if (sort.key === "durationHours") {
        return ((a.durationHours ?? 0) - (b.durationHours ?? 0)) * dir;
      }
      return a.title.localeCompare(b.title) * dir;
    });
  }, [rows, search, status, sort]);

  const activeFilterCount = (search ? 1 : 0) + (status ? 1 : 0);
  const query = [
    search ? `search=${search}` : null,
    status ? `status=${status}` : null,
    `sort=${sort.direction === "desc" ? "-" : ""}${sort.key}`,
  ]
    .filter(Boolean)
    .join("&");

  function clearFilters() {
    setSearch("");
    setStatus("");
  }

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
    <ResourceTable<CourseRow>
      asPage
      noun="courses"
      title="Courses"
      columns={columns}
      state={state}
      getRowKey={(c) => c.id}
      getRowLabel={(c) => c.slug}
      getRowHref={(c) => `/staff/courses/${c.id}`}
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
          <Link
            href="/staff/courses/new"
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast hover:bg-accent-deep"
          >
            New course
          </Link>
        ) : undefined
      }
    />
  );
}
