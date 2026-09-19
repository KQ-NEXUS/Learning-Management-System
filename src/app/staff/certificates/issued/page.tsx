import { notFound } from "next/navigation";
import Link from "next/link";
import { Award } from "lucide-react";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import {
  certificateService,
  listCertificateIssuanceSources,
} from "@/server/services/certificate-service";
import { IssuedCertificatesTable } from "./IssuedCertificatesTable";

/**
 * The full certificate-record list (CRD-03, CRD-05, CRD-06) — `11-UI-SPEC.md` §7.2.
 *
 * Plain async Server Component, `try`/`catch` treating an auth failure as `notFound()` — the same
 * shape `certificates/page.tsx` (the pending-issuance queue) already established for this area.
 * `certificateService.list({})` with no scope requires a GLOBAL `certificates.view` grant
 * (`resource-service.ts`'s own "list with no scope" discipline) — the same behaviour
 * `staff/courses/page.tsx` already relies on for its own unscoped list.
 */
export const metadata = { title: "All certificates" };

export default async function IssuedCertificatesPage() {
  let rows;
  let sources;
  try {
    rows = await certificateService.list({});
    // One batched, authorized audit read — never a per-row lookup (UAT test 8).
    sources = await listCertificateIssuanceSources({ certificateIds: rows.map((row) => row.id) });
  } catch (error) {
    if (error instanceof AuthenticationError || error instanceof AuthorizationError) notFound();
    throw error;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-base font-semibold text-foreground">
          <Award aria-hidden size={20} className="text-accent" />
          <h1>All certificates</h1>
        </div>
        <Link href="/staff/certificates" className="text-sm text-accent underline underline-offset-2">
          Pending issuance
        </Link>
      </div>
      <IssuedCertificatesTable rows={rows} sources={sources} />
    </div>
  );
}
