"use client";

import { useId, useState, useTransition } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { ConfirmModal } from "@/components/primitives/ConfirmModal";
import { StatusPill } from "@/components/primitives/ResourceTable";
import { BTN, BTN_PRIMARY, NOTE_SUCCESS } from "@/components/primitives/controls";
import { LagosTime } from "@/components/time/LagosTime";
import { requestLearnerExportAction } from "../actions";

/**
 * The "Export data" section of a learner's privacy record (plan 15-22, UI-SPEC S3).
 *
 * Prepares one learner's data file through the existing export pipeline and
 * shows the state of this staff member's latest export for them, using the job
 * status words from Export History. The confirmation is a ConfirmModal with a
 * required reason; it is `licenceEffect="continuity"` because the server treats
 * a learner data export as permitted data access in restricted mode (LIC-08).
 *
 * Nothing here is a security control: `requestLearnerExportAction` re-checks the
 * permission, the learner and the reason on every call.
 */

export type ExportSectionStatus = {
  state: "none" | "queued" | "processing" | "succeeded" | "failed" | "expired";
  /** ISO 8601, set while a finished file can still be downloaded. */
  expiresAt: string | null;
  canDownload: boolean;
  downloadPath: string | null;
  /** True while a request is Queued or Processing. */
  inFlight: boolean;
};

const DISABLED_REASON = "An export for this learner is already being prepared.";

export function ExportSection({
  userId,
  learnerName,
  exportStatus,
}: {
  userId: string;
  learnerName: string;
  exportStatus: ExportSectionStatus;
}) {
  const router = useRouter();
  const reasonId = useId();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requested, setRequested] = useState(false);
  const [pending, startRequest] = useTransition();
  const [checking, startCheck] = useTransition();

  const { state, inFlight } = exportStatus;
  const finished = state === "succeeded" || state === "failed" || state === "expired";

  function confirm(reason: string) {
    startRequest(async () => {
      try {
        const result = await requestLearnerExportAction({ userId, reason });
        if (!result.ok) {
          setError(result.message);
          return;
        }
        setError(null);
        setOpen(false);
        setRequested(true);
        router.refresh();
      } catch (caught) {
        // Framework control flow (a redirect or not-found thrown by the action) must pass through.
        unstable_rethrow(caught);
        setError("The export was not requested. Try again; if it fails again, contact an administrator.");
      }
    });
  }

  function openModal() {
    setError(null);
    setOpen(true);
  }

  return (
    <section aria-labelledby="export-data-heading" className="flex flex-col gap-4">
      <h2
        id="export-data-heading"
        className="text-[20px] leading-[1.2] font-semibold tracking-[-0.015em] text-foreground"
      >
        Export data
      </h2>
      <p className="text-sm text-foreground">
        Prepares one file with this learner&apos;s profile, enrolments, orders and payments, attendance, submissions,
        grades, certificates, support requests and consent records. Passwords, security tokens, staff-only notes and
        other people&apos;s data are left out.
      </p>

      {(state === "queued" || state === "processing") && (
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill label="Being prepared" tone="accent" />
        </div>
      )}
      {state === "succeeded" && (
        <div className="flex flex-col gap-2 text-sm">
          <StatusPill label="Ready" tone="success" />
          {exportStatus.expiresAt && (
            <p className="text-[13px] text-muted-foreground">
              Available until <LagosTime value={exportStatus.expiresAt} className="font-mono" />
            </p>
          )}
          {exportStatus.canDownload && exportStatus.downloadPath && (
            <a
              href={exportStatus.downloadPath}
              className="inline-block w-fit py-1 font-semibold text-accent hover:underline"
            >
              Download data file
            </a>
          )}
        </div>
      )}
      {state === "failed" && (
        <div className="flex flex-col items-start gap-2 text-sm">
          <StatusPill label="Failed" tone="danger" />
          <p className="text-foreground">The export failed. No file was created.</p>
          <button type="button" onClick={openModal} disabled={pending} className={BTN}>
            Retry export
          </button>
        </div>
      )}
      {state === "expired" && (
        <div className="flex flex-col gap-2 text-sm">
          <StatusPill label="Expired" tone="neutral" />
          <p className="text-foreground">This file has expired. Prepare a new export if you still need it.</p>
        </div>
      )}

      {requested && !finished && (
        <div className="flex flex-wrap items-center gap-4">
          <p role="status" className={NOTE_SUCCESS}>
            Export requested. It usually takes under a minute.
          </p>
          <button
            type="button"
            onClick={() => startCheck(() => router.refresh())}
            disabled={checking}
            className={BTN}
          >
            Check export status
          </button>
        </div>
      )}

      <div className="flex flex-col items-start gap-2">
        <button
          type="button"
          onClick={openModal}
          disabled={inFlight}
          aria-describedby={inFlight ? reasonId : undefined}
          className={BTN_PRIMARY}
        >
          Prepare data export
        </button>
        {inFlight && (
          <p id={reasonId} className="text-[13px] text-muted-foreground">
            {DISABLED_REASON}
          </p>
        )}
      </div>

      <ConfirmModal
        open={open}
        licenceEffect="continuity"
        eyebrow="Audited action"
        tone="default"
        title="Export this learner's data?"
        description={`This prepares one file containing ${learnerName}'s personal data. Your name and reason are recorded in the audit log, and the file can only be downloaded for a limited time.`}
        reasonLabel="Reason (for example, the learner's request reference)"
        minReasonLength={10}
        confirmLabel="Prepare export"
        pending={pending}
        error={error}
        onConfirm={confirm}
        onCancel={() => {
          setOpen(false);
          setError(null);
        }}
      />
    </section>
  );
}
