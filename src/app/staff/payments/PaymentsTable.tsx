"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ResourceTable, StatusPill, type Column, type SortState } from "@/components/primitives";
import type { PaymentListRow } from "@/server/services/payment-read-service";
import { humanizeCode } from "@/lib/humanize";
import { PROVIDER_OPTIONS, STATUS_TABS, paymentsListHref } from "./payment-status";

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
    render: (r) => (r.provider ? (PROVIDER_LABEL[r.provider] ?? humanizeCode(r.provider)) : "—"),
    width: "10%",
  },
  {
    key: "payment",
    header: "Payment",
    render: (r) => (
      <StatusPill
        label={PAYMENT_STATUS_LABEL[r.status] ?? humanizeCode(r.status)}
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
        label={SETTLEMENT_LABEL[r.settlementState] ?? humanizeCode(r.settlementState)}
        tone={SETTLEMENT_TONE[r.settlementState] ?? "neutral"}
      />
    ),
    width: "15%",
  },
];

/** How long the search box waits after the last key before it asks the server. */
const SEARCH_DELAY_MS = 300;

/**
 * The list is paged on the server, so the status tab, the provider and the
 * search are NOT applied here: they are in the page address, the server reads
 * the matching orders, and this table shows the rows it is given. The tab
 * counts and the totals are props for the same reason: they count every order
 * the staff member may see, not the rows of the page on screen (checklist
 * W-12). Only the column sort still works on the rows of the current page.
 */
export function PaymentsTable({
  rows,
  denied,
  initialStatus = "",
  provider = "",
  search = "",
  matchingCount,
  totalAll,
  statusCounts,
}: {
  rows?: PaymentRow[];
  denied?: { permission: string };
  /** The status tab in the address (`?status=`). */
  initialStatus?: string;
  /** The provider in the address (`?provider=`). */
  provider?: string;
  /** The search in the address (`?q=`). */
  search?: string;
  /** Orders that match the filters, over every page. */
  matchingCount?: number;
  /** Every order the staff member may see. */
  totalAll?: number;
  /** Orders per status over everything the staff member may see. */
  statusCounts?: Record<string, number>;
}) {
  const router = useRouter();
  const status = initialStatus;
  // What the box shows while the staff member types; the address follows after a short pause.
  const [searchText, setSearchText] = useState(search);
  // The search this table last asked the server for. Until the server answers, the `search`
  // prop is still the old one, so the two are kept apart.
  const [sentSearch, setSentSearch] = useState(search);
  const [seenSearch, setSeenSearch] = useState(search);
  const [sort, setSort] = useState<SortState>({ key: "order", direction: "asc" });

  // The address changed and not because of this box (a link to the list with other filters):
  // show what the address says.
  if (seenSearch !== search) {
    setSeenSearch(search);
    if (search !== sentSearch) {
      setSentSearch(search);
      setSearchText(search);
    }
  }

  const typed = searchText.trim();
  useEffect(() => {
    if (typed === sentSearch) return;
    const timer = setTimeout(() => {
      setSentSearch(typed);
      router.replace(paymentsListHref({ status, provider, search: typed }));
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [typed, sentSearch, status, provider, router]);

  /** Go to the list for these filters now, carrying whatever is in the search box. */
  function go(next: { status: string; provider: string }) {
    setSentSearch(typed);
    router.replace(paymentsListHref({ ...next, search: typed }));
  }

  const visible = useMemo(() => {
    if (!rows) return [];
    return [...rows].sort((a, b) => {
      const dir = sort.direction === "asc" ? 1 : -1;
      if (sort.key === "amount") return (a.amountMinor - b.amountMinor) * dir;
      return a.reference.localeCompare(b.reference) * dir;
    });
  }, [rows, sort]);

  const activeFilterCount = (search || typed ? 1 : 0) + (status ? 1 : 0) + (provider ? 1 : 0);
  const query = [
    search ? `search=${search}` : null,
    status ? `status=${status}` : null,
    provider ? `provider=${provider}` : null,
    `sort=${sort.direction === "desc" ? "-" : ""}${sort.key}`,
  ]
    .filter(Boolean)
    .join("&");

  function clearFilters() {
    setSearchText("");
    setSentSearch("");
    router.replace(paymentsListHref({}));
  }

  const total = totalAll ?? rows?.length ?? 0;
  const matching = matchingCount ?? visible.length;

  // RBAC-06: the denied panel renders identical copy whether or not any
  // payment exists — no order reference, learner name, or amount leaks.
  const state = denied
    ? ({ status: "denied", permission: denied.permission } as const)
    : visible.length > 0
      ? ({ status: "ready", rows: visible } as const)
      : ({
          status: "empty",
          activeFilterCount,
          totalWithoutFilters: total,
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
      shownCount={denied ? undefined : matching}
      totalCount={denied ? undefined : total}
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
          // Counts of every order in scope. A status nobody has is left out,
          // except the tab that is open, so the open tab never disappears.
          options: [
            { value: "", label: "All", count: total },
            ...STATUS_TABS.map((tab) => ({
              ...tab,
              count: statusCounts?.[tab.value] ?? 0,
            })).filter((tab) => tab.count > 0 || tab.value === status),
          ],
        },
        {
          kind: "search",
          name: "search",
          label: "Search",
          value: searchText,
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
        // A new tab or provider starts again at page 1 (the address carries no page).
        if (name === "search") setSearchText(value);
        else if (name === "status") go({ status: value, provider });
        else go({ status, provider: value });
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
