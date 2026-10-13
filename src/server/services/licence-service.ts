/**
 * Licence service: database-backed status snapshot, deployment identity and
 * activation assessment (Phase 14, plan 14-07; LIC-01, LIC-03, D-13).
 *
 * Closure rule (D-01): this module is reachable from the webhook, scheduled
 * task and startup closures, so it imports nothing from `next/*`, the
 * permission layer or `getCurrentActor`. The actor, where one exists, is an
 * argument to the activation service.
 *
 * State lives in the database (D-13): the active licence and its derived
 * state are read from the singleton `LicenceState` row and its
 * `LicenceRecord` on every call. There is no per-process cache, so every
 * function instance sees the same state. Derivation re-verifies the stored raw
 * text with `verifyLicence` in runtime mode on every read (Pattern 4), so an
 * edit of the stored text or the denormalised date columns cannot change the
 * outcome: dates come from the signed payload, never from the columns.
 *
 * `getStatusSnapshot` and `inspect` perform no write beyond recreating a
 * missing singleton row (INSERT ... ON CONFLICT DO NOTHING, only when the row
 * is absent).
 *
 * Plan 14-09 adds the evaluating and enforcing half to the same object:
 * `checkWriteGate` / `assertWriteAllowed` (per-write decision, no allow-path
 * write, no cached decision beyond the last-known-good record used only when
 * the database read itself fails), `getRestrictionCutoff`, `evaluateAndRecord`
 * (version-guarded compare-and-swap transitions, exactly one audit winner) and
 * `buildDiagnosticReport` (field-by-field allow-list).
 */

