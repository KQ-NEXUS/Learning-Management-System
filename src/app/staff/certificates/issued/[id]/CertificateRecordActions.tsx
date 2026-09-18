"use client";

/**
 * The certificate detail page's action zone (CRD-05) — `11-UI-SPEC.md` §0.4, §7.4.
 *
 * Four states, driven entirely by `certificateDisplayStatus`'s single value:
 *   - Active, unflagged / Active, flagged → "Revoke certificate" only (the flagged banner on the
 *     page itself carries the framing — no separate action for it, UI-SPEC §7.4).
 *   - Revoked → "Reissue certificate" only.
 *   - Superseded → nothing — a read-only historical record.
 *
 * The reissue icon is deliberately distinct from Phase 10's grade-override icon — different icon,
 * different concept: issuing a new credential version, not correcting a value in place. Revoke
 * opens `ConfirmModal` `tone="danger"`; reissue opens it `tone="default"` — both
 * `minReasonLength={10}` (§0.4's asymmetric-tone rationale: revocation is an externally visible,
 * immediate status flip; reissue is additive, a new credential alongside a preserved old one).
 *
 * On a successful reissue, navigation moves to the NEW certificate's detail page — the new
 * credential is now the record of record, not the just-superseded one this component was mounted
 * under.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, RefreshCw } from "lucide-react";
import { ConfirmModal } from "@/components/primitives";
import type { CertificateDisplayStatus } from "@/lib/certificate-display-status";
import { revokeCertificateAction, reissueCertificateAction } from "./certificate-record-actions";

export type CertificateRecordActionsProps = {
  certificateId: string;
  displayStatus: CertificateDisplayStatus;
  revoke?: typeof revokeCertificateAction;
  reissue?: typeof reissueCertificateAction;
};

const BTN_DANGER =
  "inline-flex items-center gap-2 rounded-md border border-danger/40 bg-surface px-4 py-2 text-sm font-semibold text-danger hover:bg-danger-surface disabled:cursor-not-allowed disabled:opacity-50";
const BTN_ACCENT =
  "inline-flex items-center gap-2 rounded-md border border-accent/40 bg-surface px-4 py-2 text-sm font-semibold text-accent hover:bg-accent/5 disabled:cursor-not-allowed disabled:opacity-50";

export function CertificateRecordActions({
  certificateId,
  displayStatus,
  revoke = revokeCertificateAction,
  reissue = reissueCertificateAction,
}: CertificateRecordActionsProps) {
  const router = useRouter();
  const [open, setOpen] = useState<"revoke" | "reissue" | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function confirmRevoke(reason: string) {
    startTransition(async () => {
      const result = await revoke({ certificateId, reason });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setOpen(null);
      router.refresh();
    });
  }

  function confirmReissue(reason: string) {
    startTransition(async () => {
      const result = await reissue({ certificateId, reason });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setOpen(null);
      router.push(`/staff/certificates/issued/${result.certificateId}`);
    });
  }

  // Superseded — a read-only historical record, no actions at all.
  if (displayStatus === "superseded") return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {displayStatus === "revoked" ? (
        <button
          type="button"
          className={BTN_ACCENT}
          onClick={() => {
            setError(null);
            setOpen("reissue");
          }}
        >
          <RefreshCw aria-hidden size={16} />
          Reissue certificate
        </button>
      ) : (
        <button
          type="button"
          className={BTN_DANGER}
          onClick={() => {
            setError(null);
            setOpen("revoke");
          }}
        >
          <Ban aria-hidden size={16} />
          Revoke certificate
        </button>
      )}

      <ConfirmModal
        open={open === "revoke"}
        tone="danger"
        title="Revoke certificate"
        confirmLabel="Revoke certificate"
        minReasonLength={10}
        pending={pending}
        error={error}
        description="This certificate's public verification status will immediately show as revoked. This action requires a reason and is recorded in the audit history."
        onConfirm={confirmRevoke}
        onCancel={() => {
          if (!pending) setOpen(null);
        }}
      />
      <ConfirmModal
        open={open === "reissue"}
        tone="default"
        title="Reissue certificate"
        confirmLabel="Reissue certificate"
        minReasonLength={10}
        pending={pending}
        error={error}
        description="A new certificate will be generated and linked to this one. The original stays on record as superseded. This action requires a reason and is recorded in the audit history."
        onConfirm={confirmReissue}
        onCancel={() => {
          if (!pending) setOpen(null);
        }}
      />
    </div>
  );
}
