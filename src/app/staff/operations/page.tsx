import Link from "next/link";
import { PageHeader } from "@/components/shell/PageHeader";
import { BTN_ON_NAVY, NOTE_DANGER } from "@/components/primitives/controls";
import { SessionEnded } from "@/components/shell/SessionEnded";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { MAX_SEND_ATTEMPTS } from "@/server/communications/contracts";
import { opsStatusService } from "@/server/services/ops-status-service";
import { summariseOpsStatus, type OpsStatus } from "@/server/services/ops-status-types";
import { OperationsBand, OperationsSections, OverallStatusPill } from "./OperationsSections";
import { OperationsDenied } from "./OperationsDenied";

/**
 * `/staff/operations` — the operations status page (plan 15-13; D-18, NFR-07, NFR-13).
 *
 * Failed jobs, payment exceptions, email failures and the data integrity checks,
 * read from records the product already stores. The service is gated by
 * `audit.view` at Global scope; this page only maps its refusals to the existing
 * session-ended and denied states. No polling and no auto-refresh: "Refresh
 * status" is a plain link back to this page.
 */

export const metadata = { title: "Operations status" };
export const dynamic = "force-dynamic";

const SUBTITLE = "Failed jobs, payment exceptions and email failures, read from stored records.";

export default async function OperationsStatusPage() {
  let status: OpsStatus;
  try {
    status = await opsStatusService.getOperationsStatus();
  } catch (error) {
    if (error instanceof AuthenticationError) return <SessionEnded />;
    if (error instanceof AuthorizationError) {
      // Identical whether or not any failure exists, so the denial reveals nothing (RBAC-06).
      return <OperationsDenied />;
    }
    return (
      <div className="flex flex-col">
        <PageHeader title="Operations status" subtitle={SUBTITLE} />
        <p role="alert" className={`${NOTE_DANGER} mt-4`}>
          Couldn&apos;t load the operations status. Reload the page; if it persists, contact an administrator.
        </p>
      </div>
    );
  }

  const summary = summariseOpsStatus(status);

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Operations status"
        subtitle={SUBTITLE}
        meta={<OverallStatusPill needsAttention={summary.needsAttention} />}
        actions={
          <Link href="/staff/operations" className={BTN_ON_NAVY}>
            Refresh status
          </Link>
        }
        band={<OperationsBand summary={summary} checkedAt={status.checkedAt} maxSendAttempts={MAX_SEND_ATTEMPTS} />}
      />
      <div className="mt-4">
        <OperationsSections status={status} summary={summary} />
      </div>
    </div>
  );
}
