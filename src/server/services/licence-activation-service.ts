/**
 * Licence activation transaction (Phase 14, plan 14-07; LIC-01, LIC-03, LIC-05,
 * LIC-06, D-13).
 *
 * `activateLicence` performs NO authorization: it receives an `actorId` and the
 * only caller is the permission-wrapped staff service (plan 14-15), enforced by
 * a guard test in plan 14-17. This module therefore imports nothing from
 * `next/*`, the permission layer or `getCurrentActor` (D-01 closure rule).
 *
 * Concurrency (LIC-05, Pattern 5): the transaction takes
 * `SELECT ... FOR UPDATE` on the singleton LicenceState row BEFORE reading
 * anything, so concurrent activations serialize and the loser sees the
 * winner's committed state. The state is then written by a version-guarded
 * UPDATE; a stale write (count 0) is reported as CONCURRENT_CHANGE and the
 * whole transaction, including the record insert, is rolled back by throwing a
 * sentinel. The LicenceRecord insert, the state update and the
 * `licence.activated` audit row commit or roll back together.
 *
 * Audit rows carry ids, closed codes and ISO dates only: never raw licence
 * text, a signature or a header (T-14-07-05). A rejection writes one
 * `licence.activation_rejected` row after the transaction ends (the
 * rejected transaction wrote nothing) and never echoes an unverified file's
 * identifiers.
 */

import { prisma } from "@/server/db";
import type { LicenceRejectionCode } from "@/server/licence/format";
import { deriveState } from "@/server/licence/state";
import { loadTrustSet, type TrustSet } from "@/server/licence/trust-set";
import type { LicenceStatusSnapshot } from "@/server/licence/types";
import {
  recordAudit,
  recordAuditInTransaction,
  type BusinessAuditEvent,
} from "./audit-service";
import {
  assessActivation,
  buildStatusSnapshot,
  computeDerived,
  LICENCE_STATE_ROW_ID,
  readActivationRows,
  readRows,
  type LicenceDbClient,
  type LicenceTxClient,
} from "./licence-service";

export type ActivateLicenceInput = {
  actorId: string;
  raw: string;
  correlationId?: string;
};

export type ActivateLicenceResult =
  | { ok: true; snapshot: LicenceStatusSnapshot }
  | { ok: false; code: LicenceRejectionCode | "CONCURRENT_CHANGE" };

export type LicenceActivationDeps = {
  db: LicenceDbClient;
  trustSet?: () => TrustSet;
  /** Audit sink used for a rejection, after the (empty) transaction ended. */
  audit: (event: BusinessAuditEvent) => Promise<void>;
  /** Audit sink used inside the activation transaction. */
  auditInTransaction: (tx: LicenceTxClient, event: BusinessAuditEvent) => Promise<void>;
  now?: () => Date;
};

/** Transaction timeout (ms): lock wait plus the verify, insert, update and audit. */
const ACTIVATION_TX_TIMEOUT_MS = 15_000;

/** Thrown inside the transaction to roll it back when the guarded update lost a race. */
class ConcurrentChangeSignal extends Error {
  constructor() {
    super("The licence state changed during activation.");
    this.name = "ConcurrentChangeSignal";
  }
}

type TxOutcome =
  | { kind: "ACTIVATED"; snapshot: LicenceStatusSnapshot }
  | { kind: "REJECTED"; code: LicenceRejectionCode };

/**
 * Takes the row lock on the singleton before anything is read. A missing
 * singleton is recreated (ON CONFLICT DO NOTHING) and locked.
 */
