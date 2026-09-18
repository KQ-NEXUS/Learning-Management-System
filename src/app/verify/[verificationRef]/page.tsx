import { ShieldCheck, ShieldQuestion, ShieldX } from "lucide-react";
import { verifyCertificateByRef } from "@/server/services/certificate-verification-service";

/**
 * The public verification result page (CRD-04, UI-SPEC §7.5).
 *
 * Exactly three render branches, one per `CertificateVerificationResult`
 * outcome — never a fourth shape, never a shared structure between "unknown"
 * and "real" (Pitfall 3). The not-found branch renders no `<dl>` at all, not
 * even an empty one: an observer must not be able to distinguish outcomes by
 * DOM shape alone.
 *
 * The reference is echoed back exactly as received from the URL segment, in
 * mono/break-all text only — never interpolated into markup, a query
 * string, or a redirect target.
 *
 * No opt-in-to-caching wrapper, no static-generation export, no
 * revalidation-interval export here (Pitfall 6) — the Prisma read inside
 * `verifyCertificateByRef` already defers this page to request time, and a
 * cached "active" verdict would keep reporting a revoked credential as
 * valid.
 */

function formatIssuedDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

export default async function VerifyResultPage({
  params,
}: {
  params: Promise<{ verificationRef: string }>;
}) {
  const { verificationRef } = await params;
  const result = await verifyCertificateByRef(verificationRef);

  return (
    <div className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-border bg-surface p-6 shadow-card">
      {result.status === "active" && (
        <>
          <ShieldCheck aria-hidden className="size-8 text-success" />
          <h2 className="text-base font-semibold text-foreground">
            This certificate is valid.
          </h2>
          <dl className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Learner name
              </dt>
              <dd className="text-sm text-foreground">{result.learnerName}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Award title
              </dt>
              <dd className="text-sm text-foreground">{result.awardTitle}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Issued date
              </dt>
              <dd className="font-mono text-sm text-foreground">
                {formatIssuedDate(result.issuedAt)}
              </dd>
            </div>
          </dl>
        </>
      )}

      {result.status === "revoked" && (
        <>
          <ShieldX aria-hidden className="size-8 text-danger" />
          <h2 className="text-base font-semibold text-foreground">
            This certificate has been revoked and is no longer valid.
          </h2>
          <dl className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Learner name
              </dt>
              <dd className="text-sm text-foreground">{result.learnerName}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Award title
              </dt>
              <dd className="text-sm text-foreground">{result.awardTitle}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Issued date
              </dt>
              <dd className="font-mono text-sm text-foreground">
                {formatIssuedDate(result.issuedAt)}
              </dd>
            </div>
          </dl>
        </>
      )}

      {result.status === "not_found" && (
        <>
          <ShieldQuestion aria-hidden className="size-8 text-muted-foreground" />
          <h2 className="text-base font-semibold text-foreground">
            We couldn&apos;t find a certificate with this reference.
          </h2>
          <p className="text-sm text-muted-foreground">
            Double-check the reference and try again.
          </p>
        </>
      )}

      <p className="break-all font-mono text-[11px] text-muted-foreground">
        Reference: {verificationRef}
      </p>
    </div>
  );
}
