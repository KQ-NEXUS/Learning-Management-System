"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { BTN, NOTE_DANGER } from "@/components/primitives/controls";
import { DIAGNOSTIC_BUTTON_LABEL, DIAGNOSTIC_ERROR_MESSAGE } from "@/server/licence/policy";

/**
 * Download control for the licence diagnostic report (Phase 14, plan 14-15;
 * LIC-02, D-14, 14-UI-SPEC "Data and diagnostics"). Fetches the route, saves the
 * response as a file and reports a failure with the fixed message. It is never
 * disabled by licence state (the diagnostic stays available in restricted
 * continuity mode); it is only inert while its own request is in flight, so one
 * click is one audited download. The helper sentence is rendered by
 * `LicenceStatusView` beside this control.
 */

const ENDPOINT = "/api/staff/licence/diagnostic";
const FALLBACK_FILENAME = "licence-diagnostic.json";

/** The attachment name from Content-Disposition, only when it is a plain safe file name. */
function filenameFrom(header: string | null): string {
  const match = header ? /filename="([A-Za-z0-9._-]+)"/.exec(header) : null;
  return match ? match[1] : FALLBACK_FILENAME;
}

export function DiagnosticDownloadButton() {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function onDownload() {
    if (pending) return;
    setPending(true);
    setFailed(false);
    try {
      const response = await fetch(ENDPOINT, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error("not ok");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filenameFrom(response.headers.get("Content-Disposition"));
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <button type="button" className={`${BTN} self-start`} disabled={pending} aria-busy={pending} onClick={onDownload}>
        <Download aria-hidden className="mr-2 size-4" />
        {DIAGNOSTIC_BUTTON_LABEL}
      </button>
      {failed && (
        <p role="alert" className={NOTE_DANGER}>
          {DIAGNOSTIC_ERROR_MESSAGE}
        </p>
      )}
    </div>
  );
}
