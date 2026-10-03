import { SessionEnded } from "@/components/shell/SessionEnded";
import { LOAD_ERROR_MESSAGE } from "@/server/licence/policy";
import { buildLicenceStatusView } from "@/server/licence/view-model";
import { AuthenticationError, AuthorizationError, can } from "@/server/permissions";
import { licenceStaffService } from "@/server/services/licence-staff-service";
import { ActivateLicenceForm } from "./ActivateLicenceForm";
import { DiagnosticDownloadButton } from "./DiagnosticDownloadButton";
import { LicenceStatusView } from "./LicenceStatusView";

export const metadata = { title: "Licence" };

/**
 * Licence & System Status (Phase 14, plan 14-10; LIC-02, D-14).
 *
 * Authorization runs inside `getStatusForStaff` before the licence is read, so a
 * viewer without `licence.view` gets the same denied state whatever the licence
 * state is (no state oracle, T-14-10-03). Any other failure renders fixed copy,
 * never `error.message` or a stack trace (T-14-10-02). The page imports no Prisma
 * and no raw licence text: it renders the allow-listed snapshot through the view
 * model. The activation panel (holders of `licence.activate`, plan 14-15) is
 * passed through `activationSlot`; the server actions behind it authorize again,
 * so the slot is a courtesy, not the gate (T-14-15-01). The diagnostic download
 * (`diagnosticSlot`) is shown to every viewer of the page, who all hold
 * `licence.view`; the route enforces that permission itself and audits each download.
 */
export default async function LicencePage() {
  let snapshot: Awaited<ReturnType<typeof licenceStaffService.getStatusForStaff>>;
  let canActivate = false;
  let canViewReports = false;

  try {
    snapshot = await licenceStaffService.getStatusForStaff();
    canActivate = await can("licence.activate", {});
    canViewReports = await can("reports.view", {});
  } catch (error) {
    if (error instanceof AuthenticationError) return <SessionEnded />;
    if (error instanceof AuthorizationError) {
      return <LicenceStatusView canActivate={false} state={{ status: "denied", permission: "licence.view" }} />;
    }
    return <LicenceStatusView canActivate={false} state={{ status: "error", message: LOAD_ERROR_MESSAGE }} />;
  }

  const vm = buildLicenceStatusView(snapshot, { canActivate, canViewReports, now: new Date() });
  return (
    <LicenceStatusView
      vm={vm}
      canActivate={canActivate}
      activationSlot={canActivate ? <ActivateLicenceForm /> : undefined}
      diagnosticSlot={<DiagnosticDownloadButton />}
    />
  );
}
