/** Scope-safe query seam shared by the Reports hub and later drill-down/export producers. */

import { prisma } from "@/server/db";
import {
  authorizeCollection as liveAuthorizeCollection,
  type CollectionAuthorization,
} from "@/server/permissions/collection-scope";
import {
  getReportDefinition,
  type ReportDataset,
} from "@/server/services/report-registry";
import type { Permission } from "@/server/permissions/catalogue";

export type ReportFilters = Readonly<{
  from?: string;
  to?: string;
  programmeId?: string;
  cohortId?: string;
  provider?: "PAYSTACK" | "STRIPE" | "MANUAL";
  currency?: "NGN" | "USD";
  status?: string;
  page?: number;
  pageSize?: number;
}>;

export type NormalizedReportRequest = Readonly<{
  dataset: ReportDataset;
  version: string;
  filters: ReportFilters;
  scope: CollectionAuthorization["scope"];
  cohortWhere: CollectionAuthorization["cohortWhere"];
  asOf: Date;
}>;

export type HubOverview = Readonly<{
  request: NormalizedReportRequest;
  lastRefreshed: Date;
  headlines: Readonly<{
    registrations: number;
    activeEnrolments: number;
    unresolvedPaymentExceptions: number;
    paymentTotals: Readonly<{ NGN: number | null; USD: number | null }>;
  }>;
}>;

type CountDelegate = { count(args: Record<string, unknown>): Promise<number> };

export type ReportMetric = Readonly<{
  id: string;
  label: string;
  value: number | null;
  format: "COUNT" | "MONEY";
  currency?: "NGN" | "USD";
  href: string;
}>;

export type ReportBreakdownItem = Readonly<{
  id: string;
  label: string;
  value: number;
  href: string;
}>;

export type RegistrationReportRow = Readonly<{
  kind: "registrations";
  id: string;
  reference: string;
  learnerName: string;
  cohortTitle: string;
  status: string;
  businessDate: Date;
}>;

export type PaymentReportRow = Readonly<{
  kind: "payments";
  id: string;
  reference: string;
  learnerName: string;
  cohortTitle: string;
  provider: "PAYSTACK" | "STRIPE" | "MANUAL" | null;
  currency: string;
  status: string;
  businessDate: Date;
  transactionReference: string | null;
  baseAmountMinor: number | null;
  platformFeeMinor: number | null;
  gatewayFeeEstimateMinor: number | null;
  gatewayFeeActualMinor: number | null;
  learnerTotalMinor: number;
  schoolSettlementExpectedMinor: number | null;
  schoolSettlementActualMinor: number | null;
  platformGrossActualMinor: number | null;
  platformNetActualMinor: number | null;
  refundAmountMinor: number;
  refundReferences: readonly string[];
  exceptionContext: string | null;
}>;

export type EnrolmentReportRow = Readonly<{
  kind: "enrolments";
  id: string;
  learnerName: string;
  cohortTitle: string;
  status: string;
  businessDate: Date;
}>;

export type AttendanceReportRow = Readonly<{
  kind: "attendance";
  id: string;
  sessionTitle: string;
  cohortTitle: string;
  businessDate: Date;
  expected: boolean;
  totalRecords: number;
  stateCounts: Readonly<Record<string, number>>;
}>;

export type ReportRow =
  | RegistrationReportRow
  | PaymentReportRow
  | EnrolmentReportRow
  | AttendanceReportRow;

export type AvailableDatasetReport = Readonly<{
  available: true;
  definition: ReturnType<typeof getReportDefinition>;
  request: NormalizedReportRequest;
  lastRefreshed: Date;
  metrics: readonly ReportMetric[];
  breakdown: readonly ReportBreakdownItem[];
  rows: readonly ReportRow[];
  totalRows: number;
  page: number;
  pageSize: number;
  options: ReturnType<typeof stableOptions>;
  sectionErrors?: readonly string[];
}>;

export type UnavailableDatasetReport = Readonly<{
  available: false;
  definition: ReturnType<typeof getReportDefinition>;
  request: NormalizedReportRequest;
  lastRefreshed: Date;
}>;

export type DatasetReport = AvailableDatasetReport | UnavailableDatasetReport;

