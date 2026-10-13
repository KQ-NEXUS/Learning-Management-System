/**
 * Local email capture server for the browser journey (Phase 15, plan 15-15;
 * D-08, RESEARCH A3 and Pitfall 8).
 *
 * The application's Brevo client is pointed here through `BREVO_API_BASE_URL`
 * (accepted for a loopback host only). The server answers the SDK's
 * `POST /smtp/email` with a message id and keeps each payload in memory:
 *
 *   GET /messages?to=<address>  JSON list of captured messages for an address
 *   GET /inbox                  plain HTML list with links, for a manual run
 *   GET /health                 liveness for the Playwright webServer check
 *
 * Nothing is written to disk and nothing is forwarded anywhere. Run it with
 * `npx tsx e2e/support/email-capture-server.ts`.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export type CapturedMessage = {
  id: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  receivedAt: string;
};

const MAX_BODY_BYTES = 1_000_000;
const MAX_MESSAGES = 500;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Every http(s) link in an email body, in order, de-duplicated. */
export function extractLinks(html: string, text: string): string[] {
  const found: string[] = [];
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) found.push(match[1].replace(/&amp;/g, "&"));
  for (const match of text.matchAll(/https?:\/\/[^\s<>"')]+/gi)) found.push(match[0]);
  return [...new Set(found.filter((link) => /^https?:\/\//i.test(link)))];
}

function readBody(request: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        resolve(null);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", () => resolve(null));
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

export function createCaptureHandler(store: CapturedMessage[]) {
  let counter = 0;

  return async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://localhost");

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { status: "ok", captured: store.length });
      return;
    }

    if (request.method === "POST" && url.pathname === "/smtp/email") {
      const raw = await readBody(request);
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(raw ?? "") as Record<string, unknown>;
      } catch {
        sendJson(response, 400, { code: "invalid_parameter", message: "Body is not JSON." });
        return;
      }
      const recipients = Array.isArray(payload.to) ? (payload.to as { email?: unknown }[]) : [];
      counter += 1;
      const id = `<capture-${counter}@localhost>`;
      for (const recipient of recipients) {
        if (typeof recipient?.email !== "string") continue;
        store.push({
          id,
          to: recipient.email,
          subject: typeof payload.subject === "string" ? payload.subject : "",
          html: typeof payload.htmlContent === "string" ? payload.htmlContent : "",
          text: typeof payload.textContent === "string" ? payload.textContent : "",
          receivedAt: new Date().toISOString(),
        });
      }
      while (store.length > MAX_MESSAGES) store.shift();
      sendJson(response, 201, { messageId: id });
      return;
    }

    if (request.method === "GET" && url.pathname === "/messages") {
      const to = (url.searchParams.get("to") ?? "").trim().toLowerCase();
      const messages = store.filter((message) => to === "" || message.to.toLowerCase() === to);
      sendJson(response, 200, messages);
      return;
    }

    if (request.method === "GET" && url.pathname === "/inbox") {
      const rows = [...store]
        .reverse()
        .map((message) => {
          const links = extractLinks(message.html, message.text)
            .map((link) => `<li><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></li>`)
            .join("");
          return `<li><p><strong>${escapeHtml(message.subject)}</strong><br>To ${escapeHtml(message.to)} at ${escapeHtml(
            message.receivedAt,
          )}</p><ul>${links}</ul></li>`;
        })
        .join("");
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Captured email</title></head>` +
          `<body><h1>Captured email</h1>${store.length === 0 ? "<p>No email captured yet.</p>" : `<ol>${rows}</ol>`}</body></html>`,
      );
      return;
    }

    sendJson(response, 404, { message: "Not found." });
  };
}

/**
 * Listens on both loopback addresses so `localhost` works whichever address the
 * caller resolves it to. Only loopback: the server is never reachable from the
 * network.
 */
export function startCaptureServer(port: number): Server[] {
  const handler = createCaptureHandler([]);
  const servers: Server[] = [];
  for (const host of ["127.0.0.1", "::1"]) {
    const server = createServer((request, response) => {
      handler(request, response).catch(() => {
        if (!response.headersSent) sendJson(response, 500, { message: "Capture server error." });
      });
    });
    server.on("error", (error: NodeJS.ErrnoException) => {
      // The IPv6 loopback may be unavailable; the IPv4 listener still serves.
      if (host === "::1" && (error.code === "EADDRNOTAVAIL" || error.code === "EAFNOSUPPORT")) return;
      console.error(`email capture server (${host}) failed: ${error.code ?? error.name}`);
      process.exit(1);
    });
    server.listen(port, host);
    servers.push(server);
  }
  return servers;
}

if (process.argv[1] && /email-capture-server\.(ts|js|cjs|mjs)$/.test(process.argv[1].replace(/\\/g, "/"))) {
  const port = Number(process.env.CAPTURE_PORT ?? 4010);
  startCaptureServer(port);
  console.log(`email capture server listening on port ${port}`);
}
