/**
 * Permission-wrapped staff façade over the licence service (Phase 14, plans
 * 14-10 and 14-15; LIC-02, LIC-03, LIC-06, T-14-10-01, T-14-15-01).
 *
 * `getStatusForStaff` is the read the Licence & System Status page makes. It is
 * gated on `licence.view` with an empty `ResourceScope` (Global only), so
 * authorization runs BEFORE the licence is read: an actor without the permission
 * gets the same `AuthorizationError` whatever state the licence is in, and no
 * licence field is ever loaded for them (no state oracle). Viewing is not audited
 * (PRD 18.4); the denial audit is `withPermission`'s own.
 *
 * `inspectLicenceForStaff` and `activateLicenceForStaff` are gated on
 * `licence.activate` (Global only) and declared with the explicit option
 * `{ licence: "continuity" }`: activation is the recovery route out of restricted
 * continuity mode and must never be blockable by the licence guard (D-07, D-14,
 * OQ3). The activation service performs no authorization of its own; this
 * façade is its only permitted caller and passes the authorized actor id.
 *
 * `getDiagnosticForStaff` is gated on `licence.view` and audits every download
 * as `licence.diagnostic_downloaded` with the actor (LIC-06). The audit row
 * carries the licence id only, never any report content.
 *
 * The status snapshot and the diagnostic report are the allow-listed DTOs from
 * plans 14-04 and 14-09: neither carries raw licence text or signing material.
 */

import { withPermission as liveWithPermission } from "@/server/permissions";
import type { createWithPermission } from "@/server/permissions/with-permission";
import type { LicenceStatusSnapshot } from "@/server/licence/types";
import { recordAudit, type BusinessAuditEvent } from "./audit-service";
import { licenceActivationService, type ActivateLicenceInput, type ActivateLicenceResult } from "./licence-activation-service";
import { licenceService, type DiagnosticReport, type InspectResult } from "./licence-service";

type WithPermission = ReturnType<typeof createWithPermission>;

export interface LicenceStaffServiceDeps {
  withPermission: WithPermission;
  licence: {
    getStatusSnapshot(): Promise<LicenceStatusSnapshot>;
    inspect(raw: string): Promise<InspectResult>;
    buildDiagnosticReport(): Promise<DiagnosticReport>;
  };
  activation: { activateLicence(input: ActivateLicenceInput): Promise<ActivateLicenceResult> };
  audit: (event: BusinessAuditEvent) => Promise<void>;
}

export type InspectLicenceForStaffInput = { raw: string };
export type ActivateLicenceForStaffInput = { raw: string; correlationId?: string };

const ACTIVATION_OPTIONS = {
  licence: "continuity",
  reason: "Licence activation is the recovery route and is never blockable (D-07)",
} as const;

export function createLicenceStaffService(deps: LicenceStaffServiceDeps) {
  const getStatusForStaffInternal = deps.withPermission("licence.view", () => ({}))(async () =>
    deps.licence.getStatusSnapshot(),
  );

  const inspectInternal = deps.withPermission<InspectLicenceForStaffInput>(
    "licence.activate",
    () => ({}),
    ACTIVATION_OPTIONS,
  )(async (input) => deps.licence.inspect(input.raw));

  const activateInternal = deps.withPermission<ActivateLicenceForStaffInput>(
    "licence.activate",
    () => ({}),
    ACTIVATION_OPTIONS,
  )(async (input, ctx) =>
    deps.activation.activateLicence({
      actorId: ctx.actor.userId,
      raw: input.raw,
      correlationId: input.correlationId,
    }),
  );

  const getDiagnosticInternal = deps.withPermission("licence.view", () => ({}))(async (_input, ctx) => {
    const report = await deps.licence.buildDiagnosticReport();
    // LIC-06: no download without evidence. A failed audit write fails the request.
    await deps.audit({
      actorId: ctx.actor.userId,
      action: "licence.diagnostic_downloaded",
      targetType: "LICENCE",
      targetId: report.licenceId,
      scopeType: "GLOBAL",
      outcome: "SUCCESS",
    });
    return report;
  });

  return {
    /** The shared licence status for a holder of `licence.view` at Global scope. */
    async getStatusForStaff(): Promise<LicenceStatusSnapshot> {
      return getStatusForStaffInternal(undefined);
    },

    /** Verifies submitted text and returns a preview; persists nothing (licence.activate). */
    async inspectLicenceForStaff(input: InspectLicenceForStaffInput): Promise<InspectResult> {
      return inspectInternal(input);
    },

    /** Re-verifies the submitted text inside the locked activation transaction (licence.activate). */
    async activateLicenceForStaff(input: ActivateLicenceForStaffInput): Promise<ActivateLicenceResult> {
      return activateInternal(input);
    },

    /** The allow-listed diagnostic report, audited per download (licence.view). */
    async getDiagnosticForStaff(): Promise<DiagnosticReport> {
      return getDiagnosticInternal(undefined);
    },
  };
}

export type LicenceStaffService = ReturnType<typeof createLicenceStaffService>;

export const licenceStaffService: LicenceStaffService = createLicenceStaffService({
  withPermission: liveWithPermission,
  licence: licenceService,
  activation: licenceActivationService,
  audit: recordAudit,
});