type OrderReportRecord = {
  id: string;
  reference: string;
  createdAt: Date;
  paidAt?: Date | null;
  status?: string;
  selectedProvider?: "PAYSTACK" | "STRIPE" | "MANUAL" | null;
  currency?: string;
  amountMinor?: number;
  baseAmountMinor?: number | null;
  platformFeeMinor?: number | null;
  gatewayFeeEstimateMinor?: number | null;
  schoolSettlementExpectedMinor?: number | null;
  user: { name: string; status?: string };
  cohort: { id: string; title: string };
  paymentAttempts?: Array<{
    id: string;
    provider: "PAYSTACK" | "STRIPE" | "MANUAL";
    status: string;
    confirmedAt: Date | null;
    providerRef: string | null;
    manualReference: string | null;
    confirmedById: string | null;
    gatewayFeeActualMinor: number | null;
    schoolSettlementActualMinor: number | null;
    platformGrossActualMinor: number | null;
    platformNetActualMinor: number | null;
    exceptionNote: string | null;
    reconciliationCases?: Array<{ id: string; status: string; risk: string }>;
  }>;
  refunds?: Array<{ id: string; amountMinor: number; status: string; providerRef: string | null }>;
};

type EnrolmentReportRecord = {
  id: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  activatedAt: Date | null;
  withdrawnAt: Date | null;
  user: { name: string };
  cohort: { id: string; title: string };
};

type SessionReportRecord = {
  id: string;
  title: string;
  startsAt: Date;
  attendanceExpected: boolean;
  cancelledAt: Date | null;
  cohort: { id: string; title: string };
  attendance: Array<{ id: string; state: string }>;
};

export type ReconciliationRefundRow = Readonly<{
  id: string;
  orderId: string;
  orderReference: string;
  paymentAttemptId: string;
  provider: "PAYSTACK" | "STRIPE" | "MANUAL";
  currency: string;
  amountMinor: number;
  status: string;
  providerReference: string | null;
  businessDate: Date;
  exceptionContext: string | null;
}>;

export type ReportQueryStore = {
  order: CountDelegate & {
    groupBy(args: Record<string, unknown>): Promise<Array<{
      currency: string;
      _sum: { amountMinor: number | null };
    }>>;
    findMany?(args: Record<string, unknown>): Promise<OrderReportRecord[]>;
  };
  enrolment: CountDelegate & {
    findMany?(args: Record<string, unknown>): Promise<EnrolmentReportRecord[]>;
  };
  reconciliationCase: CountDelegate;
  cohort: {
    findMany(args: Record<string, unknown>): Promise<Array<{
      id: string;
      title: string;
      programme: { id: string; title: string } | null;
      course: { id: string; title: string } | null;
    }>>;
  };
  scheduledSession?: {
    findMany(args: Record<string, unknown>): Promise<SessionReportRecord[]>;
  };
  refund?: {
    findMany(args: Record<string, unknown>): Promise<Array<{
      id: string;
      orderId: string;
      paymentAttemptId: string;
      provider: "PAYSTACK" | "STRIPE" | "MANUAL";
      currency: string;
      amountMinor: number;
      status: string;
      providerRef: string | null;
      createdAt: Date;
      completedAt: Date | null;
      order: { reference: string; cohort: { id: string } };
      paymentAttempt: { exceptionNote: string | null };
      reconciliationCases: Array<{ risk: string; status: string }>;
    }>>;
  };
};

export type ReportQueryServiceDeps = {
  store: ReportQueryStore;
  authorizeCollection: (permission: Permission) => Promise<CollectionAuthorization>;
  now?: () => Date;
};

function normalizeFilters(input: unknown): ReportFilters {
  const definition = getReportDefinition("registrations");
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Report filters are invalid.");
  }
  const filterCandidate = input as Record<string, unknown>;
  const allowed = new Set(["from", "to", "programmeId", "cohortId", "provider", "currency", "status", "page", "pageSize"]);
  if (Object.keys(filterCandidate).some((key) => !allowed.has(key))) {
    throw new Error("Report filters are invalid.");
  }
  const parsed = definition.filterSchema.safeParse({
    from: filterCandidate.from,
    to: filterCandidate.to,
    programmeId: filterCandidate.programmeId,
    cohortId: filterCandidate.cohortId,
    provider: filterCandidate.provider,
    currency: filterCandidate.currency,
  });
  if (!parsed.success) throw new Error("Report filters are invalid.");
  const status = filterCandidate.status;
  if (status !== undefined && (typeof status !== "string" || !/^[A-Z_]{1,64}$/.test(status))) {
    throw new Error("Report filters are invalid.");
  }
  const page = filterCandidate.page === undefined ? 1 : Number(filterCandidate.page);
  const pageSize = filterCandidate.pageSize === undefined ? 25 : Number(filterCandidate.pageSize);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new Error("Report filters are invalid.");
  }
  const filters: ReportFilters = {
    ...(parsed.data as ReportFilters),
    ...(status ? { status } : {}),
    page,
    pageSize,
  };
  if (filters.from && filters.to && filters.from > filters.to) {
    throw new Error("Report filters are invalid: date from must not be after date to.");
  }
  return Object.freeze({ ...filters });
}

