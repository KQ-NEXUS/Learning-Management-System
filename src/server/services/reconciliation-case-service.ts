import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import {
  type CollectionAuthorization,
} from "@/server/permissions/collection-scope";
import type { ResourceScope } from "@/server/permissions/scope";
import type { BusinessAuditEvent } from "@/server/services/audit-service";
import { recordAudit } from "@/server/services/audit-service";
import type { RawGrant, createWithPermission } from "@/server/permissions/with-permission";

type WithPermission = ReturnType<typeof createWithPermission>;
type QueryClient = Pick<PrismaClient, "$queryRaw" | "$executeRaw" | "$transaction">;

export type ReconciliationSubject = "PAYMENT" | "REFUND";
export type ReconciliationRisk =
  | "CAPTURED_MONEY"
  | "SETTLEMENT_VARIANCE"
  | "MISSING_PROVIDER_DATA";

export const RECONCILIATION_RISK_LABELS = Object.freeze({
  CAPTURED_MONEY: "Captured money",
  SETTLEMENT_VARIANCE: "Settlement difference",
  MISSING_PROVIDER_DATA: "Missing provider data",
} satisfies Record<ReconciliationRisk, string>);

export const RECONCILIATION_RESOLUTION_LABELS = Object.freeze({
  MATCHED_PROVIDER_EVIDENCE: "Matched provider evidence",
  CORRECTED_UPSTREAM: "Corrected upstream",
  DUPLICATE_RECORD: "Duplicate record",
  ACCEPTED_VARIANCE: "Accepted variance",
  OTHER: "Other",
} as const);

export type ReconciliationResolutionReason = keyof typeof RECONCILIATION_RESOLUTION_LABELS;
export type ReconciliationCaseStatus = "OPEN" | "RESOLVED" | "REOPENED";

export type ReconciliationCaseFilters = {
  provider?: "PAYSTACK" | "STRIPE" | "MANUAL";
  currency?: string;
  subject?: ReconciliationSubject;
  status?: ReconciliationCaseStatus;
  dateFrom?: Date;
  dateTo?: Date;
};

export type ReconciliationCaseRow = {
  caseId: string;
  subject: ReconciliationSubject;
  risk: ReconciliationRisk;
  status: ReconciliationCaseStatus;
  provider: "PAYSTACK" | "STRIPE" | "MANUAL";
  currency: string;
  amountMinor: number;
  varianceMinor: number | null;
  orderReference: string;
  learnerName: string;
  cohortTitle: string;
  assigneeName: string | null;
  openedAt: Date;
  lastEvidenceAt: Date;
};

export type ReconciliationSummaryRow = {
  provider: "PAYSTACK" | "STRIPE" | "MANUAL";
  currency: string;
  subject: ReconciliationSubject;
  count: number;
  amountMinor: number;
};

export type ReconciliationAssigneeOption = { id: string; name: string };

export type SyncReconciliationEvidenceInput = {
  subject: ReconciliationSubject;
  paymentAttemptId?: string;
  refundId?: string;
  risk: ReconciliationRisk;
  evidence: unknown;
  correlationId?: string | null;
};

export type MoneyState =
  | { kind: "VALUE"; minor: number }
  | { kind: "PENDING" }
  | { kind: "NOT_APPLICABLE" };

export type ReconciliationCaseDetail = {
  caseId: string;
  subject: ReconciliationSubject;
  risk: ReconciliationRisk;
  status: "OPEN" | "RESOLVED" | "REOPENED";
  openedAt: Date;
  lastEvidenceAt: Date;
  provider: "PAYSTACK" | "STRIPE" | "MANUAL";
  currency: string;
  evidence: unknown;
  order: {
    id: string;
    reference: string;
    status: string;
    learnerName: string;
    learnerEmail: string;
    cohortId: string;
    cohortTitle: string;
    enrolmentStates: string[];
  };
  subjectAmount: MoneyState;
  amounts: {
    base: MoneyState;
    platformFee: MoneyState;
    gatewayFeeEstimated: MoneyState;
    learnerTotal: MoneyState;
    schoolSettlementExpected: MoneyState;
    gatewayFeeActual: MoneyState;
    schoolSettlementActual: MoneyState;
    platformGrossActual: MoneyState;
    platformNetActual: MoneyState;
  };
  assignment: { assigneeName: string | null; assignedAt: Date | null };
  resolution: {
    reason: string | null;
    note: string | null;
    resolvedAt: Date | null;
    resolvedByName: string | null;
  };
  paymentTimeline: Array<{
    id: string;
    kind: "PAYMENT" | "REFUND";
    provider: string;
    currency: string;
    amountMinor: number;
    status: string;
    reference: string | null;
    actorName: string | null;
    correlationId: string | null;
    occurredAt: Date;
  }>;
  caseHistory: Array<{
    id: string;
    type: string;
    actorType: string;
    actorName: string | null;
    evidence: unknown;
    fingerprint: string | null;
    resolutionReason: string | null;
    note: string | null;
    correlationId: string | null;
    createdAt: Date;
  }>;
  operationalHistory: Array<{
    id: string;
    action: string;
    targetType: string;
    targetId: string | null;
    actorType: string;
    correlationId: string | null;
    reason: string | null;
    createdAt: Date;
  }>;
  links: {
    paymentHref: string;
    refundHref: string | null;
    cohortHref: string | null;
  };
};

const REDACTED_EVIDENCE_KEYS = new Set([
  "apikey",
  "authorization",
  "password",
  "rawpayload",
  "secret",
  "signature",
  "token",
]);

function safeEvidence(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((entry) => safeEvidence(entry, seen));
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    normalized[key] = REDACTED_EVIDENCE_KEYS.has(key.toLowerCase())
      ? "[redacted]"
      : safeEvidence((value as Record<string, unknown>)[key], seen);
  }
  return normalized;
}

