import type { ReactNode } from "react";
import { ShieldCheck, ShieldQuestion, ShieldX } from "lucide-react";
import { verifyCertificateByRef } from "@/server/services/certificate-verification-service";
import { VerifyReferenceForm } from "../VerifyReferenceForm";
import { LearnerPageHeader } from "@/components/shell/LearnerPageHeader";

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
    month: "long",
    day: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

/** One label/value row: 180px label column, hairline under it. */
function Row({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="grid gap-1 border-b border-border py-4 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono text-sm text-foreground" : "text-base font-semibold text-foreground"}>
        {children}
      </dd>
    </div>
  );
}

export default async function VerifyResultPage({
  params,
}: {
  params: Promise<{ verificationRef: string }>;
}) {
  const { verificationRef } = await params;
  const result = await verifyCertificateByRef(verificationRef);

  return (
    <div className="flex flex-col gap-6">
      <LearnerPageHeader
        size="hero"
        title="Verify a certificate"
        subtitle="Enter the verification reference from a certificate to check whether it's valid."
      />
      <div className="flex w-full max-w-[760px] flex-col">
        <VerifyReferenceForm />
        <section aria-label="Result" className="flex flex-col gap-2 border-t border-foreground pt-8">
          {result.status === "active" && (
            <>
              <div className="flex items-center gap-4">
                <ShieldCheck aria-hidden className="size-8 shrink-0 text-success" />
                <h2 className="text-[28px] leading-[1.2] font-semibold tracking-[-0.03em] text-foreground">
                  This certificate is valid.
                </h2>
              </div>
              <dl className="mt-4">
                <Row label="Learner name">{result.learnerName}</Row>
                <Row label="Award title">{result.awardTitle}</Row>
                <Row label="Issued date" mono>
                  {formatIssuedDate(result.issuedAt)}
                </Row>
              </dl>
              <p className="mt-2 text-sm text-muted-foreground">
                Only the details above are shown. Nothing else about the learner is disclosed.
              </p>
            </>
          )}

          {result.status === "revoked" && (
            <>
              <div className="flex items-center gap-4">
                <ShieldX aria-hidden className="size-8 shrink-0 text-danger" />
                <h2 className="text-[28px] leading-[1.2] font-semibold tracking-[-0.03em] text-foreground">
                  This certificate has been revoked and is no longer valid.
                </h2>
              </div>
              <dl className="mt-4">
                <Row label="Learner name">{result.learnerName}</Row>
                <Row label="Award title">{result.awardTitle}</Row>
                <Row label="Issued date" mono>
                  {formatIssuedDate(result.issuedAt)}
                </Row>
              </dl>
              <p className="mt-2 text-sm text-muted-foreground">
                The learner name, award title and issue date are still shown.
              </p>
            </>
          )}

          {result.status === "not_found" && (
            <>
              <div className="flex items-center gap-4">
                <ShieldQuestion aria-hidden className="size-8 shrink-0 text-muted-foreground" />
                <h2 className="text-[28px] leading-[1.2] font-semibold tracking-[-0.03em] text-foreground">
                  We couldn&apos;t find a certificate with this reference.
                </h2>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">Double-check the reference and try again.</p>
            </>
          )}

          <p className="mt-4 font-mono text-xs break-all text-muted-foreground">Reference: {verificationRef}</p>
        </section>
      </div>
    </div>
  );
}