function dateWhere(filters: ReportFilters, asOf: Date): Record<string, Date> {
  const range: Record<string, Date> = { lte: asOf };
  // Africa/Lagos is UTC+01:00 year-round. Convert the inclusive local
  // business-day boundaries to instants before they enter a database query.
  if (filters.from) range.gte = new Date(`${filters.from}T00:00:00.000+01:00`);
  if (filters.to) {
    const requestedEnd = new Date(`${filters.to}T23:59:59.999+01:00`);
    range.lte = requestedEnd < asOf ? requestedEnd : asOf;
  }
  return range;
}

const MAX_REPORT_ROWS = 25_000;

function reportQuery(filters: ReportFilters, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  for (const key of ["from", "to", "programmeId", "cohortId", "provider", "currency"] as const) {
    const value = filters[key];
    if (value) params.set(key, String(value));
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

function drillDownHref(dataset: ReportDataset, filters: ReportFilters, extra: Record<string, string> = {}) {
  return `/staff/reports/${dataset}${reportQuery(filters, extra)}#rows`;
}

function stableBusinessRows<T extends { id: string; businessDate: Date }>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (left, right) =>
      left.businessDate.getTime() - right.businessDate.getTime() || left.id.localeCompare(right.id),
  );
}

function paginateRows<T>(rows: readonly T[], filters: ReportFilters): T[] {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 25;
  return rows.slice((page - 1) * pageSize, page * pageSize);
}

function assertBounded(rows: readonly unknown[]): void {
  if (rows.length > MAX_REPORT_ROWS) {
    throw new Error("This report is too large to display. Narrow the filters and try again.");
  }
}

function countBy<T>(rows: readonly T[], value: (row: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = value(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function cohortWhere(request: NormalizedReportRequest): Record<string, unknown> {
  const selected: Record<string, unknown> = {};
  if (request.filters.programmeId) selected.programmeId = request.filters.programmeId;
  if (request.filters.cohortId) selected.id = request.filters.cohortId;
  return { AND: [request.cohortWhere, selected] };
}

function stableOptions(rows: Awaited<ReturnType<ReportQueryStore["cohort"]["findMany"]>>) {
  const programmeById = new Map<string, string>();
  for (const row of rows) {
    if (row.programme) programmeById.set(row.programme.id, row.programme.title);
  }
  return {
    programmes: [...programmeById]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id)),
    cohorts: rows
      .map((row) => ({ id: row.id, label: row.title }))
      .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id)),
  };
}

