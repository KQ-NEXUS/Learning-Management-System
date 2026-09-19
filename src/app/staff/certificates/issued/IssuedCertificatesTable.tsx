"use client";

/**
 * The full certificate-record list (CRD-03, CRD-05, CRD-06) — `11-UI-SPEC.md` §7.2.
 *
 * Client-side search/filter, mirroring `CoursesTable.tsx`'s exact shape (local `useState` filter,
 * a memoized visible-rows derivation, `activeQuery` chip built from the same state) rather than
 * URL-driven filters — no sibling certificate screen reads filters from the URL either.
 *
 * Status tone/label come from `certificateDisplayStatus` and NOTHING else (UI-SPEC §5's
 * load-bearing precedence rule): a certificate with `status: "ACTIVE"` and a non-null
 * `reviewFlaggedAt` renders the `warning` "Flagged for review" pill, never a plain green "Active" —
 * computing tone from `status` alone would make CRD-06's flag visually inert. The "Active" filter
 * option uses the same helper, so it structurally excludes flagged rows too.
 *
 * No inline row actions — revoke/reissue live only on the detail page (UI-SPEC §7.2, matching
 * Phase 10's grade-entry precedent: "one focused action screen, not row-level destructive buttons
 * in a dense table" for consequential mutations).
 */

import { useMemo, useState } from "react";
import { ResourceTable, StatusPill, type Column } from "@/components/primitives";
import { formatTimestamp } from "@/lib/format-timestamp";
import { certificateDisplayStatus } from "@/lib/certificate-display-status";
// `import type` only — this is a client component and must not pull the service's server graph
// into the browser bundle (same reason `certificateDisplayStatus` lives in `src/lib`).
import type { CertificateRow, IssuanceSource } from "@/server/services/certificate-service";

type FilterValue = "" | "active" | "flagged" | "revoked";
type IssuedByFilterValue = "" | "automatic" | "staff";

/** Consistent with the detail page's "System (automatic issuance)" wording. A missing source is
 *  "Not recorded" — never guessed as Automatic (T-11-93). */
function issuedByLabel(source: IssuanceSource | undefined): string {
  if (!source || source.kind === "not-recorded") return "Not recorded";
  if (source.kind === "automatic") return "Automatic";
  return source.actorName ?? "Staff member";
}

const STATUS_TONE = {
  revoked: "danger",
  flagged: "warning",
  superseded: "neutral",
  active: "success",
} as const;

const STATUS_LABEL = {
  revoked: "Revoked",
  flagged: "Flagged for review",
  superseded: "Superseded",
  active: "Active",
} as const;

const columns: Column<CertificateRow>[] = [
  {
    key: "learner",
    header: "Learner",
    render: (row) => row.learnerName,
  },
  {
    key: "award",
    header: "Award",
    render: (row) => row.awardTitle,
  },
  {
    key: "verificationRef",
    header: "Verification reference",
    mono: true,
    // `break-all` — a partially hidden verification reference is useless to
    // the person reading it off a printed certificate (UI-SPEC §4). No
    // ellipsis-style clipping class is used on this cell.
    render: (row) => <span className="break-all">{row.verificationRef}</span>,
  },
  {
    key: "issuedAt",
    header: "Issued",
    mono: true,
    render: (row) => formatTimestamp(row.issuedAt),
  },
  {
    key: "status",
    header: "Status",
    render: (row) => {
      const display = certificateDisplayStatus(row);
      return <StatusPill tone={STATUS_TONE[display]} label={STATUS_LABEL[display]} />;
    },
  },
];

export function IssuedCertificatesTable({
  rows,
  sources,
}: {
  rows: CertificateRow[];
  /** Issuance source per certificate id (UAT test 8). Optional: when omitted the "Issued by"
   *  column and filter are not rendered and the table is unchanged. */
  sources?: Record<string, IssuanceSource>;
}) {
  const [filter, setFilter] = useState<FilterValue>("");
  const [issuedBy, setIssuedBy] = useState<IssuedByFilterValue>("");
  const showIssuedBy = sources !== undefined;

  const tableColumns = useMemo<Column<CertificateRow>[]>(() => {
    if (!sources) return columns;
    const issuedByColumn: Column<CertificateRow> = {
      key: "issuedBy",
      header: "Issued by",
      render: (row) => issuedByLabel(sources[row.id]),
    };
    const issuedIndex = columns.findIndex((column) => column.key === "issuedAt");
    return [...columns.slice(0, issuedIndex + 1), issuedByColumn, ...columns.slice(issuedIndex + 1)];
  }, [sources]);

  const visible = useMemo(() => {
    return rows.filter((row) => {
      if (filter && certificateDisplayStatus(row) !== filter) return false;
      if (issuedBy) {
        const kind = sources?.[row.id]?.kind;
        if (kind !== issuedBy) return false;
      }
      return true;
    });
  }, [rows, filter, issuedBy, sources]);

  const activeFilterCount = (filter ? 1 : 0) + (issuedBy ? 1 : 0);
  const activeQuery = [filter ? `status=${filter}` : "", issuedBy ? `issuedBy=${issuedBy}` : ""]
    .filter(Boolean)
    .join("&");

  const state =
    visible.length > 0
      ? ({ status: "ready", rows: visible } as const)
      : ({ status: "empty", activeFilterCount, totalWithoutFilters: rows.length } as const);

  return (
    <ResourceTable<CertificateRow>
      noun="certificates"
      columns={tableColumns}
      state={state}
      getRowKey={(row) => row.id}
      getRowHref={(row) => `/staff/certificates/issued/${row.id}`}
      getRowLabel={(row) => row.learnerName}
      primaryColumnKey="learner"
      shownCount={visible.length}
      totalCount={rows.length}
      filters={[
        {
          kind: "select",
          name: "status",
          label: "Status",
          value: filter,
          options: [
            { value: "", label: "All" },
            { value: "active", label: "Active" },
            { value: "flagged", label: "Flagged" },
            { value: "revoked", label: "Revoked" },
          ],
        },
        ...(showIssuedBy
          ? [
              {
                kind: "select" as const,
                name: "issuedBy",
                label: "Issued by",
                value: issuedBy,
                options: [
                  { value: "", label: "All" },
                  { value: "automatic", label: "Automatic" },
                  { value: "staff", label: "Staff" },
                ],
              },
            ]
          : []),
      ]}
      onFilterChange={(name, value) =>
        name === "issuedBy" ? setIssuedBy(value as IssuedByFilterValue) : setFilter(value as FilterValue)
      }
      activeQuery={activeFilterCount > 0 ? `?${activeQuery}` : undefined}
      onClearFilters={
        activeFilterCount > 0
          ? () => {
              setFilter("");
              setIssuedBy("");
            }
          : undefined
      }
      emptyHeading="No certificates issued yet"
      emptyBody="Certificates appear here automatically once one is issued."
    />
  );
}
