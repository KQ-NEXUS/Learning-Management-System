import { createHash, timingSafeEqual } from "node:crypto";
import type { Config } from "@netlify/functions";
import { runProcessExportJobsTask } from "../../src/server/scheduled/process-export-jobs-task";

function secretMatches(actual: string | null, expected: string): boolean {
  if (!actual || !expected) return false;
  const actualHash = createHash("sha256").update(actual).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}

async function hasConstantBody(request: Request): Promise<boolean> {
  const reader = request.body?.getReader();
  if (!reader) return false;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 32) { await reader.cancel(); return false; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim() === "{}"; }
  catch { return false; }
}

export function createProcessExportJobsHandler({ secret, run }: { secret: string; run: () => Promise<void> }) {
  return async function processExportJobs(request: Request): Promise<Response> {
    const deny = () => new Response(null, { status: 404 });
    if (!secretMatches(request.headers.get("x-export-dispatch-secret"), secret)) return deny();
    if (request.method !== "POST" || new URL(request.url).search) return deny();
    if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") return deny();
    if (request.headers.get("content-length") && Number(request.headers.get("content-length")) > 32) return deny();
    if (!(await hasConstantBody(request))) return deny();
    await run();
    return new Response(null, { status: 204 });
  };
}

export default createProcessExportJobsHandler({
  secret: process.env.EXPORT_DISPATCH_SECRET ?? "",
  run: runProcessExportJobsTask,
});

export const config: Config = { background: true };