import type { LicenceRecord, LicenceState, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import {
  createClockMonitor,
  detectRollback,
  shouldAdvanceHighWater,
  utcHourBucket,
} from "@/server/licence/clock";
import { SKEW_TOLERANCE_MS, UNAVAILABLE_WINDOW_MS } from "@/server/licence/constants";
import { LicenceUnavailableError, LicenceWriteBlockedError } from "@/server/licence/errors";
import type { LicenceRejectionCode } from "@/server/licence/format";
import {
  deriveState,
  dueNoticeKeys,
  type DerivedState,
  type LicenceVerification,
} from "@/server/licence/state";
import { loadTrustSet, type TrustSet } from "@/server/licence/trust-set";
import {
  type LicenceStateName,
  type LicenceStatusSnapshot,
  type LicenceVerificationOutcome,
} from "@/server/licence/types";
import { verifyLicence, type VerifiedLicence } from "@/server/licence/verify";
import { recordAudit, recordAuditInTransaction, type BusinessAuditEvent } from "./audit-service";

/** The structural subset of PrismaClient the licence services use. */
export type LicenceDbClient = Pick<
  PrismaClient,
  "licenceState" | "licenceRecord" | "deploymentIdentity" | "$transaction" | "$queryRaw" | "$executeRaw"
>;

/** The reads and the singleton self-heal; satisfied by both the client and a transaction client. */
export type LicenceReadClient = Pick<
  Prisma.TransactionClient,
  "licenceState" | "licenceRecord" | "deploymentIdentity" | "$executeRaw"
>;

/** The transaction client the activation transaction uses (adds the lock query and the audit sink). */
export type LicenceTxClient = Pick<
  Prisma.TransactionClient,
  | "licenceState"
  | "licenceRecord"
  | "deploymentIdentity"
  | "$executeRaw"
  | "$queryRaw"
  | "auditEvent"
>;

export const LICENCE_STATE_ROW_ID = "current";
export const DEPLOYMENT_IDENTITY_ROW_ID = "deployment";

export type LicenceRows = {
  state: LicenceState;
  record: LicenceRecord | null;
  deploymentId: string;
};

/** Rows plus the (tiny, append-only) register history used for the anti-replay rule (A7). */
export type ActivationRows = LicenceRows & {
  history: Array<{ id: string; licenceId: string; issuedAt: Date }>;
};

export type TrustSetSource = TrustSet | (() => TrustSet);

/** The derived state plus the verification outcome and the verified payload it came from. */
export type LicenceEvaluation = DerivedState & {
  verification: LicenceVerification;
  /** The verified payload; null when nothing is stored or verification did not succeed. */
  verified: VerifiedLicence | null;
};

export type LicencePreview = {
  licenceId: string;
  clientName: string;
  deploymentId: string;
  issuedAt: Date;
  notBefore: Date;
  expiresAt: Date;
  graceEndsAt: Date;
  timeZone: string;
  replaces: { licenceId: string; expiresAt: Date } | null;
};

export type InspectResult =
  | { ok: true; preview: LicencePreview }
  | { ok: false; code: LicenceRejectionCode };

export type ActivationAssessment =
  | { ok: true; licence: VerifiedLicence; preview: LicencePreview }
  | { ok: false; code: LicenceRejectionCode };

// ---------------------------------------------------------------------------
// Singleton rows
// ---------------------------------------------------------------------------

/**
 * Returns the seeded deployment identifier, recreating the singleton row when
 * it is missing (INSERT ... ON CONFLICT DO NOTHING, so two instances racing to
 * heal it converge on one row). The insert runs only when the row is absent,
 * so the ordinary read path never writes.
 */
export async function ensureDeployment(client: LicenceReadClient): Promise<string> {
  const existing = await client.deploymentIdentity.findUnique({
    where: { id: DEPLOYMENT_IDENTITY_ROW_ID },
  });
  if (existing) return existing.deploymentId;
  await client.$executeRaw`INSERT INTO "DeploymentIdentity" ("id") VALUES ('deployment') ON CONFLICT DO NOTHING`;
  const created = await client.deploymentIdentity.findUnique({
    where: { id: DEPLOYMENT_IDENTITY_ROW_ID },
  });
  if (!created) throw new LicenceUnavailableError("Deployment identity could not be created.");
  return created.deploymentId;
}

/** Recreates the LicenceState singleton with its OQ1 defaults when it is missing. */
export async function ensureLicenceStateRow(client: LicenceReadClient): Promise<void> {
  const existing = await client.licenceState.findUnique({
    where: { id: LICENCE_STATE_ROW_ID },
    select: { id: true },
  });
  if (existing) return;
  await client.$executeRaw`INSERT INTO "LicenceState" ("id", "highWaterAt", "updatedAt") VALUES ('current', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING`;
}

/**
 * Reads the singleton state, its active record and the deployment identity,
 * self-healing a missing singleton (D-13). Never reads a cache.
 */
export async function readRows(client: LicenceReadClient): Promise<LicenceRows> {
  const deploymentId = await ensureDeployment(client);
  await ensureLicenceStateRow(client);
  const row = await client.licenceState.findUnique({
    where: { id: LICENCE_STATE_ROW_ID },
    include: { activeRecord: true },
  });
  if (!row) throw new LicenceUnavailableError("Licence state could not be read.");
  const { activeRecord, ...state } = row;
  return { state, record: activeRecord, deploymentId };
}

/** `readRows` plus the register history the activation assessment needs. */
export async function readActivationRows(client: LicenceReadClient): Promise<ActivationRows> {
  const rows = await readRows(client);
  const history = await client.licenceRecord.findMany({
    select: { id: true, licenceId: true, issuedAt: true },
  });
  return { ...rows, history };
}

// ---------------------------------------------------------------------------
// Pure derivation
// ---------------------------------------------------------------------------

function resolveTrustSet(source: TrustSetSource): TrustSet {
  return typeof source === "function" ? source() : source;
}

/**
 * Derives the state at `now` from the stored rows. The stored raw text is
 * re-verified in runtime mode on every call; the dates fed to `deriveState`
 * are the signed payload dates, never the denormalised columns. The columns
 * are used only for display when verification did not succeed. A stored record
 * whose signed licence id differs from its own `licenceId` column was swapped
 * outside the application and is rejected as BAD_SIGNATURE.
 *
 * A thrown `LicenceUnavailableError` (trust set or key material could not be
 * loaded) maps to the UNAVAILABLE verification so the 24-hour window applies
 * (D-04). `trustSet` may be a loader so a load failure is caught here too.
 */
export function computeDerived(
  rows: LicenceRows,
  now: Date,
  trustSet: TrustSetSource,
): LicenceEvaluation {
  let verification: LicenceVerification = { kind: "OK" };
  let verified: VerifiedLicence | null = null;

  if (rows.record !== null) {
    try {
      const result = verifyLicence(rows.record.raw, {
        trustSet: resolveTrustSet(trustSet),
        deploymentId: rows.deploymentId,
        registeredClientId: rows.state.registeredClientId,
        now,
        mode: "runtime",
      });
      if (!result.ok) {
        verification = { kind: "REJECTED", reasonCode: result.code };
      } else if (result.licence.licenceId !== rows.record.licenceId) {
        verification = { kind: "REJECTED", reasonCode: "BAD_SIGNATURE" };
      } else {
        verified = result.licence;
      }
    } catch (error) {
      if (!(error instanceof LicenceUnavailableError)) throw error;
      verification = { kind: "UNAVAILABLE" };
    }
  }

  const derivedRecord = verified
    ? { expiresAt: verified.expiresAt, graceEndsAt: verified.graceEndsAt }
    : rows.record
      ? { expiresAt: rows.record.expiresAt, graceEndsAt: rows.record.graceEndsAt }
      : null;

  const derived = deriveState({
    everActivated: rows.state.everActivated,
    record: derivedRecord,
    verification,
    attentionSince: rows.state.attentionSince,
    // restrictedAt is kept unchanged while VALIDATION_ATTENTION, so the last
    // known restricted flag survives an attention window.
    lastGoodRestricted: rows.state.restrictedAt !== null,
    now,
  });

  return { ...derived, verification, verified };
}

function asOutcome(value: string | null): LicenceVerificationOutcome | null {
  return value === "OK" || value === "FAILED" || value === "UNAVAILABLE" ? value : null;
}

/**
 * Copies only the `LicenceStatusSnapshot` allow-list; raw licence text is never
 * included. When the stored licence verified, display fields come from the
 * signed payload; otherwise only identifiers and dates stored beside the
 * record are shown (client name, time zone and support contact need a verified
 * payload and are null).
 */
export function buildStatusSnapshot(
  rows: LicenceRows,
  evaluation: LicenceEvaluation,
  evaluatedAt: Date,
): LicenceStatusSnapshot {
  const verified = evaluation.verified;
  const record = rows.record;
  const stateName: LicenceStateName = evaluation.state;
  // restrictedAt: exact graceEndsAt for time-derived restriction; for INVALID
  // and VALIDATION_ATTENTION the stored stamp (the service records it).
  const restrictedAt =
    evaluation.restrictedAt ??
    (stateName === "INVALID" || stateName === "VALIDATION_ATTENTION"
      ? rows.state.restrictedAt
      : null);

  return {
    state: stateName,
    reasonCode: evaluation.reasonCode,
    isRestricted: evaluation.isRestricted,
    everActivated: rows.state.everActivated,
    licenceId: verified?.licenceId ?? record?.licenceId ?? null,
    keyId: verified?.keyId ?? record?.keyId ?? null,
    schemaVersion: verified?.schemaVersion ?? record?.schemaVersion ?? null,
    clientName: verified?.clientName ?? null,
    deploymentId: rows.deploymentId,
    issuedAt: verified?.issuedAt ?? record?.issuedAt ?? null,
    notBefore: verified?.notBefore ?? null,
    expiresAt: verified?.expiresAt ?? record?.expiresAt ?? null,
    graceEndsAt: verified?.graceEndsAt ?? record?.graceEndsAt ?? null,
    timeZone: verified?.timeZone ?? null,
    support: verified
      ? {
          renewalEmail: verified.support.renewalEmail,
          supportEmail: verified.support.supportEmail,
          phone: verified.support.phone ?? null,
          hours: verified.support.hours ?? null,
        }
      : null,
    restrictedAt,
    daysRemaining: evaluation.daysRemaining,
    daysToGraceEnd: evaluation.daysToGraceEnd,
    underOneDay: evaluation.underOneDay,
    lastVerifiedAt: rows.state.lastVerifiedAt,
    lastVerificationOutcome: asOutcome(rows.state.lastVerificationOutcome),
    attentionSince: rows.state.attentionSince,
    clockAlertAt: rows.state.clockAlertAt,
    highWaterAt: rows.state.highWaterAt,
    evaluatedAt,
  };
}

/**
 * Decides whether `raw` may be activated. Check order: the verifier in
 * activate mode (envelope, key, signature, deployment, pinned client A5,
 * notBefore), then expiry, then the same-licence and anti-replay rules
 * (A7, Pitfall 4). Pure: reads only the rows it is given.
 */
export function assessActivation(
  rows: ActivationRows,
  raw: string,
  now: Date,
  trustSet: TrustSetSource,
): ActivationAssessment {
  const result = verifyLicence(raw, {
    trustSet: resolveTrustSet(trustSet),
    deploymentId: rows.deploymentId,
    registeredClientId: rows.state.registeredClientId,
    now,
    mode: "activate",
  });
  if (!result.ok) return { ok: false, code: result.code };
  const licence = result.licence;

  if (now.getTime() >= licence.expiresAt.getTime()) return { ok: false, code: "EXPIRED" };

  if (rows.record !== null && licence.licenceId === rows.record.licenceId) {
    return { ok: false, code: "ALREADY_ACTIVE" };
  }
  // A licence file that was activated earlier and then replaced is an older file.
  if (rows.history.some((entry) => entry.licenceId === licence.licenceId)) {
    return { ok: false, code: "OLDER_THAN_ACTIVE" };
  }
  const newest = rows.history.reduce<number | null>(
    (max, entry) => (max === null || entry.issuedAt.getTime() > max ? entry.issuedAt.getTime() : max),
    null,
  );
  if (newest !== null && licence.issuedAt.getTime() <= newest) {
    return { ok: false, code: "OLDER_THAN_ACTIVE" };
  }

  return {
    ok: true,
    licence,
    preview: {
      licenceId: licence.licenceId,
      clientName: licence.clientName,
      deploymentId: licence.deploymentId,
      issuedAt: licence.issuedAt,
      notBefore: licence.notBefore,
      expiresAt: licence.expiresAt,
      graceEndsAt: licence.graceEndsAt,
      timeZone: licence.timeZone,
      replaces: rows.record
        ? { licenceId: rows.record.licenceId, expiresAt: rows.record.expiresAt }
        : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Evaluation, enforcement and diagnostics (plan 14-09)
// ---------------------------------------------------------------------------

export type EvaluationSource = "SCHEDULED" | "STARTUP" | "REQUEST";

/** The decision of the per-write gate (LIC-04). */
export type WriteGateDecision =
  | { allowed: true }
  | { allowed: false; state: LicenceStateName; reasonCode: string | null };

export type EvaluationTransition = {
  from: LicenceStateName;
  to: LicenceStateName;
  /** True for the one caller whose version-guarded write committed the transition. */
  won: boolean;
};

export type EvaluationResult = {
  snapshot: LicenceStatusSnapshot;
  transitions: EvaluationTransition[];
  rollbackDetected: boolean;
  verificationChanged: boolean;
  /**
   * Notice dedupe keys due for the evaluated state. Reported on every call (the
   * expiry bucket moves without a state change); the notice writer dedupes on a
   * deterministic event id, so repeating a key creates nothing new.
   */
  noticeKeys: string[];
};

/** D-14: the exact, ordered allow-list of diagnostic report members. */
export const DIAGNOSTIC_REPORT_KEYS = [
  "reportVersion",
  "generatedAt",
  "state",
  "reasonCode",
  "licenceId",
  "keyId",
  "schemaVersion",
  "deploymentId",
  "registeredClientId",
  "issuedAt",
  "expiresAt",
  "graceEndsAt",
  "lastVerifiedAt",
  "lastVerificationOutcome",
  "attentionSince",
  "highWaterAt",
  "clockSkewSeconds",
  "trustSetKeyIds",
  "appVersion",
] as const;

export type DiagnosticReport = {
  reportVersion: 1;
  generatedAt: string;
  state: LicenceStateName;
  reasonCode: string | null;
  licenceId: string | null;
  keyId: string | null;
  schemaVersion: number | null;
  deploymentId: string;
  registeredClientId: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  graceEndsAt: string | null;
  lastVerifiedAt: string | null;
  lastVerificationOutcome: LicenceVerificationOutcome | null;
  attentionSince: string | null;
  highWaterAt: string | null;
  clockSkewSeconds: number;
  trustSetKeyIds: string[];
  appVersion: string | null;
};

/** Assumption A14: at most one enforcement audit row per actor per minute per process. */
const ENFORCEMENT_COALESCE_MS = 60_000;
const ENFORCEMENT_MEMORY_LIMIT = 1_000;
/** Attempts of the version-guarded write before the caller reports the winner's state. */
const EVALUATION_MAX_ATTEMPTS = 3;

function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return a.getTime() === b.getTime();
}

/** Closed outcome of this evaluation's verification; null when there is nothing to verify (never activated). */
function verificationOutcomeOf(
  rows: LicenceRows,
  evaluation: LicenceEvaluation,
): LicenceVerificationOutcome | null {
  if (evaluation.verification.kind === "UNAVAILABLE") return "UNAVAILABLE";
  if (evaluation.verification.kind === "REJECTED") return "FAILED";
  if (rows.record === null) return rows.state.everActivated ? "FAILED" : null;
  return "OK";
}

/**
 * The restricted stamp to store. Time-derived restriction starts at the signed
 * graceEndsAt; a restriction that is already in force keeps its stamp; a state
 * first observed as INVALID is stamped with the observation instant; the stamp
 * is untouched during VALIDATION_ATTENTION and cleared otherwise.
 */
function nextRestrictedAt(stored: LicenceState, derived: DerivedState, at: Date): Date | null {
  switch (derived.state) {
    case "RESTRICTED_CONTINUITY":
      return derived.restrictedAt;
    case "INVALID":
      return stored.restrictedAt ?? at;
    case "VALIDATION_ATTENTION":
      return stored.restrictedAt;
    default:
      return null;
  }
}

type EvaluationPlan = {
  evaluation: LicenceEvaluation;
  transitions: Array<{ from: LicenceStateName; to: LicenceStateName }>;
  stateChanged: boolean;
  outcome: LicenceVerificationOutcome | null;
  outcomeChanged: boolean;
  rollback: { detected: boolean; behindMs: number; by: "STORED_MARK" | "MONOTONIC" | null };
  nextAttentionSince: Date | null;
  nextRestrictedAt: Date | null;
  data: Prisma.LicenceStateUpdateManyMutationInput;
  hasWrite: boolean;
};

function planEvaluation(input: {
  rows: LicenceRows;
  evaluation: LicenceEvaluation;
  at: Date;
  source: EvaluationSource;
  monitorJumpMs: number;
  afterLoss: boolean;
}): EvaluationPlan {
  const { rows, evaluation, at, source, afterLoss } = input;
  const stored = rows.state;
  const derived = evaluation;

  const stateChanged = derived.state !== stored.state || derived.reasonCode !== stored.reasonCode;
  const restrictedAt = nextRestrictedAt(stored, derived, at);
  const restrictedChanged = !sameInstant(restrictedAt, stored.restrictedAt);
  // The local-failure window runs from the first UNAVAILABLE observation until a
  // verification succeeds or is rejected; INVALID(VALIDATION_WINDOW_EXHAUSTED)
  // keeps it so the state does not flap back into a fresh window.
  const nextAttentionSince =
    evaluation.verification.kind === "UNAVAILABLE" ? (stored.attentionSince ?? at) : null;
  const attentionChanged = !sameInstant(nextAttentionSince, stored.attentionSince);

  const outcome = verificationOutcomeOf(rows, evaluation);
  const outcomeChanged = outcome !== null && outcome !== asOutcome(stored.lastVerificationOutcome);

  // D-12: the stored mark first; the in-process monotonic comparison catches a
  // backward step that the stored mark cannot (strictly more than the tolerance).
  const storedRollback = detectRollback({ now: at, highWaterAt: stored.highWaterAt });
  const monotonicRollback = input.monitorJumpMs > SKEW_TOLERANCE_MS;
  const rollbackDetected = storedRollback.rolledBack || monotonicRollback;
  const rollback = {
    detected: rollbackDetected,
    behindMs: storedRollback.rolledBack ? storedRollback.behindMs : input.monitorJumpMs,
    by: storedRollback.rolledBack
      ? ("STORED_MARK" as const)
      : monotonicRollback
        ? ("MONOTONIC" as const)
        : null,
  };

  const significant =
    stateChanged || restrictedChanged || attentionChanged || outcomeChanged || rollbackDetected;
  const advanceHighWater =
    !rollbackDetected && shouldAdvanceHighWater({ now: at, highWaterAt: stored.highWaterAt });
  // After a lost race only significant changes are retried: a touch-only write
  // would bump the version once per loser for no reason.
  const writeVerification =
    outcome !== null &&
    !afterLoss &&
    (source !== "REQUEST" || significant || advanceHighWater);

  const data: Prisma.LicenceStateUpdateManyMutationInput = {};
  if (stateChanged) {
    data.state = derived.state;
    data.reasonCode = derived.reasonCode;
  }
  if (restrictedChanged) data.restrictedAt = restrictedAt;
  if (attentionChanged) data.attentionSince = nextAttentionSince;
  if (writeVerification || outcomeChanged) {
    data.lastVerifiedAt = at;
    data.lastVerificationOutcome = outcome;
    if (outcome === "OK") data.lastGoodAt = at;
  }
  if (rollbackDetected) {
    // Re-baseline so one anomaly raises one alert; never changes the licence state.
    data.highWaterAt = at;
    data.clockAlertAt = at;
  } else if (advanceHighWater && !afterLoss) {
    data.highWaterAt = at;
  }

  return {
    evaluation,
    transitions: stateChanged
      ? [{ from: stored.state as LicenceStateName, to: derived.state }]
      : [],
    stateChanged,
    outcome,
    outcomeChanged,
    rollback,
    nextAttentionSince,
    nextRestrictedAt: restrictedAt,
    data,
    hasWrite: Object.keys(data).length > 0,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export type LicenceServiceDeps = {
  db: LicenceDbClient;
  /** Loader, so a failure to load the trust set is caught as UNAVAILABLE rather than thrown. */
  trustSet?: () => TrustSet;
  /** Audit sink for enforcement rows (written outside any transaction). */
  audit: (event: BusinessAuditEvent) => Promise<void>;
  /** Audit sink for transition rows, written inside the winning transaction. */
  auditInTransaction?: (tx: LicenceTxClient, event: BusinessAuditEvent) => Promise<void>;
  now?: () => Date;
  /** Monotonic millisecond source for the in-process clock monitor (default performance.now). */
  monotonicNow?: () => number;
  /** Failure sink; receives the message and the error, default logs the error name only. */
  log?: (message: string, error: unknown) => void;
};

export function createLicenceService(deps: LicenceServiceDeps) {
  const trustSet = deps.trustSet ?? (() => loadTrustSet());
  const now = deps.now ?? (() => new Date());
  const auditInTransaction = deps.auditInTransaction ?? recordAuditInTransaction;
  const log =
    deps.log ??
    ((message: string, error: unknown) =>
      console.error(message, error instanceof Error ? error.name : "UnknownError"));

  // The only in-process memory, kept per service instance. It is NOT a cache of
  // the allow or block decision: every gate call re-reads and re-verifies. It
  // is consulted only when the database read itself fails (D-04).
  let lastGood: {
    restricted: boolean;
    state: LicenceStateName;
    reasonCode: string | null;
    everActivated: boolean;
  } | null = null;
  let degradedSince: Date | null = null;
  const enforcementAudited = new Map<string, number>();
  const clockMonitor = createClockMonitor({
    wallNow: () => now().getTime(),
    monotonicNow: deps.monotonicNow ?? (() => performance.now()),
  });

  /**
   * One enforcement audit row per actor (or the literal "system") per minute.
   * An audit failure is logged and never changes the decision (A14).
   */
  async function recordEnforcement(input: {
    operation: string;
    actorId: string | null;
    state: LicenceStateName;
    reasonCode: string | null;
    licenceId: string | null;
    at: Date;
  }): Promise<void> {
    const key = input.actorId ?? "system";
    const atMs = input.at.getTime();
    const last = enforcementAudited.get(key);
    if (last !== undefined && atMs - last < ENFORCEMENT_COALESCE_MS) return;
    enforcementAudited.set(key, atMs);
    if (enforcementAudited.size > ENFORCEMENT_MEMORY_LIMIT) {
      for (const [actor, seenAt] of enforcementAudited) {
        if (atMs - seenAt >= ENFORCEMENT_COALESCE_MS) enforcementAudited.delete(actor);
      }
    }
    try {
      await deps.audit({
        actorId: input.actorId,
        actorType: input.actorId === null ? "SYSTEM" : "USER",
        action: "licence.restriction_enforced",
        targetType: "LICENCE",
        targetId: input.licenceId,
        scopeType: "GLOBAL",
        after: { operation: input.operation, state: input.state, reasonCode: input.reasonCode },
        outcome: "DENIED",
      });
    } catch (error) {
      log("[licence] could not audit a restriction enforcement", error);
    }
  }

  /** Writes the winner's audit rows inside the transaction that committed the transition. */
  async function auditWinner(
    tx: LicenceTxClient,
    input: {
      rows: LicenceRows;
      plan: EvaluationPlan;
      at: Date;
      source: EvaluationSource;
      correlationId: string | null;
    },
  ): Promise<void> {
    const { rows, plan, at, source, correlationId } = input;
    const base = {
      actorId: null,
      actorType: "SYSTEM",
      targetType: "LICENCE",
      targetId: rows.record?.licenceId ?? null,
      scopeType: "GLOBAL" as const,
      correlationId,
    };
    if (plan.stateChanged) {
      await auditInTransaction(tx, {
        ...base,
        action: "licence.state_changed",
        before: { state: rows.state.state, reasonCode: rows.state.reasonCode },
        after: {
          state: plan.evaluation.state,
          reasonCode: plan.evaluation.reasonCode,
          restrictedAt: plan.nextRestrictedAt?.toISOString() ?? null,
          source,
        },
        outcome: "SUCCESS",
      });
    }
    if (plan.outcomeChanged && plan.outcome !== null) {
      await auditInTransaction(tx, {
        ...base,
        action: "licence.verified",
        before: { outcome: rows.state.lastVerificationOutcome },
        after: { outcome: plan.outcome, reasonCode: plan.evaluation.reasonCode, source },
        outcome: plan.outcome === "OK" ? "SUCCESS" : "FAILED",
      });
    }
    if (plan.rollback.detected) {
      await auditInTransaction(tx, {
        ...base,
        action: "licence.clock_rollback",
        before: { highWaterAt: rows.state.highWaterAt.toISOString() },
        after: {
          behindSeconds: Math.floor(plan.rollback.behindMs / 1000),
          detectedBy: plan.rollback.by,
          rebaselinedTo: at.toISOString(),
          source,
        },
        outcome: "DETECTED",
      });
    }
  }

  async function evaluateAndRecord(options: {
    source: EvaluationSource;
    correlationId?: string;
  }): Promise<EvaluationResult> {
    const at = now();
    const correlationId = options.correlationId ?? null;
    const monitorJumpMs = clockMonitor.sample().backwardJumpMs;
    let lost: EvaluationTransition[] | null = null;

    const noticeKeysFor = (plan: EvaluationPlan, rollbackDetected: boolean): string[] => [
      ...dueNoticeKeys({ derived: plan.evaluation, attentionSince: plan.nextAttentionSince }),
      ...(rollbackDetected ? [`clock-rollback-${utcHourBucket(at)}`] : []),
    ];

    for (let attempt = 0; attempt < EVALUATION_MAX_ATTEMPTS; attempt += 1) {
      const rows = await readRows(deps.db);
      const evaluation = computeDerived(rows, at, trustSet);
      const plan = planEvaluation({
        rows,
        evaluation,
        at,
        source: options.source,
        monitorJumpMs: attempt === 0 ? monitorJumpMs : 0,
        afterLoss: lost !== null,
      });

      if (!plan.hasWrite) {
        return {
          snapshot: buildStatusSnapshot(rows, evaluation, at),
          transitions: lost ?? [],
          rollbackDetected: false,
          verificationChanged: false,
          noticeKeys: noticeKeysFor(plan, false),
        };
      }

      const won = await deps.db.$transaction(async (tx) => {
        const updated = await tx.licenceState.updateMany({
          where: { id: LICENCE_STATE_ROW_ID, version: rows.state.version },
          data: { ...plan.data, version: { increment: 1 } },
        });
        // Stale write: another instance changed the row first; it audits, not us.
        if (updated.count === 0) return false;
        await auditWinner(tx, { rows, plan, at, source: options.source, correlationId });
        return true;
      });

      if (won) {
        const fresh = await readRows(deps.db);
        return {
          snapshot: buildStatusSnapshot(fresh, computeDerived(fresh, at, trustSet), at),
          transitions: plan.transitions.map((t) => ({ ...t, won: true })),
          rollbackDetected: plan.rollback.detected,
          verificationChanged: plan.outcomeChanged,
          noticeKeys: noticeKeysFor(plan, plan.rollback.detected),
        };
      }
      lost ??= plan.transitions.map((t) => ({ ...t, won: false }));
    }

    // Still contended after the retries: report the state the winners left.
    const rows = await readRows(deps.db);
    const evaluation = computeDerived(rows, at, trustSet);
    const plan = planEvaluation({
      rows,
      evaluation,
      at,
      source: options.source,
      monitorJumpMs: 0,
      afterLoss: true,
    });
    return {
      snapshot: buildStatusSnapshot(rows, evaluation, at),
      transitions: lost ?? [],
      rollbackDetected: false,
      verificationChanged: false,
      noticeKeys: noticeKeysFor(plan, false),
    };
  }

  /**
   * The read-failure branch (D-04): keep the last-known-good decision for
   * exactly 24 hours from the first failure of the current streak, then block.
   *
   * OQ1 option-a: a deployment that is not known to have activated a licence
   * (no successful read yet in this process, or the last successful read showed
   * a never-activated deployment) has nothing to enforce, so it is never
   * blocked by a read failure. This keeps a deployment whose licence tables are
   * not migrated yet fully operational instead of blocking it after 24 hours.
   */
  async function decideDuringReadFailure(
    input: { operation: string; actorId: string | null },
    at: Date,
  ): Promise<WriteGateDecision> {
    if (lastGood === null || !lastGood.everActivated) return { allowed: true };
    degradedSince ??= at;
    if (at.getTime() - degradedSince.getTime() >= UNAVAILABLE_WINDOW_MS) {
      await recordEnforcement({
        ...input,
        state: "INVALID",
        reasonCode: "VALIDATION_WINDOW_EXHAUSTED",
        licenceId: null,
        at,
      });
      return { allowed: false, state: "INVALID", reasonCode: "VALIDATION_WINDOW_EXHAUSTED" };
    }
    if (lastGood === null || !lastGood.restricted) return { allowed: true };
    await recordEnforcement({
      ...input,
      state: lastGood.state,
      reasonCode: lastGood.reasonCode,
      licenceId: null,
      at,
    });
    return { allowed: false, state: lastGood.state, reasonCode: lastGood.reasonCode };
  }

  /**
   * LIC-04, D-13: re-reads the singleton and re-verifies the stored licence on
   * every call. No write on the allow path. A derived state that differs from
   * the stored one triggers one opportunistic, swallowed transition record
   * (Pitfall 6); it never fails the request.
   */
  async function checkWriteGate(input: {
    operation: string;
    actorId: string | null;
  }): Promise<WriteGateDecision> {
    const at = now();
    let rows: LicenceRows;
    let derived: LicenceEvaluation;
    try {
      rows = await readRows(deps.db);
      derived = computeDerived(rows, at, trustSet);
    } catch (error) {
      log("[licence] licence state read failed; using the bounded last-known-good decision", error);
      return decideDuringReadFailure(input, at);
    }

    degradedSince = null;
    lastGood = {
      restricted: derived.isRestricted,
      state: derived.state,
      reasonCode: derived.reasonCode,
      everActivated: rows.state.everActivated,
    };

    if (derived.state !== rows.state.state || derived.reasonCode !== rows.state.reasonCode) {
      try {
        await evaluateAndRecord({ source: "REQUEST" });
      } catch (error) {
        log("[licence] opportunistic transition record failed", error);
      }
    }

    if (!derived.isRestricted) return { allowed: true };

    await recordEnforcement({
      operation: input.operation,
      actorId: input.actorId,
      state: derived.state,
      reasonCode: derived.reasonCode,
      licenceId: rows.record?.licenceId ?? null,
      at,
    });
    return { allowed: false, state: derived.state, reasonCode: derived.reasonCode };
  }

  return {
    /** The seeded deployment identifier; recreates the singleton row when missing (D-13). */
    async ensureDeploymentIdentity(): Promise<string> {
      return ensureDeployment(deps.db);
    },

    /** The shared, database-derived status. Writes nothing. */
    async getStatusSnapshot(): Promise<LicenceStatusSnapshot> {
      const evaluatedAt = now();
      const rows = await readRows(deps.db);
      return buildStatusSnapshot(rows, computeDerived(rows, evaluatedAt, trustSet), evaluatedAt);
    },

    /** Verifies a pasted licence and previews it without persisting anything. */
    async inspect(raw: string): Promise<InspectResult> {
      const rows = await readActivationRows(deps.db);
      const assessment = assessActivation(rows, raw, now(), trustSet);
      return assessment.ok
        ? { ok: true, preview: assessment.preview }
        : { ok: false, code: assessment.code };
    },

    checkWriteGate,

    /** Throws `LicenceWriteBlockedError` (neutral message) when the gate blocks. */
    async assertWriteAllowed(input: { operation: string; actorId?: string | null }): Promise<void> {
      const decision = await checkWriteGate({
        operation: input.operation,
        actorId: input.actorId ?? null,
      });
      if (!decision.allowed) throw new LicenceWriteBlockedError();
    },

    /**
     * D-08: whether the deployment is restricted and since when. Fails open on a
     * read failure so a payment is never rejected by a transient licence read
     * error; writes nothing.
     */
    async getRestrictionCutoff(): Promise<{ restricted: boolean; restrictedAt: Date | null }> {
      const at = now();
      try {
        const rows = await readRows(deps.db);
        const derived = computeDerived(rows, at, trustSet);
        if (!derived.isRestricted) return { restricted: false, restrictedAt: null };
        return {
          restricted: true,
          restrictedAt: derived.restrictedAt ?? rows.state.restrictedAt ?? at,
        };
      } catch (error) {
        log("[licence] restriction cutoff read failed; failing open", error);
        return { restricted: false, restrictedAt: null };
      }
    },

    evaluateAndRecord,

    /** D-14: the allow-listed diagnostic report, built field by field (never spread from a row). */
    async buildDiagnosticReport(): Promise<DiagnosticReport> {
      const generatedAt = now();
      const rows = await readRows(deps.db);
      const snapshot = buildStatusSnapshot(
        rows,
        computeDerived(rows, generatedAt, trustSet),
        generatedAt,
      );

      let trustSetKeyIds: string[] = [];
      try {
        trustSetKeyIds = [...trustSet().keys()].sort();
      } catch {
        trustSetKeyIds = [];
      }

      const iso = (value: Date | null): string | null =>
        value === null ? null : value.toISOString();
      const aheadMs = rows.state.highWaterAt.getTime() - generatedAt.getTime();

      return {
        reportVersion: 1,
        generatedAt: generatedAt.toISOString(),
        state: snapshot.state,
        reasonCode: snapshot.reasonCode,
        licenceId: snapshot.licenceId,
        keyId: snapshot.keyId,
        schemaVersion: snapshot.schemaVersion,
        deploymentId: rows.deploymentId,
        registeredClientId: rows.state.registeredClientId,
        issuedAt: iso(snapshot.issuedAt),
        expiresAt: iso(snapshot.expiresAt),
        graceEndsAt: iso(snapshot.graceEndsAt),
        lastVerifiedAt: iso(snapshot.lastVerifiedAt),
        lastVerificationOutcome: snapshot.lastVerificationOutcome,
        attentionSince: iso(snapshot.attentionSince),
        highWaterAt: iso(snapshot.highWaterAt),
        clockSkewSeconds: Math.max(0, Math.floor(aheadMs / 1000)),
        trustSetKeyIds,
        appVersion: process.env.APP_VERSION ?? null,
      };
    },
  };
}

export type LicenceService = ReturnType<typeof createLicenceService>;

export const licenceService: LicenceService = createLicenceService({
  db: prisma,
  audit: recordAudit,
});
