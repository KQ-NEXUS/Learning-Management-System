"use client";

import { useState, useTransition } from "react";
import { ResourceTable } from "@/components/primitives/ResourceTable";
import { ConfirmModal } from "@/components/primitives/ConfirmModal";
import { formatTimestamp } from "@/lib/format-timestamp";
import type { PendingIssuanceRow } from "@/server/services/certificate-service";
import { issueCertificateAction } from "./certificate-actions";

/**
 * The pending-issuance queue table (D-04, UI-SPEC §7.1).
 *
 * Deliberately leaves `ResourceTable`'s bulk-checkbox prop unwired — a per-row action only, no
 * batch capability (UI-SPEC §0.4: no requirement asks for issuing many at once, and wiring it up
 * would invent an unrequested capability). Local `rows` state removes an issued row from view
 * immediately on confirm, matching the "an issued row leaves the queue immediately" must-have —
 * `revalidatePath` in the server action keeps the next full navigation in sync too.
 */
type Props = { rows: PendingIssuanceRow[]; onIssue?: typeof issueCertificateAction };

export function CertificateQueueTable({ rows: initialRows, onIssue = issueCertificateAction }: Props) {
  const [rows, setRows] = useState(initialRows);
  const [target, setTarget] = useState<PendingIssuanceRow | null>(null);
  const [pending, transition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  function confirmIssue() {
    if (!target) return;
    const row = target;
    transition(async () => {
      try {
        const result = await onIssue({ enrolmentId: row.enrolmentId, scope: row.scope });
        if (!result.ok) {
          setError(result.message);
          return;
        }
        setRows((prev) => prev.filter((r) => r.enrolmentId !== row.enrolmentId || r.scope !== row.scope));
        setTarget(null);
        setNotice(`Certificate issued for ${row.learnerName}.`);
      } catch {
        setError("This certificate could not be issued. Reload the queue and try again.");
      }
    });
  }

  return (
    <>
      <ResourceTable
        asPage
        noun="certificates awaiting issuance"
        columns={[
          { key: "learner", header: "Learner", render: (row) => row.learnerName },
          {
            key: "award",
            header: "Award",
            render: (row) => row.awardTitle,
            subtitle: (row) => row.awardType,
          },
          {
            key: "eligibleSince",
            header: "Eligible since",
            mono: true,
            render: (row) => formatTimestamp(row.eligibleSince),
          },
          {
            key: "action",
            header: "",
            render: (row) => (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setTarget(row);
                }}
                className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast hover:bg-accent-deep"
              >
                Issue certificate
              </button>
            ),
          },
        ]}
        state={
          rows.length
            ? { status: "ready", rows }
            : { status: "empty", activeFilterCount: 0 }
        }
        getRowKey={(row) => `${row.enrolmentId}:${row.scope}`}
        getRowLabel={(row) => row.learnerName}
        emptyHeading="Nothing awaiting issuance"
        emptyBody="Certificates will appear here once a learner completes a course or programme under manual issuance."
      />
      {notice && (
        <p role="status" className="mt-2 text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      <ConfirmModal
        open={target !== null}
        tone="default"
        title="Issue this certificate?"
        confirmLabel="Issue certificate"
        description={
          target
            ? `${target.learnerName} will be marked complete for ${target.awardTitle} and can download their certificate immediately.`
            : ""
        }
        pending={pending}
        error={error}
        onConfirm={confirmIssue}
        onCancel={() => setTarget(null)}
      />
    </>
  );
}
