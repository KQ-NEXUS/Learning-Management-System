/**
 * Upload diagnostic for the staging journey (Phase 15, plan 15-30).
 *
 * OFF unless STAGING_UPLOAD_DIAG=1. A browser hides the storage service's answer
 * to a refused presigned PUT (the answer has no CORS header). With the switch on,
 * the journey's own PUT to the storage host is sent from Node instead
 * (`route.fetch()`, where CORS does not apply), a few facts about the answer are
 * recorded, and the answer is handed back to the page unchanged.
 *
 * Recorded: status, header NAMES, whether Access-Control-Allow-Origin is there,
 * content type, and from an XML error body only <Code> and <Message>, masked.
 * Never recorded: the link, its values, the host, the key path, any header value
 * other than the content type.
 *
 * A run with the switch on is NOT proof that uploads work: the page gets its
 * answer through the route, not from a real cross-origin request.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

const STORAGE_HOST = /\.r2\.cloudflarestorage\.com$/i;

/** Removes anything that could identify the bucket, the account, a key or a signature. */
export function maskStorageText(text: string): string {
  return text
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[url]")
    .replace(/[a-z0-9.-]+\.r2\.cloudflarestorage\.com/gi, "[host]")
    .replace(/(?:\/[\w.%~+-]+){2,}/g, "[path]")
    .replace(/\b[0-9a-f]{16,}\b/gi, "[id]")
    .replace(/\b[A-Za-z0-9+/=_-]{24,}\b/g, "[value]")
    .slice(0, 300);
}

function xmlTag(body: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i").exec(body);
  return match ? maskStorageText(match[1].trim()) : null;
}

export async function recordStorageUploads(page: Page, outFile: string): Promise<void> {
  if (process.env.STAGING_UPLOAD_DIAG !== "1") return;
  const records: unknown[] = [];

  await page.route(
    (url) => STORAGE_HOST.test(url.hostname),
    async (route) => {
      const request = route.request();
      if (request.method() !== "PUT") return route.continue();

      const url = new URL(request.url());
      const requestHeaders = await request.allHeaders();
      const record: Record<string, unknown> = {
        at: new Date().toISOString(),
        method: "PUT",
        sentFrom: "Node (route.fetch), not the browser",
        requestHeaderNames: Object.keys(requestHeaders).sort(),
        requestContentType: requestHeaders["content-type"] ?? null,
        requestBodyBytes: request.postDataBuffer()?.length ?? null,
        queryParameterNames: [...new Set(url.searchParams.keys())].sort(),
        signedHeaders: url.searchParams.get("X-Amz-SignedHeaders"),
        hostLabels: url.hostname.split(".").length,
        pathSegments: url.pathname.split("/").filter(Boolean).length,
      };

      try {
        const response = await route.fetch();
        const headers = response.headers();
        const contentType = headers["content-type"] ?? null;
        record.status = response.status();
        record.responseHeaderNames = Object.keys(headers).sort();
        record.allowOriginPresent = "access-control-allow-origin" in headers;
        record.responseContentType = contentType;
        if (response.status() >= 300) {
          const body = await response.text();
          record.responseBodyBytes = body.length;
          record.errorCode = xmlTag(body, "Code");
          record.errorMessage = xmlTag(body, "Message");
        }
        records.push(record);
        await route.fulfill({ response });
      } catch (error) {
        record.fetchError = maskStorageText(error instanceof Error ? error.message : String(error));
        records.push(record);
        await route.abort();
      } finally {
        mkdirSync(path.dirname(outFile), { recursive: true });
        writeFileSync(outFile, `${JSON.stringify(records, null, 2)}\n`, "utf8");
      }
    },
  );
}
