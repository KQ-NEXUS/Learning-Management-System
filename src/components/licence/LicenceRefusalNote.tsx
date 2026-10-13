import { Lock } from "lucide-react";
import {
  LICENCE_REFUSAL_MESSAGE,
  RESTRICTED_CONTROL_REASON_ADMIN,
  RESTRICTED_CONTROL_REASON_STAFF,
} from "@/server/licence/policy";

/**
 * The two licence-restriction notes of the staff UI mirror (Phase 14, plan 14-19; D-09,
 * UI-SPEC "Restricted-state UI mirror"). Both are presentational and hook-free.
 *
 * `LicenceRefusalNote` renders a server refusal (`LICENCE_REFUSAL_MESSAGE`) as a calm
 * warning, never as a danger note: the user did nothing wrong, and it must not be confused
 * with a role denial (T-14-19-05).
 *
 * `RestrictedControlReason` is the visible line paired with a disabled write control and
 * referenced by its `aria-describedby`; a tooltip alone is not acceptable. Which sentence
 * shows depends on whether the viewer can open the Licence screen, so staff without
 * licence.view learn nothing about the licence itself (T-14-19-01).
 */

export function LicenceRefusalNote({ message = LICENCE_REFUSAL_MESSAGE }: { message?: string }) {
  return (
    <p
      role="status"
      className="flex items-start gap-2 border-l-2 border-warning bg-warning-surface px-4 py-2 text-sm text-foreground"
    >
      <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">{message}</span>
    </p>
  );
}

export function RestrictedControlReason({ id, canViewLicence }: { id: string; canViewLicence: boolean }) {
  return (
    <p id={id} className="flex items-start gap-2 text-sm text-muted-foreground">
      <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">
        {canViewLicence ? RESTRICTED_CONTROL_REASON_ADMIN : RESTRICTED_CONTROL_REASON_STAFF}
      </span>
    </p>
  );
}
