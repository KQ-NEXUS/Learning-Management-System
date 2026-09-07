"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ResourceTable,
  StatusPill,
  type Column,
  type SortState,
} from "@/components/primitives";

export type RoleRow = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  isDefault: boolean;
  version: number;
  permissions: string[];
};

/** RBAC-01's own fixed order — never alphabetical, never created-at (D-38, edge RBAC-01/ordering). */
const DEFAULT_ROLE_ORDER = [
  "Administrator",
  "Programme Manager",
  "Instructor",
  "Finance/Operations",
  "Learner",
];

const columns: Column<RoleRow>[] = [
  {
    key: "name",
    header: "Name",
    render: (r) => r.name,
    subtitle: (r) => r.description ?? "—",
    width: "34%",
    sortable: true,
  },
  {
    key: "default",
    header: "Default",
    render: (r) => (r.isDefault ? <StatusPill label="Default" tone="accent" /> : "—"),
    width: "12%",
  },
  {
    key: "permissions",
    header: "Permissions",
    render: (r) => r.permissions.length,
    align: "right",
    mono: true,
    width: "14%",
  },
  {
    key: "status",
    header: "Status",
    render: (r) => (
      <StatusPill label={r.active ? "Active" : "Inactive"} tone={r.active ? "success" : "neutral"} />
    ),
    width: "20%",
  },
  {
    key: "version",
    header: "Version",
    render: (r) => r.version,
    align: "right",
    mono: true,
    width: "10%",
    hideOnMobile: true,
  },
];

const BTN_PRIMARY =
  "rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast hover:opacity-90";

export function RolesTable({
  rows,
  denied,
}: {
  rows?: RoleRow[];
  denied?: { permission: string };
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState>({ key: "name", direction: "asc" });

  const ordered = useMemo(() => {
    if (!rows) return [];
    const defaults = rows
      .filter((r) => r.isDefault)
      .sort(
        (a, b) => DEFAULT_ROLE_ORDER.indexOf(a.name) - DEFAULT_ROLE_ORDER.indexOf(b.name),
      );
    const custom = rows.filter((r) => !r.isDefault);
    return [...defaults, ...custom];
  }, [rows]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = ordered.filter(
      (row) => !needle || row.name.toLowerCase().includes(needle),
    );

    // Only the custom-roles portion is re-sortable — defaults stay pinned in
    // their fixed sequence regardless of the chosen sort (D-38).
    const defaults = filtered.filter((r) => r.isDefault);
    const custom = filtered.filter((r) => !r.isDefault);
    const dir = sort.direction === "asc" ? 1 : -1;
    custom.sort((a, b) => {
      if (sort.key === "permissions") return (a.permissions.length - b.permissions.length) * dir;
      if (sort.key === "version") return (a.version - b.version) * dir;
      return a.name.localeCompare(b.name) * dir;
    });

    return [...defaults, ...custom];
  }, [ordered, search, sort]);

  const activeFilterCount = search ? 1 : 0;
  const query = [search ? `search=${search}` : null, `sort=${sort.direction === "desc" ? "-" : ""}${sort.key}`]
    .filter(Boolean)
    .join("&");

  const state = denied
    ? ({ status: "denied", permission: denied.permission } as const)
    : visible.length > 0
      ? ({ status: "ready", rows: visible } as const)
      : ({ status: "empty", activeFilterCount, totalWithoutFilters: rows?.length } as const);

  return (
    <ResourceTable<RoleRow>
      noun="roles"
      title="Roles"
      columns={columns}
      state={state}
      getRowKey={(r) => r.id}
      getRowLabel={(r) => r.name}
      getRowHref={(r) => `/staff/roles/${r.id}`}
      primaryColumnKey="name"
      shownCount={denied ? undefined : visible.length}
      totalCount={denied ? undefined : rows?.length}
      filters={[
        { kind: "search", name: "search", label: "Search", value: search, placeholder: "Role name" },
      ]}
      onFilterChange={(_name, value) => setSearch(value)}
      activeQuery={activeFilterCount > 0 ? `?${query}` : undefined}
      onClearFilters={activeFilterCount > 0 ? () => setSearch("") : undefined}
      sort={sort}
      onSortChange={(key) =>
        setSort((prev) =>
          prev.key === key
            ? { key, direction: prev.direction === "asc" ? "desc" : "asc" }
            : { key, direction: "asc" },
        )
      }
      headerActions={
        <Link href="/staff/roles/new" className={BTN_PRIMARY}>
          New role
        </Link>
      }
    />
  );
}
