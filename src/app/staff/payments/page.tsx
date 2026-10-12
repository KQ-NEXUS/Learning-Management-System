import Link from "next/link";
import {
  listPaymentsForStaff,
  type PaymentListOptions,
  type PaymentListPage,
} from "@/server/services/payment-read-service";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { PaymentsTable } from "./PaymentsTable";
import { initialPaymentProvider, initialPaymentStatus, paymentsListHref } from "./payment-status";
import { SessionEnded } from "@/components/shell/SessionEnded";
import { BTN } from "@/components/primitives/controls";

/**
 * The Finance payments list (PAY-06, PAY-12, 07-UI-SPEC §7.5).
 *
 * `listPaymentsForStaff` is the one `payments.view`-scoped read behind this
 * screen — a denial here renders the identical `ResourceTable` denied panel
 * a Cohort/Course list would (RBAC-06), never a payments-shaped leak.
 *
 * NFR-02: the list reads one page of at most 50 orders, newest first, with
 * Previous and Next links; it never loads every order.
 *
 * The status tab, the provider and the search are in the address
 * (`?status=`, `?provider=`, `?q=`) and are applied by the service, so they
 * cover every order the staff member may see, not only the page on screen.
 */

export const metadata = { title: "Payments" };

/** Allow-list parse: a positive whole number, otherwise page 1. */
function parsePaymentsPage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && /^[1-9]\d{0,4}$/.test(raw) ? Number(raw) : 1;
}

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string | string[];
    provider?: string | string[];
    q?: string | string[];
    page?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const status = typeof params.status === "string" ? params.status : undefined;
  // The filters are kept only when they are known values; the service checks them again.
  const statusTab = initialPaymentStatus(status);
  const provider = initialPaymentProvider(typeof params.provider === "string" ? params.provider : undefined);
  const search = typeof params.q === "string" ? params.q.trim().slice(0, 100).trim() : "";
  const requested = parsePaymentsPage(params.page);
  const filters: PaymentListOptions = {
    ...(statusTab ? { status: statusTab } : {}),
    ...(provider ? { provider } : {}),
    ...(search ? { search } : {}),
  };
  let list: PaymentListPage;

  try {
    list = await listPaymentsForStaff({ page: requested, ...filters });
    // A page past the end (an old link after orders moved, or a filter that leaves fewer pages)
    // shows the last page instead of an empty table.
    const lastPage = Math.max(1, Math.ceil(list.total / list.pageSize));
    if (list.page > lastPage) list = await listPaymentsForStaff({ page: lastPage, ...filters });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return <SessionEnded />;
    }
    if (error instanceof AuthorizationError) {
      return <PaymentsTable denied={{ permission: "payments.view" }} />;
    }
    throw error;
  }

  const hasPrevious = list.page > 1;
  const hasNext = list.page * list.pageSize < list.total;
  const pageHref = (page: number) => paymentsListHref({ status: statusTab, provider, search, page });

  return (
    <div data-primary-content>
      <PaymentsTable
        rows={list.rows}
        initialStatus={initialPaymentStatus(status)}
        provider={provider}
        search={search}
        matchingCount={list.total}
        totalAll={list.totalAll}
        statusCounts={list.statusCounts}
      />
      {list.total > 0 && (
        <nav aria-label="Payment pages" className="flex flex-wrap items-center justify-between gap-4 pt-4 text-sm">
          <span className="text-muted-foreground">
            Showing {list.rows.length} of {list.total}.
          </span>
          {(hasPrevious || hasNext) && (
            <span className="flex gap-3">
              {hasPrevious && (
                <Link href={pageHref(list.page - 1)} className={BTN}>
                  Previous
                </Link>
              )}
              {hasNext && (
                <Link href={pageHref(list.page + 1)} className={BTN}>
                  Next
                </Link>
              )}
            </span>
          )}
        </nav>
      )}
    </div>
  );
}