function evidenceFingerprint(input: {
  subject: ReconciliationSubject;
  risk: ReconciliationRisk;
  evidence: unknown;
}): { evidence: unknown; fingerprint: string } {
  const evidence = safeEvidence(input.evidence);
  const canonical = JSON.stringify({ subject: input.subject, risk: input.risk, evidence });
  return { evidence, fingerprint: createHash("sha256").update(canonical).digest("hex") };
}

function assertSubjectIdentity(input: SyncReconciliationEvidenceInput): void {
  const payment = input.paymentAttemptId?.trim() || null;
  const refund = input.refundId?.trim() || null;
  const valid =
    (input.subject === "PAYMENT" && payment !== null && refund === null) ||
    (input.subject === "REFUND" && refund !== null && payment === null);
  if (!valid) {
    throw new TypeError("A reconciliation case must identify exactly one matching payment or refund subject.");
  }
}

function valueOrPending(value: number | null): MoneyState {
  return value === null ? { kind: "PENDING" } : { kind: "VALUE", minor: value };
}

type CaseIdentityRow = {
  id: string;
  status: "OPEN" | "RESOLVED" | "REOPENED";
  evidenceFingerprint: string;
};

type CaseGraphRow = {
  caseId: string;
  subject: ReconciliationSubject;
  risk: ReconciliationRisk;
  status: "OPEN" | "RESOLVED" | "REOPENED";
  evidence: unknown;
  openedAt: Date;
  lastEvidenceAt: Date;
  assignedAt: Date | null;
  assigneeName: string | null;
  resolutionReason: string | null;
  resolutionNote: string | null;
  resolvedAt: Date | null;
  resolvedByName: string | null;
  orderId: string;
  orderReference: string;
  orderStatus: string;
  orderCorrelationId: string | null;
  learnerName: string;
  learnerEmail: string;
  cohortId: string;
  cohortTitle: string;
  provider: "PAYSTACK" | "STRIPE" | "MANUAL";
  currency: string;
  baseAmountMinor: number | null;
  platformFeeMinor: number | null;
  gatewayFeeEstimateMinor: number | null;
  amountMinor: number;
  schoolSettlementExpectedMinor: number | null;
  gatewayFeeActualMinor: number | null;
  schoolSettlementActualMinor: number | null;
  platformGrossActualMinor: number | null;
  platformNetActualMinor: number | null;
  subjectPaymentAttemptId: string;
  subjectRefundId: string | null;
  subjectRefundAmountMinor: number | null;
  subjectRefundStatus: string | null;
};

export type ReconciliationCaseServiceDeps = {
  client: QueryClient;
  withPermission: WithPermission;
  resolveCohortScope: (cohortId: string) => Promise<ResourceScope>;
  authorizeCollection?: (permission: "payments.view") => Promise<CollectionAuthorization>;
  loadGrants?: (userId: string) => Promise<RawGrant[]>;
  audit?: (event: BusinessAuditEvent) => Promise<void>;
  now?: () => Date;
};

function collectionScopeSql(authorization: CollectionAuthorization): Prisma.Sql {
  if (authorization.scope.kind === "GLOBAL") return Prisma.sql`TRUE`;
  const clauses: Prisma.Sql[] = [];
  if (authorization.scope.cohortIds.length > 0) {
    clauses.push(Prisma.sql`cohort.id IN (${Prisma.join([...authorization.scope.cohortIds])})`);
  }
  if (authorization.scope.programmeIds.length > 0) {
    clauses.push(Prisma.sql`cohort."programmeId" IN (${Prisma.join([...authorization.scope.programmeIds])})`);
  }
  if (authorization.scope.courseIds.length > 0) {
    clauses.push(Prisma.sql`(
      cohort."courseId" IN (${Prisma.join([...authorization.scope.courseIds])})
      OR EXISTS (
        SELECT 1 FROM "CohortCourse" cc
        WHERE cc."cohortId" = cohort.id
          AND cc."courseId" IN (${Prisma.join([...authorization.scope.courseIds])})
      )
    )`);
  }
  return clauses.length === 0
    ? Prisma.sql`FALSE`
    : Prisma.sql`(${Prisma.join(clauses, " OR ")})`;
}

function filterSql(filters: ReconciliationCaseFilters): Prisma.Sql {
  const clauses: Prisma.Sql[] = [];
  if (filters.provider) clauses.push(Prisma.sql`pa.provider = ${filters.provider}::"PaymentProvider"`);
  if (filters.currency) clauses.push(Prisma.sql`pa.currency = ${filters.currency}`);
  if (filters.subject) clauses.push(Prisma.sql`c.subject = ${filters.subject}::"ReconciliationSubject"`);
  if (filters.status) clauses.push(Prisma.sql`c.status = ${filters.status}::"ReconciliationCaseStatus"`);
  if (filters.dateFrom) clauses.push(Prisma.sql`c."openedAt" >= ${filters.dateFrom}`);
  if (filters.dateTo) clauses.push(Prisma.sql`c."openedAt" <= ${filters.dateTo}`);
  if (!filters.status) clauses.push(Prisma.sql`c.status IN ('OPEN', 'REOPENED')`);
  return clauses.length === 0 ? Prisma.sql`TRUE` : Prisma.sql`${Prisma.join(clauses, " AND ")}`;
}

