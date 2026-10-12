/**
 * Status tabs for the payments list. Lives outside `PaymentsTable.tsx` because that file is a
 * client component: the server page cannot call a function exported from a "use client" file.
 */
export const STATUS_TABS = [
  { value: "PENDING", label: "Awaiting confirmation" },
  { value: "PAID", label: "Paid" },
  { value: "PARTIALLY_REFUNDED", label: "Partially refunded" },
  { value: "REFUNDED", label: "Refunded" },
  { value: "EXCEPTION", label: "Exception" },
  { value: "FAILED", label: "Failed" },
  { value: "CANCELLED", label: "Cancelled" },
];

/**
 * The status tab the list opens on, from the page's `?status=` (the overview's "orders needing
 * review" link lands on Exception, audit A-12). Anything that is not a known tab opens on All.
 */
export function initialPaymentStatus(value: string | undefined): string {
  return value && STATUS_TABS.some((tab) => tab.value === value) ? value : "";
}

export const PROVIDER_OPTIONS = [
  { value: "", label: "All providers" },
  { value: "PAYSTACK", label: "Paystack" },
  { value: "STRIPE", label: "Stripe" },
  { value: "MANUAL", label: "Manual" },
];

/** The provider filter from the page's `?provider=`; anything that is not a known provider means all. */
export function initialPaymentProvider(value: string | undefined): string {
  return value && PROVIDER_OPTIONS.some((option) => option.value === value) ? value : "";
}

/**
 * The address of the payments list for a set of filters. Shared by the server page (Previous and
 * Next) and the table (tabs, provider, search), so both write the same parameters in the same order.
 */
export function paymentsListHref(filters: { status?: string; provider?: string; search?: string; page?: number }): string {
  const query = new URLSearchParams();
  if (filters.status) query.set("status", filters.status);
  if (filters.provider) query.set("provider", filters.provider);
  if (filters.search) query.set("q", filters.search);
  if (filters.page && filters.page > 1) query.set("page", String(filters.page));
  const text = query.toString();
  return text ? `/staff/payments?${text}` : "/staff/payments";
}
