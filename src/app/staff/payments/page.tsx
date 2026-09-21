import { listPaymentsForStaff } from "@/server/services/payment-read-service";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { PaymentsTable, type PaymentRow } from "./PaymentsTable";

/**
 * The Finance payments list (PAY-06, PAY-12, 07-UI-SPEC §7.5).
 *
 * `listPaymentsForStaff` is the one `payments.view`-scoped read behind this
 * screen — a denial here renders the identical `ResourceTable` denied panel
 * a Cohort/Course list would (RBAC-06), never a payments-shaped leak.
 */

export const metadata = { title: "Payments" };

export default async function PaymentsPage() {
  let rows: PaymentRow[];

  try {
    rows = await listPaymentsForStaff();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return <p className="text-sm text-foreground">Your session has ended. Sign in again.</p>;
    }
    if (error instanceof AuthorizationError) {
      return <PaymentsTable denied={{ permission: "payments.view" }} />;
    }
    throw error;
  }

  return <PaymentsTable rows={rows} />;
}
