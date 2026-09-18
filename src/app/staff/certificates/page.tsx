import { notFound } from "next/navigation";
import Link from "next/link";
import { Award } from "lucide-react";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { listPendingIssuance } from "@/server/services/certificate-service";
import { CertificateQueueTable } from "./CertificateQueueTable";

/**
 * Certificates landing page — D-04's MANUAL-mode pending-issuance queue.
 *
 * Follows the grading-queue SSR shape exactly (`grading/[assessmentId]/page.tsx`): a plain
 * async Server Component, no params here, `try`/`catch` treating an auth failure as `notFound()`
 * so a denied staff member gets the same 404 shape as a non-existent route (RBAC-06 —
 * no distinguishable-from-missing signal).
 *
 * The single Certificates nav entry (Task 1) is the only top-level route into this area — the
 * issued list and template library are one click deeper from here (UI-SPEC §0.2 D-20 restraint).
 */
export const metadata = { title: "Certificates" };

export default async function CertificatesPage() {
  let rows;
  try {
    rows = await listPendingIssuance();
  } catch (error) {
    if (error instanceof AuthenticationError || error instanceof AuthorizationError) notFound();
    throw error;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-base font-semibold text-foreground">
          <Award aria-hidden size={20} className="text-accent" />
          <h1>Certificates</h1>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <Link href="/staff/certificates/issued" className="text-accent underline underline-offset-2">
            All certificates
          </Link>
          <Link
            href="/staff/certificates/templates"
            className="text-accent underline underline-offset-2"
          >
            Certificate templates
          </Link>
        </div>
      </div>
      <CertificateQueueTable rows={rows} />
    </div>
  );
}
