"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { exportService, ExportRequestError } from "@/server/services/export-service";
import {
  assignReconciliationCases,
  resolveReconciliationCase,
} from "@/server/services/reconciliation-case-service";

export type ReconciliationActionResult =
  | { ok: true }
  | { ok: false; message: string };

const assignmentSchema = z.object({
  caseIds: z.array(z.string().trim().min(1)).min(1).max(100),
  assigneeId: z.string().trim().min(1).nullable(),
}).strict();

const resolutionSchema = z.object({
  caseId: z.string().trim().min(1),
  reason: z.enum([
    "MATCHED_PROVIDER_EVIDENCE",
    "CORRECTED_UPSTREAM",
    "DUPLICATE_RECORD",
    "ACCEPTED_VARIANCE",
    "OTHER",
  ]),
  note: z.string().trim().min(1).max(4000),
}).strict();

const refundExportSchema = z.object({
  filters: z.object({
    provider: z.enum(["STRIPE", "PAYSTACK", "MANUAL"]).optional(),
    currency: z.enum(["NGN", "USD"]).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    status: z.enum(["REQUESTED", "PROCESSING", "COMPLETED", "FAILED", "RECORDED_MANUALLY"]).optional(),
  }).strict(),
  columns: z.array(z.string().min(1)).min(1).max(32),
  reason: z.string().max(2000).optional(),
  asOf: z.iso.datetime(),
}).strict();

export type ReconciliationRefundExportResult =
  | { ok: true; jobId: string; status: string }
  | { ok: false; message: string };

export async function requestReconciliationRefundExportAction(input: unknown): Promise<ReconciliationRefundExportResult> {
  const parsed = refundExportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Export not queued. Check the options and try again." };
  try {
    const result = await exportService.requestExport({ dataset: "reconciliation-refunds", ...parsed.data });
    revalidatePath("/staff/reports/exports", "page");
    return { ok: true, jobId: result.jobId, status: result.status };
  } catch (error) {
    if (error instanceof AuthenticationError || error instanceof AuthorizationError) return { ok: false, message: "You are not authorised to export refunds." };
    if (error instanceof ExportRequestError) return { ok: false, message: error.message };
    console.error("Reconciliation refund export failed", error);
    return { ok: false, message: "Export not queued. Your filters and choices are unchanged." };
  }
}

function safeFailure(error: unknown): ReconciliationActionResult {
  if (error instanceof AuthenticationError || error instanceof AuthorizationError) {
    return { ok: false, message: "Your role does not permit this reconciliation action." };
  }
  if (error instanceof TypeError || (error instanceof Error && error.message.includes("permitted"))) {
    return { ok: false, message: error.message };
  }
  throw error;
}

export async function assignReconciliationCasesAction(
  input: z.input<typeof assignmentSchema>,
): Promise<ReconciliationActionResult> {
  const parsed = assignmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Select at least one valid case and assignee." };
  try {
    await assignReconciliationCases(parsed.data);
    revalidatePath("/staff/reconciliation", "page");
    for (const caseId of parsed.data.caseIds) {
      revalidatePath(`/staff/reconciliation/${caseId}`, "page");
    }
    return { ok: true };
  } catch (error) {
    return safeFailure(error);
  }
}

export async function resolveReconciliationCaseAction(
  input: z.input<typeof resolutionSchema>,
): Promise<ReconciliationActionResult> {
  const parsed = resolutionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Choose a resolution category and enter a case note." };
  }
  try {
    await resolveReconciliationCase(parsed.data);
    revalidatePath("/staff/reconciliation", "page");
    revalidatePath(`/staff/reconciliation/${parsed.data.caseId}`, "page");
    return { ok: true };
  } catch (error) {
    return safeFailure(error);
  }
}