export function createReconciliationCaseService(deps: ReconciliationCaseServiceDeps) {
  const now = deps.now ?? (() => new Date());

  async function findCaseScope(caseId: string): Promise<ResourceScope> {
    const rows = await deps.client.$queryRaw<Array<{ cohortId: string }>>(Prisma.sql`
      SELECT o."cohortId" AS "cohortId"
      FROM "ReconciliationCase" c
      LEFT JOIN "Refund" sr ON sr.id = c."refundId"
      JOIN "PaymentAttempt" pa ON pa.id = COALESCE(c."paymentAttemptId", sr."paymentAttemptId")
      JOIN "Order" o ON o.id = pa."orderId"
      WHERE c.id = ${caseId}
      LIMIT 1
    `);
    return rows[0] ? deps.resolveCohortScope(rows[0].cohortId) : {};
  }

  const authorizeCase = deps.withPermission<string>("payments.view", findCaseScope)(
    async (_caseId, context) => context,
  );

  async function collectionContext(): Promise<CollectionAuthorization> {
    if (!deps.authorizeCollection) {
      throw new Error("Collection authorization is not configured for reconciliation reads.");
    }
    return deps.authorizeCollection("payments.view");
  }

  async function listCases(filters: ReconciliationCaseFilters = {}): Promise<ReconciliationCaseRow[]> {
    const authorization = await collectionContext();
    const scope = collectionScopeSql(authorization);
    const filter = filterSql(filters);
    return deps.client.$queryRaw<ReconciliationCaseRow[]>(Prisma.sql`
      SELECT
        c.id AS "caseId", c.subject, c.risk, c.status, pa.provider, pa.currency,
        CASE WHEN c.subject = 'REFUND' THEN sr."amountMinor" ELSE pa."amountMinor" END AS "amountMinor",
        CASE
          WHEN c.subject = 'PAYMENT' AND pa."schoolSettlementActualMinor" IS NOT NULL
            AND o."schoolSettlementExpectedMinor" IS NOT NULL
          THEN pa."schoolSettlementActualMinor" - o."schoolSettlementExpectedMinor"
          ELSE NULL
        END AS "varianceMinor",
        o.reference AS "orderReference", learner.name AS "learnerName",
        cohort.title AS "cohortTitle", assignee.name AS "assigneeName",
        c."openedAt", c."lastEvidenceAt"
      FROM "ReconciliationCase" c
      LEFT JOIN "Refund" sr ON sr.id = c."refundId"
      JOIN "PaymentAttempt" pa ON pa.id = COALESCE(c."paymentAttemptId", sr."paymentAttemptId")
      JOIN "Order" o ON o.id = pa."orderId"
      JOIN "Cohort" cohort ON cohort.id = o."cohortId"
      JOIN "User" learner ON learner.id = o."userId"
      LEFT JOIN "User" assignee ON assignee.id = c."assignedToId"
      WHERE ${scope} AND ${filter}
      ORDER BY
        CASE c.risk
          WHEN 'CAPTURED_MONEY' THEN 0
          WHEN 'SETTLEMENT_VARIANCE' THEN 1
          ELSE 2
        END,
        c."openedAt", c.id
    `);
  }

  async function getReconciliationSummary(
    filters: ReconciliationCaseFilters = {},
  ): Promise<ReconciliationSummaryRow[]> {
    const authorization = await collectionContext();
    const scope = collectionScopeSql(authorization);
    const filter = filterSql(filters);
    return deps.client.$queryRaw<ReconciliationSummaryRow[]>(Prisma.sql`
      SELECT pa.provider, pa.currency, c.subject,
             COUNT(*)::int AS count,
             COALESCE(SUM(CASE WHEN c.subject = 'REFUND' THEN sr."amountMinor" ELSE pa."amountMinor" END), 0)::int AS "amountMinor"
      FROM "ReconciliationCase" c
      LEFT JOIN "Refund" sr ON sr.id = c."refundId"
      JOIN "PaymentAttempt" pa ON pa.id = COALESCE(c."paymentAttemptId", sr."paymentAttemptId")
      JOIN "Order" o ON o.id = pa."orderId"
      JOIN "Cohort" cohort ON cohort.id = o."cohortId"
      WHERE ${scope} AND ${filter}
      GROUP BY pa.provider, pa.currency, c.subject
      ORDER BY pa.currency, pa.provider, c.subject
    `);
  }

  async function listPermittedAssignees(): Promise<ReconciliationAssigneeOption[]> {
    const authorization = await collectionContext();
    const scope = collectionScopeSql(authorization);
    return deps.client.$queryRaw<ReconciliationAssigneeOption[]>(Prisma.sql`
      SELECT DISTINCT u.id, u.name
      FROM "User" u
      JOIN "Assignment" a ON a."userId" = u.id
      JOIN "Role" r ON r.id = a."roleId"
      WHERE u."isStaff" = TRUE
        AND u.status = 'ACTIVE'
        AND a.active = TRUE AND a."revokedAt" IS NULL
        AND (a."startsAt" IS NULL OR a."startsAt" <= ${now()})
        AND (a."endsAt" IS NULL OR a."endsAt" > ${now()})
        AND r.active = TRUE
        AND 'payments.view' = ANY(r.permissions)
        AND EXISTS (
          SELECT 1
          FROM "Cohort" cohort
          WHERE ${scope}
            AND (
              a."scopeType" = 'GLOBAL'
              OR (a."scopeType" = 'COHORT' AND a."scopeId" = cohort.id)
              OR (a."scopeType" = 'PROGRAMME' AND a."scopeId" = cohort."programmeId")
              OR (a."scopeType" = 'COURSE' AND (
                a."scopeId" = cohort."courseId"
                OR EXISTS (
                  SELECT 1 FROM "CohortCourse" cc
                  WHERE cc."cohortId" = cohort.id AND cc."courseId" = a."scopeId"
                )
              ))
            )
        )
      ORDER BY u.name, u.id
    `);
  }

  async function assertAssigneeAllowed(
    assigneeId: string,
    resources: readonly ResourceScope[],
  ): Promise<void> {
    const { hasPermission, isGrantActive } = await import("@/server/permissions/scope");
    if (!deps.loadGrants) throw new Error("Assignee authorization is not configured.");
    const users = await deps.client.$queryRaw<Array<{ id: string; isStaff: boolean }>>(Prisma.sql`
      SELECT id, "isStaff" FROM "User" WHERE id = ${assigneeId} LIMIT 1
    `);
    const grants = (await deps.loadGrants(assigneeId))
      .filter((grant) => isGrantActive(grant, now()))
      .map(({ permission, scopeType, scopeId }) => ({ permission, scopeType, scopeId }));
    if (!users[0]?.isStaff || resources.some((resource) => !hasPermission(grants, "payments.view", resource))) {
      throw new Error("The selected Finance assignee is not permitted for every selected case.");
    }
  }

  async function assignCases(input: {
    caseIds: readonly string[];
    assigneeId: string | null;
  }): Promise<{ changed: number }> {
    const caseIds = [...new Set(input.caseIds.map((id) => id.trim()).filter(Boolean))].sort();
    if (caseIds.length === 0) throw new TypeError("Select at least one reconciliation case.");
    const contexts = await Promise.all(caseIds.map((caseId) => authorizeCase(caseId)));
    if (input.assigneeId) {
      await assertAssigneeAllowed(input.assigneeId, contexts.map((context) => context.resource));
    }
    const actorId = contexts[0].actor.userId;
    const at = now();
    const changed = await deps.client.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; assignedToId: string | null }>>(Prisma.sql`
        SELECT id, "assignedToId" FROM "ReconciliationCase"
        WHERE id IN (${Prisma.join(caseIds)}) AND status IN ('OPEN', 'REOPENED')
        ORDER BY id FOR UPDATE
      `);
      let count = 0;
      for (const row of rows) {
        if (row.assignedToId === input.assigneeId) continue;
        await tx.$executeRaw(Prisma.sql`
          UPDATE "ReconciliationCase"
          SET "assignedToId" = ${input.assigneeId}, "assignedAt" = ${input.assigneeId ? at : null}, "updatedAt" = ${at}
          WHERE id = ${row.id}
        `);
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "ReconciliationCaseEvent" (id, "caseId", type, "actorId", "actorType", evidence, "createdAt")
          VALUES (${randomUUID()}, ${row.id}, 'ASSIGNED', ${actorId}, 'USER',
            CAST(${JSON.stringify({ assigneeId: input.assigneeId })} AS jsonb), ${at})
        `);
        count += 1;
      }
      return count;
    });
    if (changed > 0 && deps.audit) {
      await deps.audit({
        actorId,
        action: "reconciliation.cases_assigned",
        targetType: "ReconciliationCase",
        targetId: caseIds.length === 1 ? caseIds[0] : null,
        after: { caseIds, assigneeId: input.assigneeId, changed },
        outcome: "SUCCESS",
      });
    }
    return { changed };
  }

  async function resolveCase(input: {
    caseId: string;
    reason: ReconciliationResolutionReason;
    note: string;
  }): Promise<{ changed: boolean }> {
    if (!(input.reason in RECONCILIATION_RESOLUTION_LABELS)) {
      throw new TypeError("Choose a valid resolution reason.");
    }
    const note = input.note.trim();
    if (!note) throw new TypeError("A case-specific resolution note is required.");
    const context = await authorizeCase(input.caseId);
    const at = now();
    const changed = await deps.client.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ status: ReconciliationCaseStatus; fingerprint: string }>>(Prisma.sql`
        SELECT status, "evidenceFingerprint" AS fingerprint
        FROM "ReconciliationCase" WHERE id = ${input.caseId} FOR UPDATE
      `);
      if (!rows[0] || rows[0].status === "RESOLVED") return false;
      await tx.$executeRaw(Prisma.sql`
        UPDATE "ReconciliationCase"
        SET status = 'RESOLVED', "resolutionReason" = ${input.reason}::"ReconciliationResolutionReason",
            "resolutionNote" = ${note}, "resolvedAt" = ${at}, "resolvedById" = ${context.actor.userId},
            "updatedAt" = ${at}
        WHERE id = ${input.caseId} AND status IN ('OPEN', 'REOPENED')
      `);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "ReconciliationCaseEvent" (
          id, "caseId", type, "actorId", "actorType", fingerprint,
          "resolutionReason", note, "createdAt"
        ) VALUES (
          ${randomUUID()}, ${input.caseId}, 'RESOLVED', ${context.actor.userId}, 'USER',
          ${rows[0].fingerprint}, ${input.reason}::"ReconciliationResolutionReason", ${note}, ${at}
        )
      `);
      return true;
    });
    if (changed && deps.audit) {
      await deps.audit({
        actorId: context.actor.userId,
        action: "reconciliation.case_resolved",
        targetType: "ReconciliationCase",
        targetId: input.caseId,
        after: { reason: input.reason, note },
        reason: note,
        outcome: "SUCCESS",
      });
    }
    return { changed };
  }

  async function syncEvidenceAsSystem(input: SyncReconciliationEvidenceInput): Promise<{
    caseId: string;
    status: "OPEN" | "RESOLVED" | "REOPENED";
    fingerprint: string;
    transition: "OPENED" | "EVIDENCE_CHANGED" | "REOPENED" | "UNCHANGED";
  }> {
    assertSubjectIdentity(input);
    const normalized = evidenceFingerprint(input);
    const at = now();
    const paymentAttemptId = input.subject === "PAYMENT" ? input.paymentAttemptId! : null;
    const refundId = input.subject === "REFUND" ? input.refundId! : null;

    return deps.client.$transaction(async (tx) => {
      const id = randomUUID();
      const eventId = randomUUID();
      const inserted = input.subject === "PAYMENT"
        ? await tx.$queryRaw<CaseIdentityRow[]>(Prisma.sql`
            INSERT INTO "ReconciliationCase" (
              id, subject, risk, status, "paymentAttemptId", "refundId", evidence,
              "evidenceFingerprint", "lastEvidenceAt", "openedAt", "updatedAt"
            ) VALUES (
              ${id}, ${input.subject}::"ReconciliationSubject", ${input.risk}::"ReconciliationRisk",
              'OPEN', ${paymentAttemptId}, NULL, CAST(${JSON.stringify(normalized.evidence)} AS jsonb),
              ${normalized.fingerprint}, ${at}, ${at}, ${at}
            )
            ON CONFLICT ("paymentAttemptId") WHERE "paymentAttemptId" IS NOT NULL DO NOTHING
            RETURNING id, status, "evidenceFingerprint"
          `)
        : await tx.$queryRaw<CaseIdentityRow[]>(Prisma.sql`
            INSERT INTO "ReconciliationCase" (
              id, subject, risk, status, "paymentAttemptId", "refundId", evidence,
              "evidenceFingerprint", "lastEvidenceAt", "openedAt", "updatedAt"
            ) VALUES (
              ${id}, ${input.subject}::"ReconciliationSubject", ${input.risk}::"ReconciliationRisk",
              'OPEN', NULL, ${refundId}, CAST(${JSON.stringify(normalized.evidence)} AS jsonb),
              ${normalized.fingerprint}, ${at}, ${at}, ${at}
            )
            ON CONFLICT ("refundId") WHERE "refundId" IS NOT NULL DO NOTHING
            RETURNING id, status, "evidenceFingerprint"
          `);

      if (inserted[0]) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "ReconciliationCaseEvent" (
            id, "caseId", type, "actorType", evidence, fingerprint, "correlationId", "createdAt"
          ) VALUES (
            ${eventId}, ${inserted[0].id}, 'OPENED', 'SYSTEM',
            CAST(${JSON.stringify(normalized.evidence)} AS jsonb), ${normalized.fingerprint},
            ${input.correlationId ?? null}, ${at}
          )
        `);
        return {
          caseId: inserted[0].id,
          status: "OPEN" as const,
          fingerprint: normalized.fingerprint,
          transition: "OPENED" as const,
        };
      }

      const existing = await tx.$queryRaw<CaseIdentityRow[]>(input.subject === "PAYMENT"
        ? Prisma.sql`
            SELECT id, status, "evidenceFingerprint"
            FROM "ReconciliationCase"
            WHERE "paymentAttemptId" = ${paymentAttemptId}
            FOR UPDATE
          `
        : Prisma.sql`
            SELECT id, status, "evidenceFingerprint"
            FROM "ReconciliationCase"
            WHERE "refundId" = ${refundId}
            FOR UPDATE
          `);
      const current = existing[0];
      if (!current) throw new Error("The reconciliation subject disappeared during synchronization.");
      if (current.evidenceFingerprint === normalized.fingerprint) {
        return {
          caseId: current.id,
          status: current.status,
          fingerprint: current.evidenceFingerprint,
          transition: "UNCHANGED" as const,
        };
      }

      const transition = current.status === "RESOLVED" ? "REOPENED" : "EVIDENCE_CHANGED";
      const nextStatus = current.status === "RESOLVED" ? "REOPENED" : current.status;
      await tx.$executeRaw(Prisma.sql`
        UPDATE "ReconciliationCase"
        SET risk = ${input.risk}::"ReconciliationRisk",
            status = ${nextStatus}::"ReconciliationCaseStatus",
            evidence = CAST(${JSON.stringify(normalized.evidence)} AS jsonb),
            "evidenceFingerprint" = ${normalized.fingerprint},
            "lastEvidenceAt" = ${at},
            "updatedAt" = ${at}
        WHERE id = ${current.id}
      `);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "ReconciliationCaseEvent" (
          id, "caseId", type, "actorType", evidence, fingerprint, "correlationId", "createdAt"
        ) VALUES (
          ${eventId}, ${current.id}, ${transition}::"ReconciliationCaseEventType", 'SYSTEM',
          CAST(${JSON.stringify(normalized.evidence)} AS jsonb), ${normalized.fingerprint},
          ${input.correlationId ?? null}, ${at}
        )
      `);
      return {
        caseId: current.id,
        status: nextStatus,
        fingerprint: normalized.fingerprint,
        transition,
      };
    });
  }

  async function syncOrderEvidenceAsSystem(input: {
    orderId: string;
    risk: ReconciliationRisk;
    evidence: unknown;
    correlationId?: string | null;
  }): Promise<Awaited<ReturnType<typeof syncEvidenceAsSystem>> | null> {
    const rows = await deps.client.$queryRaw<Array<{ paymentAttemptId: string }>>(Prisma.sql`
      SELECT id AS "paymentAttemptId" FROM "PaymentAttempt"
      WHERE "orderId" = ${input.orderId} AND status = 'SUCCEEDED'
      ORDER BY "confirmedAt" DESC NULLS LAST, "initiatedAt" DESC, id DESC
      LIMIT 1
    `);
    if (!rows[0]) return null;
    return syncEvidenceAsSystem({
      subject: "PAYMENT",
      paymentAttemptId: rows[0].paymentAttemptId,
      risk: input.risk,
      evidence: input.evidence,
      correlationId: input.correlationId,
    });
  }

  async function correlateOperationalEvidenceAsSystem(input: {
    action: string;
    paymentAttemptId?: string | null;
    refundId?: string | null;
    orderId?: string | null;
    enrolmentId?: string | null;
    cohortId?: string | null;
    evidence: unknown;
    correlationId?: string | null;
  }): Promise<{ affected: number; reopened: number }> {
    const identifiers = [
      input.paymentAttemptId,
      input.refundId,
      input.orderId,
      input.enrolmentId,
      input.cohortId,
    ].filter((value): value is string => Boolean(value?.trim()));
    if (identifiers.length === 0) {
      throw new TypeError("Trusted operational evidence requires a server-derived subject identifier.");
    }
    const normalized = safeEvidence({ action: input.action, ...((input.evidence ?? {}) as object) });
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(normalized))
      .digest("hex");
    const at = now();

    return deps.client.$transaction(async (tx) => {
      const cases = await tx.$queryRaw<Array<{ id: string; status: ReconciliationCaseStatus }>>(Prisma.sql`
        SELECT c.id, c.status
        FROM "ReconciliationCase" c
        LEFT JOIN "Refund" subject_refund ON subject_refund.id = c."refundId"
        JOIN "PaymentAttempt" pa ON pa.id = COALESCE(c."paymentAttemptId", subject_refund."paymentAttemptId")
        JOIN "Order" o ON o.id = pa."orderId"
        WHERE (${input.paymentAttemptId ?? null}::text IS NOT NULL AND pa.id = ${input.paymentAttemptId ?? null})
           OR (${input.refundId ?? null}::text IS NOT NULL AND (
                c."refundId" = ${input.refundId ?? null}
                OR EXISTS (SELECT 1 FROM "Refund" linked_refund WHERE linked_refund.id = ${input.refundId ?? null} AND linked_refund."orderId" = o.id)
              ))
           OR (${input.orderId ?? null}::text IS NOT NULL AND o.id = ${input.orderId ?? null})
           OR (${input.enrolmentId ?? null}::text IS NOT NULL AND EXISTS (
                SELECT 1 FROM "Enrolment" linked_enrolment
                WHERE linked_enrolment.id = ${input.enrolmentId ?? null} AND linked_enrolment."orderId" = o.id
              ))
           OR (${input.cohortId ?? null}::text IS NOT NULL AND o."cohortId" = ${input.cohortId ?? null})
        ORDER BY c.id
        FOR UPDATE OF c
      `);
      let affected = 0;
      let reopened = 0;
      for (const current of cases) {
        const duplicates = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT id FROM "ReconciliationCaseEvent"
          WHERE "caseId" = ${current.id} AND fingerprint = ${fingerprint}
            AND "correlationId" IS NOT DISTINCT FROM ${input.correlationId ?? null}
          LIMIT 1
        `);
        if (duplicates[0]) continue;
        const transition = current.status === "RESOLVED" ? "REOPENED" : "EVIDENCE_CHANGED";
        if (transition === "REOPENED") {
          await tx.$executeRaw(Prisma.sql`
            UPDATE "ReconciliationCase"
            SET status = 'REOPENED', "lastEvidenceAt" = ${at}, "updatedAt" = ${at}
            WHERE id = ${current.id} AND status = 'RESOLVED'
          `);
          reopened += 1;
        } else {
          await tx.$executeRaw(Prisma.sql`
            UPDATE "ReconciliationCase" SET "lastEvidenceAt" = ${at}, "updatedAt" = ${at}
            WHERE id = ${current.id}
          `);
        }
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "ReconciliationCaseEvent" (
            id, "caseId", type, "actorType", evidence, fingerprint, "correlationId", "createdAt"
          ) VALUES (
            ${randomUUID()}, ${current.id}, ${transition}::"ReconciliationCaseEventType", 'SYSTEM',
            CAST(${JSON.stringify(normalized)} AS jsonb), ${fingerprint}, ${input.correlationId ?? null}, ${at}
          )
        `);
        affected += 1;
      }
      return { affected, reopened };
    });
  }

  const getCaseDetail = deps.withPermission<string>(
    "payments.view",
    findCaseScope,
  )(async (caseId, context): Promise<ReconciliationCaseDetail | null> => {
    const { hasPermission } = await import("@/server/permissions/scope");
    const rows = await deps.client.$queryRaw<CaseGraphRow[]>(Prisma.sql`
      SELECT
        c.id AS "caseId", c.subject, c.risk, c.status, c.evidence,
        c."openedAt", c."lastEvidenceAt", c."assignedAt",
        assignee.name AS "assigneeName", c."resolutionReason", c."resolutionNote",
        c."resolvedAt", resolver.name AS "resolvedByName",
        o.id AS "orderId", o.reference AS "orderReference", o.status AS "orderStatus",
        o."correlationId" AS "orderCorrelationId", learner.name AS "learnerName",
        learner.email AS "learnerEmail", cohort.id AS "cohortId", cohort.title AS "cohortTitle",
        pa.provider, pa.currency, o."baseAmountMinor", o."platformFeeMinor",
        o."gatewayFeeEstimateMinor", o."amountMinor", o."schoolSettlementExpectedMinor",
        pa."gatewayFeeActualMinor", pa."schoolSettlementActualMinor",
        pa."platformGrossActualMinor", pa."platformNetActualMinor",
        pa.id AS "subjectPaymentAttemptId", sr.id AS "subjectRefundId",
        sr."amountMinor" AS "subjectRefundAmountMinor", sr.status AS "subjectRefundStatus"
      FROM "ReconciliationCase" c
      LEFT JOIN "Refund" sr ON sr.id = c."refundId"
      JOIN "PaymentAttempt" pa ON pa.id = COALESCE(c."paymentAttemptId", sr."paymentAttemptId")
      JOIN "Order" o ON o.id = pa."orderId"
      JOIN "User" learner ON learner.id = o."userId"
      JOIN "Cohort" cohort ON cohort.id = o."cohortId"
      LEFT JOIN "User" assignee ON assignee.id = c."assignedToId"
      LEFT JOIN "User" resolver ON resolver.id = c."resolvedById"
      WHERE c.id = ${caseId}
      LIMIT 1
    `);
    const row = rows[0];
    if (!row) return null;

    type AttemptRow = {
      id: string; provider: string; currency: string; amountMinor: number; status: string;
      providerRef: string | null; manualReference: string | null; correlationId: string | null;
      initiatedAt: Date; confirmedAt: Date | null; actorName: string | null;
    };
    type RefundRow = {
      id: string; provider: string; currency: string; amountMinor: number; status: string;
      providerRef: string | null; createdAt: Date; completedAt: Date | null; actorName: string | null;
    };
    type EnrolmentRow = { id: string; status: string };
    type EventRow = ReconciliationCaseDetail["caseHistory"][number];
    type AuditRow = ReconciliationCaseDetail["operationalHistory"][number];

    const [attempts, refunds, enrolments, caseHistory] = await Promise.all([
      deps.client.$queryRaw<AttemptRow[]>(Prisma.sql`
        SELECT pa.id, pa.provider, pa.currency, pa."amountMinor", pa.status, pa."providerRef",
               pa."manualReference", pa."correlationId", pa."initiatedAt", pa."confirmedAt",
               actor.name AS "actorName"
        FROM "PaymentAttempt" pa
        LEFT JOIN "User" actor ON actor.id = pa."confirmedById"
        WHERE pa."orderId" = ${row.orderId}
        ORDER BY COALESCE(pa."confirmedAt", pa."initiatedAt"), pa.id
      `),
      deps.client.$queryRaw<RefundRow[]>(Prisma.sql`
        SELECT r.id, r.provider, r.currency, r."amountMinor", r.status, r."providerRef",
               r."createdAt", r."completedAt", actor.name AS "actorName"
        FROM "Refund" r
        LEFT JOIN "User" actor ON actor.id = r."actorId"
        WHERE r."orderId" = ${row.orderId}
        ORDER BY COALESCE(r."completedAt", r."createdAt"), r.id
      `),
      deps.client.$queryRaw<EnrolmentRow[]>(Prisma.sql`
        SELECT id, status FROM "Enrolment" WHERE "orderId" = ${row.orderId} ORDER BY "createdAt", id
      `),
      deps.client.$queryRaw<EventRow[]>(Prisma.sql`
        SELECT e.id, e.type, e."actorType", actor.name AS "actorName", e.evidence,
               e.fingerprint, e."resolutionReason", e.note, e."correlationId", e."createdAt"
        FROM "ReconciliationCaseEvent" e
        LEFT JOIN "User" actor ON actor.id = e."actorId"
        WHERE e."caseId" = ${caseId}
        ORDER BY e."createdAt", e.id
      `),
    ]);

    // Correlation seam for later payment/refund/enrolment operations: every
    // identifier comes from this trusted case ancestry, never the browser.
    const targetIds = [
      caseId,
      row.orderId,
      row.cohortId,
      row.subjectPaymentAttemptId,
      row.subjectRefundId,
      ...attempts.map((attempt) => attempt.id),
      ...refunds.map((refund) => refund.id),
      ...enrolments.map((enrolment) => enrolment.id),
    ]
      .filter((id): id is string => id !== null);
    const operationalHistory = await deps.client.$queryRaw<AuditRow[]>(Prisma.sql`
      SELECT id, action, "targetType", "targetId", "actorType", "correlationId", reason, "createdAt"
      FROM "AuditEvent"
      WHERE "targetId" IN (${Prisma.join(targetIds)})
         OR (${row.orderCorrelationId} IS NOT NULL AND "correlationId" = ${row.orderCorrelationId})
      ORDER BY "createdAt", id
    `);

    const manual = row.provider === "MANUAL";
    const paymentTimeline: ReconciliationCaseDetail["paymentTimeline"] = [
      ...attempts.map((attempt) => ({
        id: attempt.id,
        kind: "PAYMENT" as const,
        provider: attempt.provider,
        currency: attempt.currency,
        amountMinor: attempt.amountMinor,
        status: attempt.status,
        reference: attempt.manualReference ?? attempt.providerRef,
        actorName: attempt.actorName,
        correlationId: attempt.correlationId,
        occurredAt: attempt.confirmedAt ?? attempt.initiatedAt,
      })),
      ...refunds.map((refund) => ({
        id: refund.id,
        kind: "REFUND" as const,
        provider: refund.provider,
        currency: refund.currency,
        amountMinor: refund.amountMinor,
        status: refund.status,
        reference: refund.providerRef,
        actorName: refund.actorName,
        correlationId: row.orderCorrelationId,
        occurredAt: refund.completedAt ?? refund.createdAt,
      })),
    ].sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime() || left.id.localeCompare(right.id));

    return {
      caseId: row.caseId,
      subject: row.subject,
      risk: row.risk,
      status: row.status,
      openedAt: row.openedAt,
      lastEvidenceAt: row.lastEvidenceAt,
      provider: row.provider,
      currency: row.currency,
      evidence: row.evidence,
      order: {
        id: row.orderId,
        reference: row.orderReference,
        status: row.orderStatus,
        learnerName: row.learnerName,
        learnerEmail: row.learnerEmail,
        cohortId: row.cohortId,
        cohortTitle: row.cohortTitle,
        enrolmentStates: enrolments.map((enrolment) => enrolment.status),
      },
      subjectAmount: row.subject === "REFUND"
        ? (row.subjectRefundStatus === "COMPLETED" || row.subjectRefundStatus === "RECORDED_MANUALLY"
            ? { kind: "VALUE", minor: row.subjectRefundAmountMinor! }
            : { kind: "PENDING" })
        : { kind: "VALUE", minor: row.amountMinor },
      amounts: {
        base: valueOrPending(row.baseAmountMinor),
        platformFee: valueOrPending(row.platformFeeMinor),
        gatewayFeeEstimated: manual ? { kind: "NOT_APPLICABLE" } : valueOrPending(row.gatewayFeeEstimateMinor),
        learnerTotal: { kind: "VALUE", minor: row.amountMinor },
        schoolSettlementExpected: valueOrPending(row.schoolSettlementExpectedMinor),
        gatewayFeeActual: manual ? { kind: "NOT_APPLICABLE" } : valueOrPending(row.gatewayFeeActualMinor),
        schoolSettlementActual: manual ? { kind: "NOT_APPLICABLE" } : valueOrPending(row.schoolSettlementActualMinor),
        platformGrossActual: manual ? { kind: "NOT_APPLICABLE" } : valueOrPending(row.platformGrossActualMinor),
        platformNetActual: manual ? { kind: "NOT_APPLICABLE" } : valueOrPending(row.platformNetActualMinor),
      },
      assignment: { assigneeName: row.assigneeName, assignedAt: row.assignedAt },
      resolution: {
        reason: row.resolutionReason,
        note: row.resolutionNote,
        resolvedAt: row.resolvedAt,
        resolvedByName: row.resolvedByName,
      },
      paymentTimeline,
      caseHistory,
      operationalHistory,
      links: {
        paymentHref: `/staff/payments/${row.orderId}`,
        refundHref: hasPermission(context.grants, "refunds.manage", context.resource)
          ? `/staff/payments/${row.orderId}#refunds`
          : null,
        cohortHref:
          hasPermission(context.grants, "cohorts.view", context.resource) &&
          hasPermission(context.grants, "enrolments.manage", context.resource)
            ? `/staff/cohorts/${row.cohortId}`
            : null,
      },
    };
  });

  return {
    syncEvidenceAsSystem,
    syncOrderEvidenceAsSystem,
    correlateOperationalEvidenceAsSystem,
    listCases,
    getReconciliationSummary,
    listPermittedAssignees,
    assignCases,
    resolveCase,
    getCaseDetail,
  };
}

