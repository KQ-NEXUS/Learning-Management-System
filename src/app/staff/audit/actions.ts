"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { auditExportService } from "@/server/services/audit-export-service";
import { ExportRequestError } from "@/server/services/export-service";

const requestSchema = z.object({
  filters: z.object({
    actorId: z.string().max(128).optional(), action: z.string().max(128).optional(),
    from: z.iso.date().optional(), to: z.iso.date().optional(),
  }).strict(),
  columns: z.array(z.string().min(1).max(64)).min(1).max(16),
  reason: z.string().max(2000).optional(),
}).strict();

export type AuditExportActionResult = { ok: true; jobId: string; status: string } | { ok: false; message: string };

export async function requestAuditExportAction(input: unknown): Promise<AuditExportActionResult> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Export not queued. Check the options and try again." };
  try {
    const result = await auditExportService.requestAuditExport(parsed.data);
    revalidatePath("/staff/reports/exports", "page");
    return { ok: true, jobId: result.jobId, status: result.status };
  } catch (error) {
    if (error instanceof AuthenticationError || error instanceof AuthorizationError) return { ok: false, message: "You are not authorised to export audit events." };
    if (error instanceof ExportRequestError) return { ok: false, message: error.message };
    console.error("Audit export request failed", error);
    return { ok: false, message: "Export not queued. Your filters and choices are unchanged." };
  }
}
