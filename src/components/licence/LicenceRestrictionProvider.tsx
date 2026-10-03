"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Licence restriction context (Phase 14, plan 14-19; D-09, UI-SPEC "Restricted-state UI mirror").
 *
 * The staff layout computes this once per full render and `StaffShell` provides it
 * to `ResourceForm` and `ConfirmModal`, which disable write controls in restricted
 * continuity mode. It is a courtesy mirror only: the server guard from plan 14-11
 * is the control, so a wrong value here can mislead a user but never grant access.
 *
 * The default is unrestricted so learner shells, public pages and any test that
 * mounts no provider behave exactly as before (and show no licence text).
 */

export type LicenceRestrictionValue = {
  /** True while the deployment is in restricted continuity mode (write controls mirror the server refusal). */
  restricted: boolean;
  /** True for holders of licence.view: selects the "Open Licence" reason variant. */
  canViewLicence: boolean;
  /** The state label, only ever set for holders of licence.view. */
  stateLabel: string | null;
};

export const UNRESTRICTED_LICENCE_RESTRICTION: LicenceRestrictionValue = {
  restricted: false,
  canViewLicence: false,
  stateLabel: null,
};

const LicenceRestrictionContext = createContext<LicenceRestrictionValue>(UNRESTRICTED_LICENCE_RESTRICTION);

export function LicenceRestrictionProvider({
  value,
  children,
}: {
  value: LicenceRestrictionValue;
  children: ReactNode;
}) {
  return <LicenceRestrictionContext.Provider value={value}>{children}</LicenceRestrictionContext.Provider>;
}

export function useLicenceRestriction(): LicenceRestrictionValue {
  return useContext(LicenceRestrictionContext);
}
