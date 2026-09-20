import { AlertTriangle, Download } from "lucide-react";
import type { CertificateColumn } from "@/server/services/enrolment-dashboard-service";

/**
 * CertificateSlot — Phase 9's `CERTIFICATE_DEFERRED` dashboard card, filled
 * (plan 11-13 Task 3, UI-SPEC §7.6/§6.1).
 *
 * Five rendered branches (plus one that renders nothing), first match wins,
 * copy used VERBATIM from §6.1 — these strings were written deliberately
 * (the flagged branch is reassuring rather than alarming because a learner
 * cannot act on a flag; the revoked branch directs to support) and must never
 * be paraphrased:
 *
 *   0. `not-applicable` — WR-06: the award issues no certificate
 *      (`certificateEnabled` false, no certificate row). Renders nothing.
 *   1. `not-complete` — a normal card: "Your certificate will appear here
 *      once you have completed all requirements." (WR-06 replaced Phase 9's
 *      false "coming later" named-gap copy.)
 *   2. `pending-issuance` — "being finalized" copy, no action.
 *   3. `issued` — a `Download` icon link plus the verification reference,
 *      mono and `break-all` so a learner can read it off the screen.
 *   4. `flagged` — `AlertTriangle` + reassuring copy, but the download link
 *      is STILL rendered (a flag never withdraws already-earned access,
 *      UI-SPEC §7.6 branch 4 — only revocation does).
 *   5. `revoked` — revoked copy, no download link, no reference.
 *
 * The download link is a plain, unconfirmed link (UI-SPEC §7.6 branch 3) —
 * downloading one's own certificate is neither destructive nor
 * consequential, unlike `/staff/certificates/issued/[id]`'s revoke/reissue
 * actions.
 */

export type CertificateSlotProps = { certificate: CertificateColumn };

const CARD = "flex flex-col gap-2 border-b border-border py-4";
const TITLE = "sr-only";
const BODY = "text-sm text-muted-foreground";

function CertificateReference({ verificationRef }: { verificationRef: string }) {
  return (
    <p className="break-all font-mono text-sm font-semibold text-foreground">{verificationRef}</p>
  );
}

function DownloadLink({ certificateId }: { certificateId: string }) {
  return (
    <a
      href={`/api/certificates/${certificateId}/download`}
      className="inline-flex w-fit items-center gap-2 text-xs font-semibold text-accent underline underline-offset-2"
    >
      <Download aria-hidden size={14} />
      Download certificate
    </a>
  );
}

export function CertificateSlot({ certificate }: CertificateSlotProps) {
  // WR-06: an award that issues no certificate shows nothing at all.
  if (certificate.kind === "not-applicable") return null;

  if (certificate.kind === "not-complete") {
    return (
      <div className={CARD}>
        <p className={TITLE}>Certificate</p>
        <p className={BODY}>Your certificate will appear here once you have completed all requirements.</p>
      </div>
    );
  }

  if (certificate.kind === "pending-issuance") {
    return (
      <div className={CARD}>
        <p className={TITLE}>Certificate</p>
        <p className={BODY}>Your certificate is being finalized by your instructor.</p>
      </div>
    );
  }

  if (certificate.kind === "revoked") {
    return (
      <div className={CARD}>
        <p className={TITLE}>Certificate</p>
        <p className={BODY}>
          Your certificate for this course/programme has been revoked. Contact support for details.
        </p>
      </div>
    );
  }

  // "issued" and "flagged" both carry certificateId/verificationRef/issuedAt
  // and both render the download link.
  return (
    <div className={CARD}>
      <p className={TITLE}>Certificate</p>
      {certificate.kind === "flagged" && (
        <p className={`inline-flex items-start gap-2 ${BODY}`}>
          <AlertTriangle aria-hidden size={14} className="mt-0.5 shrink-0 text-warning" />
          Your certificate is under review following a recent correction. This won&apos;t affect your
          completed work.
        </p>
      )}
      <DownloadLink certificateId={certificate.certificateId} />
      <CertificateReference verificationRef={certificate.verificationRef} />
    </div>
  );
}
