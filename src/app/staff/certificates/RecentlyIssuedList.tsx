import Link from "next/link";
import { StatusPill } from "@/components/primitives";
import {
  CERTIFICATE_STATUS_LABEL,
  CERTIFICATE_STATUS_TONE,
  certificateDisplayStatus,
} from "@/lib/certificate-display-status";
import { formatTimestamp } from "@/lib/format-timestamp";
// `import type` only: this component takes plain props and must not pull the service graph in.
import type { CertificateRow, IssuanceSource } from "@/server/services/certificate-service";

/**
 * "Recently issued" section of the Certificates landing page (UAT test 8, landing-page half).
 *
 * The landing page's pending queue only lists MANUAL-mode certificates awaiting issuance, so an
 * automatic issuance (D-03, SYSTEM actor) left no trace where staff were looking. This section
 * shows the newest certificates, each marked Automatic or with the staff member's name, and each
 * linking to its detail page. Presentational: the caller supplies the (already limited, newest
 * first) rows and the batched source lookup from `listCertificateIssuanceSources`.
 *
 * Only display fields are rendered — no actor ids and no revocation reason (T-11-96).
 */
export function RecentlyIssuedList({
  rows,
  sources,
}: {
  rows: CertificateRow[];
  sources: Record<string, IssuanceSource>;
}) {
  return (
    <section aria-labelledby="recently-issued-heading" className="flex flex-col gap-2">
      <h2 id="recently-issued-heading" className="text-base font-semibold text-foreground">
        Recently issued
      </h2>
      <p className="text-sm text-muted-foreground">
        Certificates issued most recently, including those issued automatically.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No certificates have been issued yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {rows.map((row) => {
            const display = certificateDisplayStatus(row);
            const source = sources[row.id];
            return (
              <li key={row.id}>
                <Link
                  href={`/staff/certificates/issued/${row.id}`}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 hover:bg-surface-2"
                >
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="text-sm font-semibold text-foreground break-words">
                      {row.learnerName}
                    </span>
                    <span className="text-sm text-muted-foreground break-words">{row.awardTitle}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="font-mono text-muted-foreground">{formatTimestamp(row.issuedAt)}</span>
                    <StatusPill
                      tone={CERTIFICATE_STATUS_TONE[display]}
                      label={CERTIFICATE_STATUS_LABEL[display]}
                    />
                    <IssuedBy source={source} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <div className="text-sm">
        <Link href="/staff/certificates/issued" className="text-accent underline underline-offset-2">
          View all certificates
        </Link>
      </div>
    </section>
  );
}

/** A missing source is "Not recorded" — never guessed as Automatic (T-11-93). */
function IssuedBy({ source }: { source: IssuanceSource | undefined }) {
  if (!source || source.kind === "not-recorded") {
    return <span className="text-muted-foreground">Not recorded</span>;
  }
  if (source.kind === "automatic") return <StatusPill tone="accent" label="Automatic" />;
  return <span className="text-foreground">{source.actorName ?? "Staff member"}</span>;
}
