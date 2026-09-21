"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { authorizeCollection, cohortWhereForCollection } from "@/server/permissions/collection-scope";
import { getExportDatasetDefinition, isExportDataset } from "@/server/services/report-registry";
import { exportService, ExportRequestError } from "@/server/services/export-service";

const requestSchema = z.object({
  dataset: z.string().refine(isExportDataset),
  filters: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  columns: z.array(z.string().min(1)).max(32).optional(),
  reason: z.string().max(2000).optional(),
  asOf: z.iso.datetime(),
  idempotencyKey: z.string().min(8).max(128).optional(),
}).strict();
const jobSchema = z.object({ jobId: z.string().min(1).max(128) }).strict();
export type ExportActionResult = { ok: true; jobId: string; status: string } | { ok: false; message: string };

function safeFailure(error: unknown): ExportActionResult {
  if (error instanceof AuthenticationError || error instanceof AuthorizationError) return { ok: false, message: "You are not authorised to export this dataset." };
  if (error instanceof ExportRequestError) return { ok: false, message: error.message };
  console.error("Export request failed", error);
  return { ok: false, message: "Export not queued. Your report and choices are unchanged." };
}

export async function requestReportExportAction(input: unknown): Promise<ExportActionResult> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Export not queued. Check the options and try again." };
  try {
    const result = await exportService.requestExport(parsed.data);
    revalidatePath("/staff/reports/exports", "page");
    return { ok: true, jobId: result.jobId, status: result.status };
  } catch (error) { return safeFailure(error); }
}

export async function retryExportAction(input: unknown): Promise<ExportActionResult> {
  const parsed = jobSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid export request." };
  try {
    const result = await exportService.retryExport(parsed.data.jobId);
    revalidatePath("/staff/reports/exports", "page");
    return { ok: true, jobId: result.jobId, status: result.status };
  } catch (error) { return safeFailure(error); }
}

export async function rerunExportAction(input: unknown): Promise<ExportActionResult> {
  const parsed = jobSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Invalid export request." };
  try {
    const result = await exportService.rerunExpiredExport(parsed.data.jobId);
    revalidatePath("/staff/reports/exports", "page");
    return { ok: true, jobId: result.jobId, status: result.status };
  } catch (error) { return safeFailure(error); }
}

/** Read-only capability hint for presentation. Request action rechecks every
 * grant in its transaction; this response confers no authority. */
export async function permittedSensitiveColumnsAction(dataset: string): Promise<string[]> {
  if (!isExportDataset(dataset)) return [];
  if (dataset === "attendance") return [];
  try {
    const definition = getExportDatasetDefinition(dataset);
    const [domain, exporting, identity] = await Promise.all([authorizeCollection(definition.permission), authorizeCollection(dataset === "audit" ? "audit.export" : "reports.export"), authorizeCollection("users.view")]);
    if (domain.actor.userId !== identity.actor.userId || domain.actor.userId !== exporting.actor.userId) return [];
    if (domain.scope.kind === "GLOBAL" && identity.scope.kind !== "GLOBAL") return [];
    if (domain.scope.kind === "GLOBAL" && exporting.scope.kind !== "GLOBAL") return [];
    if (domain.scope.kind === "LIMITED" && identity.scope.kind === "LIMITED") {
      // The write path applies the authoritative cohort check. This hint is
      // deliberately conservative when grants differ.
      if (JSON.stringify(cohortWhereForCollection(domain.scope)) !== JSON.stringify(cohortWhereForCollection(identity.scope))) return [];
    }
    if (domain.scope.kind === "LIMITED" && exporting.scope.kind === "LIMITED" && JSON.stringify(cohortWhereForCollection(domain.scope)) !== JSON.stringify(cohortWhereForCollection(exporting.scope))) return [];
    return definition.sensitiveColumns.map((column) => column.key);
  } catch { return []; }
}
