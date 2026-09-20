"use client";

import { useMemo, useState } from "react";
import { ResourceTable, StatusPill, type Column, type SortState } from "@/components/primitives";
import type { PaymentListRow } from "@/server/services/payment-read-service";

/**
 * The Finance payments list (07-UI-SPEC §7.5). `PaymentRow` mirrors
 * `PaymentListRow` — imported as a type only, never a runtime value, so this
 * client component never pulls the Prisma-touching service module into its
 * bundle (mirrors `CohortsTable.tsx`/`ProgrammesTable.tsx`'s own precedent).
 */
export type PaymentRow = PaymentListRow;

const PROVIDER_LABEL: Record<string, string> = {
  PAYSTACK: "Paystack",
  STRIPE: "Stripe",
  MANUAL: "Manual",
};

// 07-UI-SPEC §5 — the OrderStatus tone mapping.
const PAYMENT_STATUS_TONE: Record<string, "success" | "neutral" | "warning" | "danger"> = {
  PENDING: "neutral",
  PAID: "success",
  FAILED: "danger",
  CANCELLED: "neutral",
  REFUNDED: "warning",
  PARTIALLY_REFUNDED: "warning",
  EXCEPTION: "danger",
};

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending",
  PAID: "Paid",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
  PARTIALLY_REFUNDED: "Partially refunded",
  EXCEPTION: "Exception",
};

// 07-UI-SPEC §7.5 — the discretionary three-state settlement view-model.
const SETTLEMENT_LABEL: Record<string, string> = {
  ESTIMATED_ONLY: "Estimated only",
  RECONCILED: "Reconciled",
  EXCEPTION: "Exception",
};

const SETTLEMENT_TONE: Record<string, "success" | "neutral" | "warning" | "danger"> = {
  ESTIMATED_ONLY: "neutral",
  RECONCILED: "success",
  EXCEPTION: "danger",
};

function formatAmount(amountMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(currency === "NGN" ? "en-NG" : "en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amountMinor / 100);
  } catch {
    return `${amountMinor} minor units ${currency}`;
  }
}

const columns: Column<PaymentRow>[] = [
  {
    key: "order",
    header: "Order",
    render: (r) => r.reference,
    mono: true,
    width: "14%",
  },
  {
    key: "learner",
    header: "Learner",
    render: (r) => r.learnerName,
    subtitle: (r) => r.learnerEmail,
    width: "20%",
  },
  {
    key: "cohort",
    header: "Cohort",
    render: (r) => r.cohortTitle,
    width: "20%",
  },
  {
    key: "amount",
    header: "Amount",
    render: (r) => formatAmount(r.amountMinor, r.currency),
    mono: true,
    align: "right",
    width: "12%",
  },
  {
    key: "provider",
    header: "Provider",
    // Plain text, never a StatusPill — provider isn't a status (§5's guard note).
    render: (r) => (r.provider ? (PROVIDER_LABEL[r.provider] ?? r.provider) : "—"),
    width: "10%",
  },
  {
    key: "payment",
    header: "Payment",
    render: (r) => (
      <StatusPill
        label={PAYMENT_STATUS_LABEL[r.status] ?? r.status}
        tone={PAYMENT_STATUS_TONE[r.status] ?? "neutral"}
      />
    ),
    width: "15%",
  },
  {
    key: "settlement",
    header: "Settlement",
    render: (r) => (
      <StatusPill
        label={SETTLEMENT_LABEL[r.settlementState] ?? r.settlementState}
        tone={SETTLEMENT_TONE[r.settlementState] ?? "neutral"}
      />
    ),
    width: "15%",
  },
];

