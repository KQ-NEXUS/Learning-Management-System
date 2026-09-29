import Link from "next/link";
import { PageHeader } from "@/components/shell/PageHeader";

/**
 * UX batch B — a 404 inside the staff console. Every staff `notFound()` used
 * to fall through to the root 404, which drops staff out of the console into
 * the learner catalogue ("Back to the catalogue").
 *
 * Staff pages answer "not found" both for a missing record and for one the
 * viewer may not open (denial parity), so this copy names neither case.
 */
export default function StaffNotFound() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="We can't find that page" />
      <div className="flex flex-col items-start gap-4">
        <p className="font-mono text-sm text-muted-foreground">404</p>
        <p className="max-w-prose text-base text-foreground-soft">
          It may have been removed, the link may be out of date, or your role may not include it.
        </p>
        <Link
          href="/staff"
          className="inline-flex min-h-11 items-center rounded-md bg-accent px-6 text-sm font-semibold text-accent-contrast hover:bg-accent-deep"
        >
          Back to Overview
        </Link>
      </div>
    </div>
  );
}
