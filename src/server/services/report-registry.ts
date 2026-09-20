import { z, type ZodType } from "zod";
import type { Permission } from "@/server/permissions/catalogue";

export const REPORT_DATASETS = Object.freeze([
  "registrations",
  "payments",
  "enrolments",
  "attendance",
  "progress",
  "submissions",
  "grades",
  "completion",
  "certificates",
  "support",
] as const);

export type ReportDataset = (typeof REPORT_DATASETS)[number];
export type ExportDataset = ReportDataset | "reconciliation-refunds" | "audit";
export type ReportGroup = "ADMISSIONS_FINANCE" | "LEARNING_DELIVERY" | "OUTCOMES_SUPPORT";
export type ReportAvailability = "AVAILABLE" | "NOT_AVAILABLE_YET";
export type ReportScopePolicy = "COLLECTION" | "GLOBAL";

export type ReportColumn = Readonly<{
  key: string;
  label: string;
  valueType: "TEXT" | "DATE" | "INTEGER" | "MONEY_MINOR";
  permission?: "users.view";
}>;

export type ReportDefinition = Readonly<{
  id: ReportDataset;
  version: string;
  label: string;
  group: ReportGroup;
  availability: ReportAvailability;
  permission: Permission;
  scopePolicy: "COLLECTION";
  definition: string;
  businessDateLabel: string;
  unavailableReason?: string;
  drillDownPath: `/staff/reports/${ReportDataset}`;
  filterSchema: ZodType;
  safeColumns: readonly ReportColumn[];
  sensitiveColumns: readonly ReportColumn[];
}>;

export type ExportDefinition = Readonly<{
  id: ExportDataset;
  version: string;
  permission: Permission;
  scopePolicy: ReportScopePolicy;
  filterSchema: ZodType;
  safeColumns: readonly ReportColumn[];
  sensitiveColumns: readonly ReportColumn[];
}>;

const optionalId = z.string().trim().min(1).max(128).optional();
const reportFilters = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    programmeId: optionalId,
    cohortId: optionalId,
    provider: z.enum(["PAYSTACK", "STRIPE", "MANUAL"]).optional(),
    currency: z.enum(["NGN", "USD"]).optional(),
  })
  .strict();
const auditFilters = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    actorId: optionalId,
    action: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

const identityColumns = Object.freeze([
  Object.freeze({ key: "learnerName", label: "Learner", valueType: "TEXT" as const, permission: "users.view" as const }),
  Object.freeze({ key: "learnerEmail", label: "Learner email", valueType: "TEXT" as const, permission: "users.view" as const }),
]);

function safe(...columns: Array<[string, string, ReportColumn["valueType"]]>): readonly ReportColumn[] {
  return Object.freeze(columns.map(([key, label, valueType]) => Object.freeze({ key, label, valueType })));
}

function report(
  definition: Omit<ReportDefinition, "version" | "scopePolicy" | "drillDownPath" | "filterSchema">,
): ReportDefinition {
  return Object.freeze({
    ...definition,
    version: "1.0",
    scopePolicy: "COLLECTION",
    drillDownPath: `/staff/reports/${definition.id}`,
    filterSchema: reportFilters,
  });
}