async function lockLicenceState(tx: LicenceTxClient): Promise<void> {
  const lock = () =>
    tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "LicenceState" WHERE "id" = 'current' FOR UPDATE`;
  const locked = await lock();
  if (locked.length > 0) return;
  await tx.$executeRaw`INSERT INTO "LicenceState" ("id", "highWaterAt", "updatedAt") VALUES ('current', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING`;
  await lock();
}

export function createLicenceActivationService(deps: LicenceActivationDeps) {
  const trustSet = deps.trustSet ?? (() => loadTrustSet());
  const now = deps.now ?? (() => new Date());

  async function activateLicence(input: ActivateLicenceInput): Promise<ActivateLicenceResult> {
    const at = now();
    const correlationId = input.correlationId ?? null;

    let outcome: TxOutcome;
    try {
      outcome = await deps.db.$transaction(
        async (tx): Promise<TxOutcome> => {
          await lockLicenceState(tx);

          const rows = await readActivationRows(tx);
          const assessment = assessActivation(rows, input.raw, at, trustSet);
          if (!assessment.ok) return { kind: "REJECTED", code: assessment.code };
          const licence = assessment.licence;

          const record = await tx.licenceRecord.create({
            data: {
              licenceId: licence.licenceId,
              raw: licence.raw,
              keyId: licence.keyId,
              schemaVersion: licence.schemaVersion,
              clientId: licence.clientId,
              issuedAt: licence.issuedAt,
              expiresAt: licence.expiresAt,
              graceEndsAt: licence.graceEndsAt,
              activatedAt: at,
              activatedById: input.actorId,
            },
          });

          const derived = deriveState({
            everActivated: true,
            record: { expiresAt: licence.expiresAt, graceEndsAt: licence.graceEndsAt },
            verification: { kind: "OK" },
            attentionSince: null,
            lastGoodRestricted: false,
            now: at,
          });

          const updated = await tx.licenceState.updateMany({
            where: { id: LICENCE_STATE_ROW_ID, version: rows.state.version },
            data: {
              activeRecordId: record.id,
              // A5: the first activation pins client.id; later ones must match it.
              registeredClientId: rows.state.registeredClientId ?? licence.clientId,
              everActivated: true,
              state: derived.state,
              restrictedAt: derived.restrictedAt,
              reasonCode: null,
              lastVerifiedAt: at,
              lastVerificationOutcome: "OK",
              lastGoodAt: at,
              attentionSince: null,
              version: { increment: 1 },
            },
          });
          // Stale write: roll the record insert back with it.
          if (updated.count === 0) throw new ConcurrentChangeSignal();

          await deps.auditInTransaction(tx, {
            actorId: input.actorId,
            action: "licence.activated",
            targetType: "LICENCE",
            targetId: licence.licenceId,
            scopeType: "GLOBAL",
            before: { state: rows.state.state, licenceId: rows.record?.licenceId ?? null },
            after: {
              state: derived.state,
              licenceId: licence.licenceId,
              keyId: licence.keyId,
              expiresAt: licence.expiresAt.toISOString(),
              graceEndsAt: licence.graceEndsAt.toISOString(),
            },
            outcome: "SUCCESS",
            correlationId,
          });

          // Read back what was committed and derive from it, exactly as any
          // other instance will (re-verifies the stored text).
          const fresh = await readRows(tx);
          return {
            kind: "ACTIVATED",
            snapshot: buildStatusSnapshot(fresh, computeDerived(fresh, at, trustSet), at),
          };
        },
        { timeout: ACTIVATION_TX_TIMEOUT_MS },
      );
    } catch (error) {
      if (!(error instanceof ConcurrentChangeSignal)) throw error;
      await recordRejection(input.actorId, "CONCURRENT_CHANGE", correlationId);
      return { ok: false, code: "CONCURRENT_CHANGE" };
    }

    if (outcome.kind === "REJECTED") {
      await recordRejection(input.actorId, outcome.code, correlationId);
      return { ok: false, code: outcome.code };
    }
    return { ok: true, snapshot: outcome.snapshot };
  }

  async function recordRejection(
    actorId: string,
    code: LicenceRejectionCode | "CONCURRENT_CHANGE",
    correlationId: string | null,
  ): Promise<void> {
    await deps.audit({
      actorId,
      action: "licence.activation_rejected",
      targetType: "LICENCE",
      // Never echo an unverified file's identifiers.
      targetId: null,
      scopeType: "GLOBAL",
      after: { code },
      outcome: "REJECTED",
      correlationId,
    });
  }

  return { activateLicence };
}

export type LicenceActivationService = ReturnType<typeof createLicenceActivationService>;

export const licenceActivationService: LicenceActivationService = createLicenceActivationService({
  db: prisma,
  audit: recordAudit,
  auditInTransaction: recordAuditInTransaction,
});
