import { exportDownloadService } from "@/server/services/export-download-service";
import { ExportUnavailableError } from "@/server/services/export-read-service";

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }): Promise<Response> {
  const { jobId } = await context.params;
  try {
    const url = await exportDownloadService.getDownloadUrl(jobId);
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ExportUnavailableError) return new Response(
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Download unavailable</title></head><body><main><h1>Download unavailable</h1><p>The file may have expired or your access may have changed.</p><a href="/staff/reports/exports">Return to Export History</a></main></body></html>',
      { status: 404, headers: { "Cache-Control": "private, no-store", "Content-Type": "text/html; charset=utf-8" } },
    );
    throw error;
  }
}
