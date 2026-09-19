import { notFound } from "next/navigation";
import Link from "next/link";
import { Award } from "lucide-react";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import {
  certificateService,
  listCertificateIssuanceSources,
  listPendingIssuance,
} from "@/server/services/certificate-service";
import { CertificateQueueTable } from "./CertificateQueueTable";
import { RecentlyIssuedList } from "./RecentlyIssuedList";

/** How many of the newest certificates the landing page shows. */
const RECENT_LIMIT = 10;

/**
 * Certificates landing page — D-04's MANUAL-mode pending-issuance queue, plus a "Recently issued"
 * section (UAT test 8) so certificates issued automatically (D-03) are visible here too instead of
 * only on the All certificates page. Both reads sit behind the same global `certificates.view`
 * grant; any denial is the same `notFound()` as before.
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
  let recent;
  let sources;
  try {
    rows = await listPendingIssuance();
    const issued = await certificateService.list({});
    // The replacement certificate is what staff should see, not the one it superseded.
    recent = issued
      .filter((row) => row.status !== "SUPERSEDED")
      .sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime())
      .slice(0, RECENT_LIMIT);
    // One batched, authorized audit read for exactly the rows shown (never per-row).
    sources =
      recent.length > 0
        ? await listCertificateIssuanceSources({ certificateIds: recent.map((row) => row.id) })
        : {};
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
      <RecentlyIssuedList rows={recent} sources={sources} />
    </div>
  );
}
