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
