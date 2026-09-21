import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/PageHeader";
import Link from "next/link";
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
      <PageHeader
        title="All certificates"
        breadcrumbs={[{ label: "Certificates", href: "/staff/certificates" }, { label: "All certificates" }]}
        actions={
          <Link href="/staff/certificates" className="inline-flex min-h-10 items-center rounded-md border border-sidebar-line px-4 text-sm font-semibold text-white hover:bg-sidebar-hover">
            Pending issuance
          </Link>
        }
      />
      <IssuedCertificatesTable rows={rows} sources={sources} />
    </div>
  );
}
