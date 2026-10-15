import type { ReactNode } from "react";
import { headers } from "next/headers";
import { Clock, ShieldCheck, ShieldQuestion, ShieldX } from "lucide-react";
import { verifyCertificateByRef } from "@/server/services/certificate-verification-service";
import { rateLimitService } from "@/server/services/rate-limit-service";
import { clientIpFrom } from "@/server/auth/sign-in-throttle";
import { LAGOS_TIME_ZONE } from "@/lib/format-timestamp";
import { VerifyTop } from "../VerifyTop";

/**
 * The public verification result page (CRD-04, UI-SPEC §7.5).
 *
 * Exactly four render branches: one per `CertificateVerificationResult`
 * outcome, plus the rate-limited branch (D-11, UI-SPEC S5) — never a shared
 * structure between "unknown" and "real" (Pitfall 3). The not-found branch
 * renders no `<dl>` at all, not even an empty one: an observer must not be
 * able to distinguish outcomes by DOM shape alone.
 *
 * The rate-limited branch is decided BEFORE the lookup: a device past 60
 * checks in 15 minutes gets its own icon and heading block, no `<dl>`, and
 * `verifyCertificateByRef` is never called, so a throttled scraper learns
 * nothing about the reference (T-15-03-03). Without a trusted client IP no
 * limit applies and nothing is recorded.
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

/** The formal long-month issue date ("5 October 2026"), computed in Africa/Lagos (D-17, UI-SPEC S6). */
function formatIssuedDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: LAGOS_TIME_ZONE,
  }).format(date);
}

/** The issue date inside a time element carrying the exact ISO 8601 UTC instant. */
function IssuedDate({ date }: { date: Date }) {
  return <time dateTime={date.toISOString()}>{formatIssuedDate(date)}</time>;
}

/** One label/value row: 180px label column, a hairline above it. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 border-t border-ink/20 py-3.5 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="text-[17px] font-bold">{children}</dd>
    </div>
  );
}

/** The result strip: full width, tinted by outcome, with its shield and heading. */
function Result({ tint, icon, heading, children }: { tint: string; icon: ReactNode; heading: string; children: ReactNode }) {
  return (
    <section aria-label="Result" className={`-mx-5 mt-11 -mb-[72px] px-5 py-9 md:-mx-14 md:px-14 ${tint}`}>
      <div className="flex items-start gap-4 sm:items-center">
        {icon}
        <h2 className="ietc-display text-[clamp(30px,3.4vw,46px)]">{heading}</h2>
      </div>
      {children}
    </section>
  );
}

export default async function VerifyResultPage({
  params,
}: {
  params: Promise<{ verificationRef: string }>;
}) {
  const { verificationRef } = await params;
  const limit = await rateLimitService.consume("certificateCheck", { ip: clientIpFrom(await headers()) });
  const result = limit.limited ? null : await verifyCertificateByRef(verificationRef);
  const reference = <p className="mt-[18px] text-sm break-all text-ink-soft">Reference: {verificationRef}</p>;
  const shield = "size-11 shrink-0";

  return (
    <div className="flex flex-col">
      <VerifyTop />

      {limit.limited && (
        <Result tint="bg-tint-4" icon={<Clock aria-hidden className={`${shield} text-ink-soft`} />} heading="Too many checks from this device.">
          <p className="mt-4 text-ink-soft">Wait {limit.windowMinutes} minutes, then check the reference again.</p>
          {reference}
        </Result>
      )}

      {result?.status === "active" && (
        <Result tint="bg-pill-green-bg" icon={<ShieldCheck aria-hidden className={`${shield} text-success`} />} heading="This certificate is valid.">
          <dl className="mt-[22px] max-w-[760px]">
            <Row label="Learner name">{result.learnerName}</Row>
            <Row label="Award title">{result.awardTitle}</Row>
            <Row label="Issued date">
              <IssuedDate date={result.issuedAt} />
            </Row>
          </dl>
          <p className="mt-4 text-ink-soft">Only the details above are shown. Nothing else about the learner is disclosed.</p>
          {reference}
        </Result>
      )}

      {result?.status === "revoked" && (
        <Result tint="bg-danger-surface" icon={<ShieldX aria-hidden className={`${shield} text-danger`} />} heading="This certificate has been revoked and is no longer valid.">
          <dl className="mt-[22px] max-w-[760px]">
            <Row label="Learner name">{result.learnerName}</Row>
            <Row label="Award title">{result.awardTitle}</Row>
            <Row label="Issued date">
              <IssuedDate date={result.issuedAt} />
            </Row>
          </dl>
          <p className="mt-4 text-ink-soft">The learner name, award title and issue date are still shown.</p>
          {reference}
        </Result>
      )}

      {result?.status === "not_found" && (
        <Result tint="bg-tint-4" icon={<ShieldQuestion aria-hidden className={`${shield} text-ink-soft`} />} heading="We couldn't find a certificate with this reference.">
          <p className="mt-4 text-ink-soft">Double-check the reference and try again.</p>
          {reference}
        </Result>
      )}
    </div>
  );
}
