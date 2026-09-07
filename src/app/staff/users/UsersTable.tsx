"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ResourceTable,
  StatusPill,
  type Column,
  type SortState,
} from "@/components/primitives";

export type StaffUserRow = {
  id: string;
  name: string;
  email: string;
  status: string;
  createdAt: Date | string;
  deactivatedAt: Date | string | null;
};

// Locked mapping (02-UI-SPEC.md): DEACTIVATED is a recoverable, staff-initiated
// state — mirrors the archived-course precedent (warning), not danger, since
// reactivation is a one-field flip (D-36).
const TONE: Record<string, "success" | "warning" | "neutral"> = {
  ACTIVE: "success",
  DEACTIVATED: "warning",
  PENDING_VERIFICATION: "neutral",
};

function fmtDate(value: Date | string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

const columns: Column<StaffUserRow>[] = [
  {
    key: "name",
    header: "Name",
    render: (u) => u.name,
    subtitle: (u) => u.email,
    width: "34%",
    sortable: true,
  },
  {
    key: "email",
    header: "Email",
    render: (u) => u.email,
    mono: true,
    width: "26%",
    hideOnMobile: true,
  },
  {
    key: "status",
    header: "Status",
    render: (u) => <StatusPill label={u.status} tone={TONE[u.status] ?? "neutral"} />,
    width: "14%",
  },
  {
    key: "createdAt",
    header: "Created",
    render: (u) => fmtDate(u.createdAt),
    mono: true,
    align: "right",
    width: "13%",
    sortable: true,
  },
  {
    key: "deactivatedAt",
    header: "Deactivated",
    render: (u) => fmtDate(u.deactivatedAt),
    mono: true,
    align: "right",
    width: "13%",
    hideOnMobile: true,
  },
];

const BTN_PRIMARY =
  "rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast hover:opacity-90";

export function UsersTable({
  rows,
  denied,
}: {
  rows?: StaffUserRow[];
  denied?: { permission: string };
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<SortState>({ key: "name", direction: "asc" });

  const visible = useMemo(() => {
    if (!rows) return [];
    const needle = search.trim().toLowerCase();
    const filtered = rows.filter(
      (row) =>
        (!needle ||
          row.name.toLowerCase().includes(needle) ||
          row.email.toLowerCase().includes(needle)) &&
        (!status || row.status === status),
    );

    return [...filtered].sort((a, b) => {
      const dir = sort.direction === "asc" ? 1 : -1;
      if (sort.key === "createdAt") {
        return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir;
      }
      return a.name.localeCompare(b.name) * dir;
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
    <ResourceTable<StaffUserRow>
      noun="staff accounts"
      title="Users"
      columns={columns}
      state={state}
      getRowKey={(u) => u.id}
      getRowLabel={(u) => u.email}
      getRowHref={(u) => `/staff/users/${u.id}`}
      primaryColumnKey="name"
      shownCount={denied ? undefined : visible.length}
      totalCount={denied ? undefined : rows?.length}
      filters={[
        { kind: "search", name: "search", label: "Search", value: search, placeholder: "Name or email" },
        {
          kind: "select",
          name: "status",
          label: "Status",
          value: status,
          options: [
            { value: "", label: "Any" },
            { value: "ACTIVE", label: "Active" },
            { value: "DEACTIVATED", label: "Deactivated" },
            { value: "PENDING_VERIFICATION", label: "Pending verification" },
          ],
        },
      ]}
      onFilterChange={(name, value) => (name === "search" ? setSearch(value) : setStatus(value))}
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
        <Link href="/staff/users/new" className={BTN_PRIMARY}>
          New staff account
        </Link>
      }
    />
  );
}