export function createPrismaBackedReconciliationCaseService(
  client: PrismaClient,
  withPermission: WithPermission,
  options: {
    authorizeCollection?: (permission: "payments.view") => Promise<CollectionAuthorization>;
    loadGrants?: (userId: string) => Promise<RawGrant[]>;
    audit?: (event: BusinessAuditEvent) => Promise<void>;
  } = {},
) {
  return createReconciliationCaseService({
    client,
    withPermission,
    ...options,
    resolveCohortScope: async (cohortId) => {
      const rows = await client.$queryRaw<Array<{
        id: string;
        programmeId: string | null;
        courseId: string | null;
      }>>(Prisma.sql`
        SELECT id, "programmeId", "courseId" FROM "Cohort" WHERE id = ${cohortId} LIMIT 1
      `);
      if (!rows[0]) return {};
      const memberCourses = rows[0].courseId
        ? []
        : await client.$queryRaw<Array<{ courseId: string }>>(Prisma.sql`
            SELECT "courseId" FROM "CohortCourse" WHERE "cohortId" = ${cohortId} ORDER BY position
          `);
      return {
        cohortId: rows[0].id,
        ...(rows[0].programmeId ? { programmeId: rows[0].programmeId } : {}),
        courseIds: rows[0].courseId ? [rows[0].courseId] : memberCourses.map((row) => row.courseId),
      };
    },
  });
}