export function createReportQueryService(deps: ReportQueryServiceDeps) {
  const now = deps.now ?? (() => new Date());

  async function normalizeRequest(
    dataset: ReportDataset,
    rawFilters: unknown,
  ): Promise<NormalizedReportRequest> {
    const definition = getReportDefinition(dataset);
    const filters = normalizeFilters(rawFilters);
    const authorization = await deps.authorizeCollection("reports.view");
    const asOf = now();
    return Object.freeze({
      dataset,
      version: definition.version,
      filters,
      scope: authorization.scope,
      cohortWhere: authorization.cohortWhere,
      asOf,
    });
  }

  async function optionsForRequest(request: NormalizedReportRequest) {
    const rows = await deps.store.cohort.findMany({
      where: cohortWhere(request),
      select: {
        id: true,
        title: true,
        programme: { select: { id: true, title: true } },
        course: { select: { id: true, title: true } },
      },
      orderBy: [{ title: "asc" }, { id: "asc" }],
    });
    return stableOptions(rows);
  }

  async function dashboardOptions(request: NormalizedReportRequest) {
    try {
      return { options: await optionsForRequest(request), sectionErrors: [] as string[] };
    } catch {
      // Filter options are independent of the already-authorized row query.
      // Never replace successful financial rows or metrics with a false zero.
      return {
        options: { programmes: [], cohorts: [] },
        sectionErrors: ["filters"],
      };
    }
  }

  async function registrationsReport(request: NormalizedReportRequest): Promise<AvailableDatasetReport> {
    if (!deps.store.order.findMany) throw new Error("Registration report store is unavailable.");
    const records = await deps.store.order.findMany({
      where: {
        cohort: cohortWhere(request),
        createdAt: dateWhere(request.filters, request.asOf),
        ...(request.filters.status ? { user: { status: request.filters.status } } : {}),
      },
      select: {
        id: true,
        reference: true,
        createdAt: true,
        user: { select: { name: true, status: true } },
        cohort: { select: { id: true, title: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: MAX_REPORT_ROWS + 1,
    });
    assertBounded(records);
    const complete = stableBusinessRows(
      records.map((record): RegistrationReportRow => Object.freeze({
        kind: "registrations",
        id: record.id,
        reference: record.reference,
        learnerName: record.user.name,
        cohortTitle: record.cohort.title,
        status: record.user.status ?? "PENDING_VERIFICATION",
        businessDate: record.createdAt,
      })),
    );
    const verified = complete.filter((row) => row.status === "ACTIVE").length;
    const awaiting = complete.filter((row) => row.status === "PENDING_VERIFICATION").length;
    const metrics: ReportMetric[] = [
      { id: "total", label: "Total registrations", value: complete.length, format: "COUNT", href: drillDownHref("registrations", request.filters) },
      { id: "verified", label: "Verified", value: verified, format: "COUNT", href: drillDownHref("registrations", request.filters, { status: "ACTIVE" }) },
      { id: "awaiting-verification", label: "Awaiting verification", value: awaiting, format: "COUNT", href: drillDownHref("registrations", request.filters, { status: "PENDING_VERIFICATION" }) },
    ];
    const { options, sectionErrors } = await dashboardOptions(request);
    return Object.freeze({
      available: true,
      definition: getReportDefinition("registrations"),
      request,
      lastRefreshed: request.asOf,
      metrics: Object.freeze(metrics),
      breakdown: Object.freeze([]),
      rows: Object.freeze(paginateRows(complete, request.filters)),
      totalRows: complete.length,
      page: request.filters.page ?? 1,
      pageSize: request.filters.pageSize ?? 25,
      options,
      sectionErrors,
    });
  }

  async function paymentsReport(request: NormalizedReportRequest): Promise<AvailableDatasetReport> {
    if (!deps.store.order.findMany) throw new Error("Payment report store is unavailable.");
    const selectedStatus = request.filters.status;
    const paymentDate = dateWhere(request.filters, request.asOf);
    const records = await deps.store.order.findMany({
      where: {
        cohort: cohortWhere(request),
        paymentAttempts: { some: { status: "SUCCEEDED", confirmedAt: paymentDate } },
        status: selectedStatus && !["HAS_REFUND", "HAS_EXCEPTION"].includes(selectedStatus)
          ? selectedStatus
          : { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED", "EXCEPTION"] },
        ...(selectedStatus === "HAS_REFUND" ? { refunds: { some: { status: { not: "FAILED" } } } } : {}),
        ...(selectedStatus === "HAS_EXCEPTION" ? { paymentAttempts: { some: { status: "SUCCEEDED", confirmedAt: paymentDate, OR: [{ reconciliationCases: { some: {} } }, { exceptionNote: { not: null } }] } } } : {}),
        ...(request.filters.provider ? { selectedProvider: request.filters.provider } : {}),
        ...(request.filters.currency ? { currency: request.filters.currency } : {}),
      },
      select: {
        id: true,
        reference: true,
        paidAt: true,
        status: true,
        selectedProvider: true,
        currency: true,
        amountMinor: true,
        baseAmountMinor: true,
        platformFeeMinor: true,
        gatewayFeeEstimateMinor: true,
        schoolSettlementExpectedMinor: true,
        user: { select: { name: true } },
        cohort: { select: { id: true, title: true } },
        paymentAttempts: {
          where: { status: "SUCCEEDED", confirmedAt: paymentDate },
          select: {
            id: true,
            provider: true,
            status: true,
            confirmedAt: true,
            providerRef: true,
            manualReference: true,
            confirmedById: true,
            gatewayFeeActualMinor: true,
            schoolSettlementActualMinor: true,
            platformGrossActualMinor: true,
            platformNetActualMinor: true,
            exceptionNote: true,
            reconciliationCases: { select: { id: true, status: true, risk: true }, orderBy: [{ openedAt: "desc" }, { id: "desc" }] },
          },
          orderBy: [{ confirmedAt: "desc" }, { id: "desc" }],
        },
        refunds: {
          where: { status: { not: "FAILED" } },
          select: { id: true, amountMinor: true, status: true, providerRef: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        },
      },
      orderBy: [{ paidAt: "asc" }, { id: "asc" }],
      take: MAX_REPORT_ROWS + 1,
    });
    assertBounded(records);
    const complete = stableBusinessRows(records.map((paymentOrderRecord): PaymentReportRow => {
      const attempt = paymentOrderRecord.paymentAttempts?.[0] ?? null;
      const refundAmountMinor = (paymentOrderRecord.refunds ?? []).reduce((sum, refund) => sum + refund.amountMinor, 0);
      const caseContext = attempt?.reconciliationCases?.[0];
      return Object.freeze({
        kind: "payments",
        id: paymentOrderRecord.id,
        reference: paymentOrderRecord.reference,
        learnerName: paymentOrderRecord.user.name,
        cohortTitle: paymentOrderRecord.cohort.title,
        provider: paymentOrderRecord.selectedProvider ?? null,
        currency: paymentOrderRecord.currency ?? "",
        status: paymentOrderRecord.status ?? "PAID",
        businessDate: attempt?.confirmedAt ?? paymentOrderRecord.paidAt ?? paymentOrderRecord.createdAt,
        transactionReference: attempt?.providerRef ?? attempt?.manualReference ?? null,
        baseAmountMinor: paymentOrderRecord.baseAmountMinor ?? null,
        platformFeeMinor: paymentOrderRecord.platformFeeMinor ?? null,
        gatewayFeeEstimateMinor: paymentOrderRecord.gatewayFeeEstimateMinor ?? null,
        gatewayFeeActualMinor: attempt?.gatewayFeeActualMinor ?? null,
        learnerTotalMinor: paymentOrderRecord.amountMinor ?? 0,
        schoolSettlementExpectedMinor: paymentOrderRecord.schoolSettlementExpectedMinor ?? null,
        schoolSettlementActualMinor: attempt?.schoolSettlementActualMinor ?? null,
        platformGrossActualMinor: attempt?.platformGrossActualMinor ?? null,
        platformNetActualMinor: attempt?.platformNetActualMinor ?? null,
        refundAmountMinor,
        refundReferences: Object.freeze((paymentOrderRecord.refunds ?? []).map((refund) => refund.providerRef ?? refund.id)),
        exceptionContext: attempt?.exceptionNote ?? (caseContext ? `${caseContext.risk} (${caseContext.status})` : null),
      });
    }));
    const money = { NGN: 0, USD: 0 };
    let refunds = 0;
    let exceptions = 0;
    for (const paymentRow of complete) {
      if (paymentRow.currency === "NGN" || paymentRow.currency === "USD") money[paymentRow.currency] += paymentRow.learnerTotalMinor;
      if (paymentRow.refundReferences.length > 0) refunds += 1;
      if (paymentRow.exceptionContext !== null) exceptions += 1;
    }
    const metrics: ReportMetric[] = [
      { id: "confirmed-count", label: "Confirmed payments", value: complete.length, format: "COUNT", href: drillDownHref("payments", request.filters) },
      { id: "ngn-total", label: "NGN learner total", value: money.NGN, format: "MONEY", currency: "NGN", href: drillDownHref("payments", request.filters, { currency: "NGN" }) },
      { id: "usd-total", label: "USD learner total", value: money.USD, format: "MONEY", currency: "USD", href: drillDownHref("payments", request.filters, { currency: "USD" }) },
      { id: "refunds", label: "Payments with refunds", value: refunds, format: "COUNT", href: drillDownHref("payments", request.filters, { status: "HAS_REFUND" }) },
      { id: "exceptions", label: "Payments with exceptions", value: exceptions, format: "COUNT", href: drillDownHref("payments", request.filters, { status: "HAS_EXCEPTION" }) },
    ];
    const providerCounts = countBy(complete, (row) => row.provider ?? "UNASSIGNED");
    const statusCounts = countBy(complete, (row) => row.status);
    const breakdown = [
      ...[...providerCounts].map(([id, value]) => ({ id: `provider-${id}`, label: id === "UNASSIGNED" ? "Provider pending" : id, value, href: id === "UNASSIGNED" ? drillDownHref("payments", request.filters) : drillDownHref("payments", request.filters, { provider: id }) })),
      ...[...statusCounts].map(([id, value]) => ({ id: `status-${id}`, label: id.replaceAll("_", " "), value, href: drillDownHref("payments", request.filters, { status: id }) })),
    ];
    const { options, sectionErrors } = await dashboardOptions(request);
    return Object.freeze({ available: true, definition: getReportDefinition("payments"), request, lastRefreshed: request.asOf, metrics: Object.freeze(metrics), breakdown: Object.freeze(breakdown), rows: Object.freeze(paginateRows(complete, request.filters)), totalRows: complete.length, page: request.filters.page ?? 1, pageSize: request.filters.pageSize ?? 25, options, sectionErrors });
  }

  async function enrolmentsReport(request: NormalizedReportRequest): Promise<AvailableDatasetReport> {
    if (!deps.store.enrolment.findMany) throw new Error("Enrolment report store is unavailable.");
    const date = dateWhere(request.filters, request.asOf);
    const status = request.filters.status;
    const statusWhere = status === "WITHDRAWN_OR_CANCELLED"
      ? { in: ["WITHDRAWN", "CANCELLED"] }
      : status || undefined;
    const records = await deps.store.enrolment.findMany({
      where: {
        cohort: cohortWhere(request),
        ...(statusWhere ? { status: statusWhere } : {}),
        OR: [
          { status: "ACTIVE", activatedAt: date },
          { status: "PENDING_PAYMENT", createdAt: date },
          { status: "WITHDRAWN", withdrawnAt: date },
          { status: { in: ["CANCELLED", "TRANSFERRED", "COMPLETED"] }, updatedAt: date },
        ],
      },
      select: { id: true, status: true, createdAt: true, updatedAt: true, activatedAt: true, withdrawnAt: true, user: { select: { name: true } }, cohort: { select: { id: true, title: true } } },
      take: MAX_REPORT_ROWS + 1,
    });
    assertBounded(records);
    const complete = stableBusinessRows(records.map((record): EnrolmentReportRow => Object.freeze({ kind: "enrolments", id: record.id, learnerName: record.user.name, cohortTitle: record.cohort.title, status: record.status, businessDate: record.status === "ACTIVE" ? record.activatedAt ?? record.updatedAt : record.status === "PENDING_PAYMENT" ? record.createdAt : record.status === "WITHDRAWN" ? record.withdrawnAt ?? record.updatedAt : record.updatedAt })));
    const counts = countBy(complete, (row) => row.status);
    const terminal = (counts.get("WITHDRAWN") ?? 0) + (counts.get("CANCELLED") ?? 0);
    const metrics: ReportMetric[] = [
      { id: "active", label: "Active", value: counts.get("ACTIVE") ?? 0, format: "COUNT", href: drillDownHref("enrolments", request.filters, { status: "ACTIVE" }) },
      { id: "pending-payment", label: "Pending payment", value: counts.get("PENDING_PAYMENT") ?? 0, format: "COUNT", href: drillDownHref("enrolments", request.filters, { status: "PENDING_PAYMENT" }) },
      { id: "withdrawn-cancelled", label: "Withdrawn or cancelled", value: terminal, format: "COUNT", href: drillDownHref("enrolments", request.filters, { status: "WITHDRAWN_OR_CANCELLED" }) },
    ];
    const breakdown = [...counts].map(([id, value]) => ({ id, label: id.replaceAll("_", " "), value, href: drillDownHref("enrolments", request.filters, { status: id }) }));
    const { options, sectionErrors } = await dashboardOptions(request);
    return Object.freeze({ available: true, definition: getReportDefinition("enrolments"), request, lastRefreshed: request.asOf, metrics: Object.freeze(metrics), breakdown: Object.freeze(breakdown), rows: Object.freeze(paginateRows(complete, request.filters)), totalRows: complete.length, page: request.filters.page ?? 1, pageSize: request.filters.pageSize ?? 25, options, sectionErrors });
  }

  async function attendanceReport(request: NormalizedReportRequest): Promise<AvailableDatasetReport> {
    if (!deps.store.scheduledSession) throw new Error("Attendance report store is unavailable.");
    const status = request.filters.status;
    const records = await deps.store.scheduledSession.findMany({
      where: {
        cohort: cohortWhere(request),
        startsAt: dateWhere(request.filters, request.asOf),
        cancelledAt: null,
        ...(status === "MISSING" ? { attendanceExpected: true, attendance: { none: {} } } : {}),
        ...(status === "RECORDED" ? { attendance: { some: {} } } : {}),
        ...(status && !["MISSING", "RECORDED"].includes(status) ? { attendance: { some: { state: status } } } : {}),
      },
      select: { id: true, title: true, startsAt: true, attendanceExpected: true, cancelledAt: true, cohort: { select: { id: true, title: true } }, attendance: { select: { id: true, state: true }, orderBy: [{ id: "asc" }] } },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      take: MAX_REPORT_ROWS + 1,
    });
    assertBounded(records);
    const complete = stableBusinessRows(records.map((record): AttendanceReportRow => {
      const stateCounts = Object.fromEntries(countBy(record.attendance, (attendance) => attendance.state));
      return Object.freeze({ kind: "attendance", id: record.id, sessionTitle: record.title, cohortTitle: record.cohort.title, businessDate: record.startsAt, expected: record.attendanceExpected, totalRecords: record.attendance.length, stateCounts: Object.freeze(stateCounts) });
    }));
    const recorded = complete.filter((row) => row.totalRecords > 0).length;
    const missing = complete.filter((row) => row.expected && row.totalRecords === 0).length;
    const metrics: ReportMetric[] = [
      { id: "sessions", label: "Sessions in range", value: complete.length, format: "COUNT", href: drillDownHref("attendance", request.filters) },
      { id: "recorded", label: "Sessions with registers", value: recorded, format: "COUNT", href: drillDownHref("attendance", request.filters, { status: "RECORDED" }) },
      { id: "missing-registers", label: "Missing registers", value: missing, format: "COUNT", href: drillDownHref("attendance", request.filters, { status: "MISSING" }) },
    ];
    const allStates = new Map<string, number>();
    for (const row of complete) for (const state of Object.keys(row.stateCounts)) allStates.set(state, (allStates.get(state) ?? 0) + 1);
    const breakdown = ["PRESENT", "LATE", "ABSENT", "EXCUSED", "NOT_RECORDED"].map((state) => ({ id: state, label: state.replaceAll("_", " "), value: allStates.get(state) ?? 0, href: drillDownHref("attendance", request.filters, { status: state }) }));
    const { options, sectionErrors } = await dashboardOptions(request);
    return Object.freeze({ available: true, definition: getReportDefinition("attendance"), request, lastRefreshed: request.asOf, metrics: Object.freeze(metrics), breakdown: Object.freeze(breakdown), rows: Object.freeze(paginateRows(complete, request.filters)), totalRows: complete.length, page: request.filters.page ?? 1, pageSize: request.filters.pageSize ?? 25, options, sectionErrors });
  }

  async function getDatasetReport(dataset: ReportDataset, rawFilters: unknown = {}): Promise<DatasetReport> {
    const request = await normalizeRequest(dataset, rawFilters);
    return projectDatasetReport(dataset, request);
  }

  async function projectDatasetReport(dataset: ReportDataset, request: NormalizedReportRequest): Promise<DatasetReport> {
    const definition = getReportDefinition(dataset);
    if (definition.availability === "NOT_AVAILABLE_YET") {
      return Object.freeze({ available: false, definition, request, lastRefreshed: request.asOf });
    }
    switch (dataset) {
      case "registrations": return registrationsReport(request);
      case "payments": return paymentsReport(request);
      case "enrolments": return enrolmentsReport(request);
      case "attendance": return attendanceReport(request);
      default: return Object.freeze({ available: false, definition, request, lastRefreshed: request.asOf });
    }
  }

  // Server-only export seam: reuse the exact dashboard projection, but return
  // the complete bounded set before presentation pagination. Callers inject a
  // transaction-backed store, frozen clock, and already-authorized scope.
  async function getExportDatasetRows(dataset: ReportDataset, rawFilters: unknown = {}): Promise<readonly ReportRow[]> {
    const request = await normalizeRequest(dataset, rawFilters);
    const exportRequest: NormalizedReportRequest = {
      ...request,
      filters: { ...request.filters, page: 1, pageSize: MAX_REPORT_ROWS },
    };
    const report = await projectDatasetReport(dataset, exportRequest);
    if (!report.available) throw new Error("This report is not available for export.");
    return report.rows;
  }

  async function getReconciliationRefundRows(rawFilters: unknown = {}): Promise<readonly ReconciliationRefundRow[]> {
    if (!deps.store.refund) throw new Error("Refund report store is unavailable.");
    const filters = normalizeFilters(rawFilters);
    const authorization = await deps.authorizeCollection("payments.view");
    const asOf = now();
    const selectedStatus = filters.status;
    const refundRows = await deps.store.refund.findMany({
      where: {
        order: { cohort: { AND: [authorization.cohortWhere, filters.programmeId ? { programmeId: filters.programmeId } : {}, filters.cohortId ? { id: filters.cohortId } : {}] } },
        createdAt: dateWhere(filters, asOf),
        ...(filters.provider ? { provider: filters.provider } : {}),
        ...(filters.currency ? { currency: filters.currency } : {}),
        ...(selectedStatus ? { status: selectedStatus } : {}),
      },
      select: { id: true, orderId: true, paymentAttemptId: true, provider: true, currency: true, amountMinor: true, status: true, providerRef: true, createdAt: true, completedAt: true, order: { select: { reference: true, cohort: { select: { id: true } } } }, paymentAttempt: { select: { exceptionNote: true } }, reconciliationCases: { select: { risk: true, status: true }, orderBy: [{ openedAt: "desc" }, { id: "desc" }] } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: MAX_REPORT_ROWS + 1,
    });
    assertBounded(refundRows);
    return Object.freeze(refundRows.map((refundRecord) => Object.freeze({ id: refundRecord.id, orderId: refundRecord.orderId, orderReference: refundRecord.order.reference, paymentAttemptId: refundRecord.paymentAttemptId, provider: refundRecord.provider, currency: refundRecord.currency, amountMinor: refundRecord.amountMinor, status: refundRecord.status, providerReference: refundRecord.providerRef, businessDate: refundRecord.createdAt, exceptionContext: refundRecord.paymentAttempt.exceptionNote ?? (refundRecord.reconciliationCases[0] ? `${refundRecord.reconciliationCases[0].risk} (${refundRecord.reconciliationCases[0].status})` : null) })));
  }

  async function getHubOverview(rawFilters: unknown = {}): Promise<HubOverview> {
    const request = await normalizeRequest("registrations", rawFilters);
    const scopedCohort = cohortWhere(request);
    const date = dateWhere(request.filters, request.asOf);

    const [registrations, activeEnrolments, unresolvedPaymentExceptions, paymentGroups] =
      await Promise.all([
        deps.store.order.count({
          where: { cohort: scopedCohort, createdAt: date },
        }),
        deps.store.enrolment.count({
          where: { cohort: scopedCohort, status: "ACTIVE", activatedAt: date },
        }),
        deps.store.reconciliationCase.count({
          where: {
            status: { in: ["OPEN", "REOPENED"] },
            openedAt: date,
            OR: [
              { paymentAttempt: { order: { cohort: scopedCohort } } },
              { refund: { paymentAttempt: { order: { cohort: scopedCohort } } } },
            ],
          },
        }),
        deps.store.order.groupBy({
          by: ["currency"],
          where: {
            cohort: scopedCohort,
            paidAt: date,
            status: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED", "EXCEPTION"] },
            ...(request.filters.provider ? { selectedProvider: request.filters.provider } : {}),
            ...(request.filters.currency ? { currency: request.filters.currency } : {}),
          },
          _sum: { amountMinor: true },
          orderBy: { currency: "asc" },
        }),
      ]);

    const totals: { NGN: number | null; USD: number | null } = { NGN: 0, USD: 0 };
    for (const paymentGroup of paymentGroups) {
      if (paymentGroup.currency === "NGN" || paymentGroup.currency === "USD") {
        totals[paymentGroup.currency] = paymentGroup._sum.amountMinor;
      }
    }

    return Object.freeze({
      request,
      lastRefreshed: request.asOf,
      headlines: Object.freeze({
        registrations,
        activeEnrolments,
        unresolvedPaymentExceptions,
        paymentTotals: Object.freeze(totals),
      }),
    });
  }

  async function getScopedFilterOptions(rawFilters: unknown = {}) {
    const request = await normalizeRequest("registrations", rawFilters);
    return optionsForRequest(request);
  }

  return {
    normalizeRequest,
    getHubOverview,
    getScopedFilterOptions,
    getDatasetReport,
    getExportDatasetRows,
    getReconciliationRefundRows,
  };
}

export const reportQueryService = createReportQueryService({
  store: prisma as unknown as ReportQueryStore,
  authorizeCollection: liveAuthorizeCollection,
});
