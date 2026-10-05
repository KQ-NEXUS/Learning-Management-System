import { listPaymentsForStaff } from "@/server/services/payment-read-service";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { initialPaymentStatus, PaymentsTable, type PaymentRow } from "./PaymentsTable";
import { SessionEnded } from "@/components/shell/SessionEnded";

/**
 * The Finance payments list (PAY-06, PAY-12, 07-UI-SPEC §7.5).
 *
 * `listPaymentsForStaff` is the one `payments.view`-scoped read behind this
 * screen — a denial here renders the identical `ResourceTable` denied panel
 * a Cohort/Course list would (RBAC-06), never a payments-shaped leak.
 */

export const metadata = { title: "Payments" };

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  let rows: PaymentRow[];

  try {
    rows = await listPaymentsForStaff();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return <SessionEnded />;
    }
    if (error instanceof AuthorizationError) {
      return <PaymentsTable denied={{ permission: "payments.view" }} />;
    }
    throw error;
  }

  return <PaymentsTable rows={rows} initialStatus={initialPaymentStatus(status)} />;
}
