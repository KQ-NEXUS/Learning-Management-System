/**
 * Outbound transactional email transport (D-01).
 *
 * Sends html plus text with the one approved sender and Reply-To, both
 * resolved through `./config` on every call (no defaults, COM-04/D-14). Never
 * uses a Brevo-hosted template (D-13). `EMAIL_TRANSPORT=stub` short-circuits
 * to a `stub:`-prefixed provider id without contacting Brevo (D-24).
 *
 * This module must not import `@prisma/client` — `eslint.config.mjs` confines
 * that import to `src/server/services/**` and `src/server/db.ts`.
 */

import { randomUUID } from "node:crypto";
import { BrevoClient, BrevoError, BrevoTimeoutError, Brevo } from "@getbrevo/brevo";
import {
  EmailConfigError,
  getEmailTransportMode,
  getReplyTo,
  getSenderIdentity,
} from "@/server/email/config";

export type TransactionalEmailPayload = {
  sender: { name: string; email: string };
  replyTo?: { email: string; name?: string };
  to: { email: string }[];
  subject: string;
  htmlContent?: string;
  textContent: string;
  tags?: string[];
};

export function buildTransactionalEmailPayload(params: {
  to: string;
  subject: string;
  textContent: string;
  htmlContent?: string;
  replyTo?: { email: string; name?: string };
  tags?: string[];
  senderName: string;
  senderAddress: string;
}): TransactionalEmailPayload {
  const payload: TransactionalEmailPayload = {
    sender: { name: params.senderName, email: params.senderAddress },
    to: [{ email: params.to }],
    subject: params.subject,
    textContent: params.textContent,
  };
  if (params.replyTo) payload.replyTo = params.replyTo;
  if (params.htmlContent !== undefined) payload.htmlContent = params.htmlContent;
  if (params.tags && params.tags.length > 0) payload.tags = params.tags;
  return payload;
}

/** Maps the SDK's error classes to a short operator-facing string. Never includes the credential or a raw link token. */
export function describeBrevoFailure(error: unknown): string {
  if (error instanceof EmailConfigError) {
    return "Email is not configured correctly (configuration error).";
  }
  if (error instanceof Brevo.BadRequestError) {
    return `Brevo rejected the request (bad request)${error.statusCode ? ` [${error.statusCode}]` : ""}.`;
  }
  if (error instanceof BrevoTimeoutError) {
    return "Brevo request timed out.";
  }
  if (error instanceof BrevoError) {
    return `Brevo send failed${error.statusCode ? ` [${error.statusCode}]` : ""}.`;
  }
  return "Brevo send failed (unknown error).";
}

const PERMANENT_STATUSES = new Set([401, 403, 404, 422]);
const TRANSIENT_STATUSES = new Set([408, 425, 429]);

/** D-03: permanent failures are not retried; everything else is transient. */
export function classifyBrevoFailure(error: unknown): "permanent" | "transient" {
  if (error instanceof EmailConfigError) return "permanent";
  if (error instanceof Brevo.BadRequestError) return "permanent";
  if (error instanceof BrevoTimeoutError) return "transient";
  if (error instanceof BrevoError) {
    const status = error.statusCode;
    if (status !== undefined) {
      if (PERMANENT_STATUSES.has(status)) return "permanent";
      if (TRANSIENT_STATUSES.has(status) || status >= 500) return "transient";
      if (status >= 400) return "permanent";
    }
    return "transient";
  }
  return "transient";
}

export async function sendTransactionalEmail(params: {
  to: string;
  subject: string;
  textContent: string;
  htmlContent?: string;
  tags?: string[];
}): Promise<{ providerMessageId: string | null }> {
  // Resolved on every call, stub mode included: fail loud, no defaults (D-14).
  const sender = getSenderIdentity();
  const replyTo = getReplyTo();

  if (getEmailTransportMode() === "stub") {
    return { providerMessageId: `stub:${randomUUID()}` };
  }

  const apiKey = (process.env.BREVO_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new EmailConfigError("BREVO_API_KEY is not configured.");
  }

  const payload = buildTransactionalEmailPayload({
    to: params.to,
    subject: params.subject,
    textContent: params.textContent,
    htmlContent: params.htmlContent,
    replyTo,
    tags: params.tags,
    senderName: sender.name,
    senderAddress: sender.email,
  });

  const client = new BrevoClient({ apiKey });

  // A send failure must never let the caller report success. This function
  // never logs the raw error (it could carry the recipient or request body);
  // callers use describeBrevoFailure / classifyBrevoFailure.
  const response = await client.transactionalEmails.sendTransacEmail(payload);
  return { providerMessageId: response.messageId ?? null };
}