// Actorless workers/webhooks load this module. Their service instance must not
// initialize request authorization or import next/headers through it.
const systemOnlyPermission = (() => () => async () => {
  throw new Error("Request authorization is unavailable in the system service.");
}) as unknown as WithPermission;

const system = createPrismaBackedReconciliationCaseService(prisma, systemOnlyPermission);
export const syncReconciliationEvidenceAsSystem = system.syncEvidenceAsSystem;
export const syncOrderReconciliationEvidenceAsSystem = system.syncOrderEvidenceAsSystem;
export const correlateReconciliationEvidenceAsSystem = system.correlateOperationalEvidenceAsSystem;

type LiveService = ReturnType<typeof createPrismaBackedReconciliationCaseService>;
let liveRequestServicePromise: Promise<LiveService> | undefined;
function liveRequestService(): Promise<LiveService> {
  return liveRequestServicePromise ??= Promise.all([
    import("@/server/permissions"),
    import("@/server/permissions/collection-scope"),
    import("@/server/services/grant-service"),
  ]).then(([permissions, collectionScope, grants]) => createPrismaBackedReconciliationCaseService(
    prisma,
    permissions.withPermission,
    {
      authorizeCollection: collectionScope.authorizeCollection,
      loadGrants: grants.loadGrantsForUser,
      audit: recordAudit,
    },
  ));
}

export async function listReconciliationCases(filters: ReconciliationCaseFilters = {}) {
  return (await liveRequestService()).listCases(filters);
}
export async function getReconciliationSummary(filters: ReconciliationCaseFilters = {}) {
  return (await liveRequestService()).getReconciliationSummary(filters);
}
export async function listReconciliationAssignees() {
  return (await liveRequestService()).listPermittedAssignees();
}
export async function assignReconciliationCases(input: Parameters<LiveService["assignCases"]>[0]) {
  return (await liveRequestService()).assignCases(input);
}
export async function resolveReconciliationCase(input: Parameters<LiveService["resolveCase"]>[0]) {
  return (await liveRequestService()).resolveCase(input);
}
export async function getReconciliationCaseDetail(caseId: string) {
  return (await liveRequestService()).getCaseDetail(caseId);
}
