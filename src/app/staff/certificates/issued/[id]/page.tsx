import { notFound } from "next/navigation";
import Link from "next/link";
import { Ban, AlertTriangle } from "lucide-react";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import {
  certificateService,
  certificateDisplayStatus,
  getCertificateIssuer,
  type CertificateRow,
} from "@/server/services/certificate-service";
import { enrolmentCohortScope } from "@/server/services/cohort-scope";
import { resolveActorNames } from "@/server/services/grading-service";
import { DetailLayout, DetailFacts } from "@/components/primitives";
import { formatTimestamp } from "@/lib/format-timestamp";
import { CertificateRecordActions } from "./CertificateRecordActions";

/**
 * Certificate detail — award facts, banners, the supersede chain, and the revoke/reissue action
 * zone (CRD-05, CRD-06) — `11-UI-SPEC.md` §7.4.
 *
 * `DetailLayout` stacked mode (a focused read-then-act screen, matching the grade-entry precedent
 * `10-UI-SPEC.md` §7.2.4 already established), one section. The banner — revoked wins over flagged
 * — is derived directly from `certificateDisplayStatus`'s single-value precedence order, so there
 * is no separate "which banner wins" branch to get wrong: at most one of the two conditions below
 * is ever true for a given certificate.
 *
 * "Issued by {actor}" is resolved from the certificate's own issuance `AuditEvent` row
 * (`getCertificateIssuer`, plan 11-15's addition to `certificate-service.ts`, gated by
 * `certificates.view` — never the GLOBAL-only `audit.view`) rather than a new `Certificate` column.
 * When no issuance row is resolvable, this renders the System wording rather than fabricating a
 * name — the same "never invent an identity" discipline `revokedByName` below also follows for
 * an unresolvable `revokedById`.
 *
 * The supersede chain renders one hop in each direction only (UI-SPEC §8's zero-one-many
 * resolution): the forward hop reads `supersedesId` straight off the loaded row; the reverse hop
 * (an unknown id — `supersedesId` is unique, so at most one row can point back) is resolved via
 * `certificateService.list({ where: { supersedesId } })` scoped through the SAME enrolment's
 * cohort scope `get` already proved the caller can reach. Both chain lookups are best-effort: a
 * failure there degrades to "no chain fact shown" rather than 404-ing the whole record, since the
 * award facts and the revoke/reissue actions are the page's core purpose, not the chain links.
 */
export const metadata = { title: "Certificate" };

export default async function CertificateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let certificate: CertificateRow | null;
  try {
    certificate = await certificateService.get(id);
  } catch (error) {
    if (error instanceof AuthenticationError || error instanceof AuthorizationError) notFound();
    throw error;
  }
  if (!certificate) notFound();

  const displayStatus = certificateDisplayStatus(certificate);

  let issuedByLabel = "System (automatic issuance)";
  try {
    const issuer = await getCertificateIssuer(id);
    if (issuer && issuer.actorId) {
      issuedByLabel = issuer.actorName ?? "Unknown";
    }
  } catch {
    // Best-effort — falls back to the System wording rather than fabricating a name.
  }

  let revokedByName: string | null = null;
  if (certificate.revokedById) {
    const names = await resolveActorNames([certificate.revokedById]);
    revokedByName = names.get(certificate.revokedById) ?? "Unknown";
  }

  let supersedes: { id: string; verificationRef: string } | null = null;
  let supersededBy: { id: string; verificationRef: string } | null = null;
  try {
    if (certificate.supersedesId) {
      const older = await certificateService.get(certificate.supersedesId);
      if (older) supersedes = { id: older.id, verificationRef: older.verificationRef };
    }
    const scope = await enrolmentCohortScope(certificate.enrolmentId);
    const newerRows = await certificateService.list({
      where: { supersedesId: certificate.id },
      scope,
    });
    if (newerRows[0]) {
      supersededBy = { id: newerRows[0].id, verificationRef: newerRows[0].verificationRef };
    }
  } catch {
    // Best-effort — the chain is a convenience link, not core to the record.
  }

  const facts = [
    {
      label: "Verification reference",
      value: <span className="break-all">{certificate.verificationRef}</span>,
      mono: true,
    },
    { label: "Awarded for", value: certificate.awardTitle },
    { label: "Issued", value: `${formatTimestamp(certificate.issuedAt)} by ${issuedByLabel}` },
    ...(supersedes
      ? [
          {
            label: "Supersedes",
            value: (
              <Link
                href={`/staff/certificates/issued/${supersedes.id}`}
                className="break-all text-accent underline underline-offset-2"
              >
                {supersedes.verificationRef}
              </Link>
            ),
          },
        ]
      : []),
    ...(supersededBy
      ? [
          {
            label: "Superseded by",
            value: (
              <Link
                href={`/staff/certificates/issued/${supersededBy.id}`}
                className="break-all text-accent underline underline-offset-2"
              >
                {supersededBy.verificationRef}
              </Link>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      {displayStatus === "revoked" && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-surface px-4 py-2 text-sm text-danger"
        >
          <Ban aria-hidden size={16} className="mt-0.5 shrink-0" />
          <span>
            Revoked {certificate.revokedAt ? formatTimestamp(certificate.revokedAt) : "—"} by{" "}
            {revokedByName ?? "Unknown"} — &ldquo;{certificate.revocationReason}&rdquo;
          </span>
        </div>
      )}
      {displayStatus === "flagged" && (
        <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-surface px-4 py-2 text-sm text-warning">
          <AlertTriangle aria-hidden size={16} className="mt-0.5 shrink-0" />
          <span>
            This certificate was flagged for review on{" "}
            {certificate.reviewFlaggedAt ? formatTimestamp(certificate.reviewFlaggedAt) : "—"}, following a
            correction to the learner&apos;s grade or attendance record. Confirm it should remain active, or
            revoke it.
          </span>
        </div>
      )}

      <DetailLayout
        mode="stacked"
        breadcrumbs={[
          { label: "Certificates", href: "/staff/certificates" },
          { label: "All certificates", href: "/staff/certificates/issued" },
          { label: `${certificate.learnerName}'s certificate` },
        ]}
        title={`${certificate.learnerName}'s certificate`}
        actions={<CertificateRecordActions certificateId={certificate.id} displayStatus={displayStatus} />}
        sections={[
          {
            id: "details",
            label: "Certificate details",
            content: <DetailFacts facts={facts} />,
          },
        ]}
      />
    </div>
  );
}
