import type {
  AvailableDatasetReport,
  DatasetReport,
  UnavailableDatasetReport,
} from "@/server/services/report-query-service";
import type { ReportDefinition } from "@/server/services/report-registry";

export type ClientReportDefinition = Omit<ReportDefinition, "filterSchema">;

export type ClientAvailableDatasetReport = Omit<AvailableDatasetReport, "definition"> &
  Readonly<{ definition: ClientReportDefinition }>;

export type ClientUnavailableDatasetReport = Omit<UnavailableDatasetReport, "definition"> &
  Readonly<{ definition: ClientReportDefinition }>;

export type ClientDatasetReport =
  | ClientAvailableDatasetReport
  | ClientUnavailableDatasetReport;

export function toClientDatasetReport(report: DatasetReport): ClientDatasetReport {
  const { filterSchema: executableFilterSchema, ...definition } = report.definition;
  void executableFilterSchema;

  return Object.freeze({
    ...report,
    definition: Object.freeze(definition),
  }) as ClientDatasetReport;
}