export const REPORT_REGISTRY: readonly ReportDefinition[] = Object.freeze([
  report({
    id: "registrations",
    label: "Registrations",
    group: "ADMISSIONS_FINANCE",
    availability: "AVAILABLE",
    permission: "reports.view",
    definition: "Learners registered during the selected registration-date range.",
    businessDateLabel: "Registration date",
    safeColumns: safe(["id", "Registration", "TEXT"], ["registeredAt", "Registered", "DATE"], ["status", "Verification", "TEXT"]),
    sensitiveColumns: identityColumns,
  }),
  report({
    id: "payments",
    label: "Payments",
    group: "ADMISSIONS_FINANCE",
    availability: "AVAILABLE",
    permission: "reports.view",
    definition: "Confirmed learner payments grouped by provider and exact currency.",
    businessDateLabel: "Payment confirmation date",
    safeColumns: safe(["reference", "Reference", "TEXT"], ["confirmedAt", "Confirmed", "DATE"], ["amountMinor", "Learner total", "MONEY_MINOR"], ["currency", "Currency", "TEXT"]),
    sensitiveColumns: identityColumns,
  }),
  report({
    id: "enrolments",
    label: "Enrolments",
    group: "ADMISSIONS_FINANCE",
    availability: "AVAILABLE",
    permission: "reports.view",
    definition: "Learner enrolment states using activation and transition dates.",
    businessDateLabel: "Enrolment activation/transition date",
    safeColumns: safe(["id", "Enrolment", "TEXT"], ["activatedAt", "Activated", "DATE"], ["status", "Status", "TEXT"]),
    sensitiveColumns: identityColumns,
  }),
  report({
    id: "attendance",
    label: "Attendance",
    group: "LEARNING_DELIVERY",
    availability: "AVAILABLE",
    permission: "reports.view",
    definition: "Attendance registers and outcomes for sessions in the selected range.",
    businessDateLabel: "Session date",
    safeColumns: safe(["sessionId", "Session", "TEXT"], ["sessionDate", "Session date", "DATE"], ["state", "Attendance", "TEXT"]),
    sensitiveColumns: identityColumns,
  }),
  report({
    id: "progress",
    label: "Progress",
    group: "LEARNING_DELIVERY",
    availability: "NOT_AVAILABLE_YET",
    permission: "reports.view",
    definition: "Authoritative learner progress events across assigned content.",
    businessDateLabel: "Progress event date",
    unavailableReason: "learning delivery starts collecting authoritative progress events",
    safeColumns: safe(["eventId", "Progress event", "TEXT"], ["occurredAt", "Occurred", "DATE"]),
    sensitiveColumns: identityColumns,
  }),
  report({
    id: "submissions",
    label: "Submissions",
    group: "LEARNING_DELIVERY",
    availability: "NOT_AVAILABLE_YET",
    permission: "reports.view",
    definition: "Assessment submissions received during the selected range.",
    businessDateLabel: "Submission date",
    unavailableReason: "assessment delivery starts collecting authoritative submissions",
    safeColumns: safe(["submissionId", "Submission", "TEXT"], ["submittedAt", "Submitted", "DATE"]),
    sensitiveColumns: identityColumns,
  }),
  report({
    id: "grades",
    label: "Grades",
    group: "LEARNING_DELIVERY",
    availability: "NOT_AVAILABLE_YET",
    permission: "reports.view",
    definition: "Released assessment grades and outcomes.",
    businessDateLabel: "Grade release date",
    unavailableReason: "assessment grading starts releasing authoritative grades",
    safeColumns: safe(["gradeId", "Grade", "TEXT"], ["releasedAt", "Released", "DATE"]),
    sensitiveColumns: identityColumns,
  }),
  report({
    id: "completion",
    label: "Completion",
    group: "OUTCOMES_SUPPORT",
    availability: "NOT_AVAILABLE_YET",
    permission: "reports.view",
    definition: "Authoritative course and programme completion outcomes.",
    businessDateLabel: "Completion date",
    unavailableReason: "the completion engine starts recording authoritative outcomes",
    safeColumns: safe(["completionId", "Completion", "TEXT"], ["completedAt", "Completed", "DATE"]),
    sensitiveColumns: identityColumns,
  }),
  report({
    id: "certificates",
    label: "Certificates",
    group: "OUTCOMES_SUPPORT",
    availability: "NOT_AVAILABLE_YET",
    permission: "reports.view",
    definition: "Certificates issued for completed learning obligations.",
    businessDateLabel: "Certificate issue date",
    unavailableReason: "certificate issuance starts recording authoritative certificates",
    safeColumns: safe(["certificateId", "Certificate", "TEXT"], ["issuedAt", "Issued", "DATE"]),
    sensitiveColumns: identityColumns,
  }),
  report({
    id: "support",
    label: "Support",
    group: "OUTCOMES_SUPPORT",
    availability: "NOT_AVAILABLE_YET",
    permission: "reports.view",
    definition: "Support tickets opened during the selected range.",
    businessDateLabel: "Ticket creation date",
    unavailableReason: "support operations start collecting authoritative tickets",
    safeColumns: safe(["ticketId", "Ticket", "TEXT"], ["createdAt", "Created", "DATE"], ["status", "Status", "TEXT"]),
    sensitiveColumns: identityColumns,
  }),
]);

const reportExportDefinitions = REPORT_REGISTRY.map((definition): ExportDefinition =>
  Object.freeze({
    id: definition.id,
    version: definition.version,
    permission: definition.permission,
    scopePolicy: definition.scopePolicy,
    filterSchema: definition.filterSchema,
    safeColumns: definition.safeColumns,
    sensitiveColumns: definition.sensitiveColumns,
  }),
);

export const EXPORT_DATASET_REGISTRY: readonly ExportDefinition[] = Object.freeze([
  ...reportExportDefinitions,
  Object.freeze({
    id: "reconciliation-refunds" as const,
    version: "1.0",
    permission: "payments.view" as const,
    scopePolicy: "COLLECTION" as const,
    filterSchema: reportFilters,
    safeColumns: safe(["reference", "Reference", "TEXT"], ["occurredAt", "Occurred", "DATE"], ["amountMinor", "Amount", "MONEY_MINOR"], ["currency", "Currency", "TEXT"]),
    sensitiveColumns: identityColumns,
  }),
  Object.freeze({
    id: "audit" as const,
    version: "1.0",
    permission: "audit.view" as const,
    scopePolicy: "GLOBAL" as const,
    filterSchema: auditFilters,
    safeColumns: safe(["eventId", "Event", "TEXT"], ["createdAt", "Created", "DATE"], ["actorType", "Actor type", "TEXT"], ["action", "Action", "TEXT"], ["targetType", "Target type", "TEXT"], ["targetId", "Target", "TEXT"], ["outcome", "Outcome", "TEXT"], ["correlationId", "Correlation", "TEXT"], ["context", "Changed fields", "TEXT"]),
    sensitiveColumns: identityColumns.map((column) => Object.freeze({ ...column, key: column.key === "learnerName" ? "actorName" : "actorEmail", label: column.key === "learnerName" ? "Actor name" : "Actor email" })),
  }),
]);

const reportById = new Map(REPORT_REGISTRY.map((definition) => [definition.id, definition]));
const exportById = new Map(EXPORT_DATASET_REGISTRY.map((definition) => [definition.id, definition]));

export function isReportDataset(value: string): value is ReportDataset {
  return reportById.has(value as ReportDataset);
}

export function isExportDataset(value: string): value is ExportDataset {
  return exportById.has(value as ExportDataset);
}

export function getReportDefinition(value: string): ReportDefinition {
  const definition = reportById.get(value as ReportDataset);
  if (!definition) throw new Error(`Unknown report dataset: ${value}`);
  return definition;
}

export function getExportDatasetDefinition(value: string): ExportDefinition {
  const definition = exportById.get(value as ExportDataset);
  if (!definition) throw new Error(`Unknown export dataset: ${value}`);
  return definition;
}