// Status tabs, with counts; a tab only shows once at least one order is in that status.
const STATUS_TABS = [
  { value: "PENDING", label: "Awaiting confirmation" },
  { value: "PAID", label: "Paid" },
  { value: "PARTIALLY_REFUNDED", label: "Partially refunded" },
  { value: "REFUNDED", label: "Refunded" },
  { value: "EXCEPTION", label: "Exception" },
  { value: "FAILED", label: "Failed" },
  { value: "CANCELLED", label: "Cancelled" },
];

// Exactly 4 options (including "All") — `ResourceTable`'s own `isSegmented`
// threshold (`options.length <= 4`) applies automatically; no new
// segmented-vs-select logic is written here.
const PROVIDER_OPTIONS = [
  { value: "", label: "All providers" },
  { value: "PAYSTACK", label: "Paystack" },
  { value: "STRIPE", label: "Stripe" },
  { value: "MANUAL", label: "Manual" },
];

export function PaymentsTable({
  rows,
  denied,
}: {
  rows?: PaymentRow[];
  denied?: { permission: string };
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [provider, setProvider] = useState("");
  const [sort, setSort] = useState<SortState>({ key: "order", direction: "asc" });

  const visible = useMemo(() => {
    if (!rows) return [];
    const needle = search.trim().toLowerCase();
    const filtered = rows.filter(
      (row) =>
        (!needle ||
          row.reference.toLowerCase().includes(needle) ||
          row.learnerName.toLowerCase().includes(needle) ||
          row.learnerEmail.toLowerCase().includes(needle)) &&
        (!status || row.status === status) &&
        (!provider || row.provider === provider),
    );

    return [...filtered].sort((a, b) => {
      const dir = sort.direction === "asc" ? 1 : -1;
      if (sort.key === "amount") return (a.amountMinor - b.amountMinor) * dir;
      return a.reference.localeCompare(b.reference) * dir;
    });
  }, [rows, search, status, provider, sort]);

  const activeFilterCount = (search ? 1 : 0) + (status ? 1 : 0) + (provider ? 1 : 0);
  const query = [
    search ? `search=${search}` : null,
    status ? `status=${status}` : null,
    provider ? `provider=${provider}` : null,
    `sort=${sort.direction === "desc" ? "-" : ""}${sort.key}`,
  ]
    .filter(Boolean)
    .join("&");

  function clearFilters() {
    setSearch("");
    setStatus("");
    setProvider("");
  }

  // RBAC-06: the denied panel renders identical copy whether or not any
  // payment exists — no order reference, learner name, or amount leaks.
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
    <ResourceTable<PaymentRow>
      asPage
      noun="payments"
      title="Payments"
      columns={columns}
      state={state}
      getRowKey={(r) => r.id}
      getRowLabel={(r) => r.reference}
      getRowHref={(r) => `/staff/payments/${r.id}`}
      primaryColumnKey="order"
      shownCount={denied ? undefined : visible.length}
      totalCount={denied ? undefined : rows?.length}
      // §6 — every row originates from checkout or a manual confirmation;
      // there is no blank-slate payment to create, so no `onCreate` is passed
      // and the default "Create one to get started" copy is overridden.
      emptyBody="Payments appear here once a learner completes checkout or staff record a manual payment."
      filters={[
        {
          kind: "tabs",
          name: "status",
          label: "Status",
          value: status,
          options: [
            { value: "", label: "All", count: rows?.length ?? 0 },
            ...STATUS_TABS.map((tab) => ({
              ...tab,
              count: rows?.filter((r) => r.status === tab.value).length ?? 0,
            })).filter((tab) => tab.count > 0),
          ],
        },
        {
          kind: "search",
          name: "search",
          label: "Search",
          value: search,
          placeholder: "Search by reference or learner",
        },
        {
          kind: "select",
          name: "provider",
          label: "Provider",
          value: provider,
          options: PROVIDER_OPTIONS,
          variant: "select",
        },
      ]}
      onFilterChange={(name, value) => {
        if (name === "search") setSearch(value);
        else if (name === "status") setStatus(value);
        else setProvider(value);
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
    />
  );
}
