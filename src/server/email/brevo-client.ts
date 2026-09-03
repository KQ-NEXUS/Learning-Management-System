/**
 * Outbound transactional email transport (D-01).
 *
 * A minimal send wrapper — not Phase 13's templating and deduplication
 * system. Sender identity is read from environment variables so it is one
 * config value to change later, never a scattered string literal (D-04).
 *
 * This module must not import `@prisma/client` — `eslint.config.mjs` confines
 * that import to `src/server/services/**` and `src/server/db.ts`.
 */

import { BrevoClient, BrevoError, BrevoTimeoutError, Brevo } from "@getbrevo/brevo";

export type TransactionalEmailPayload = {
  sender: { name: string; email: string };
  to: { email: string }[];
  subject: string;
  textContent: string;
};

export function buildTransactionalEmailPayload(params: {
  to: string;
  subject: string;
  textContent: string;
  senderName: string;
  senderAddress: string;
}): TransactionalEmailPayload {
  return {
    sender: { name: params.senderName, email: params.senderAddress },
    to: [{ email: params.to }],
    subject: params.subject,
    textContent: params.textContent,
  };
}

/** Maps the SDK's error classes to a short operator-facing string. Never includes the credential or a raw link token. */
export function describeBrevoFailure(error: unknown): string {
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

export async function sendTransactionalEmail(params: {
  to: string;
  subject: string;
  textContent: string;
}): Promise<{ providerMessageId: string | null }> {
  const senderName = process.env.EMAIL_SENDER_NAME ?? "Professional Training LMS";
  const senderAddress = process.env.EMAIL_SENDER_ADDRESS ?? "no-reply@example.com";
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    throw new Error("BREVO_API_KEY is not configured.");
  }

  const payload = buildTransactionalEmailPayload({
    to: params.to,
    subject: params.subject,
    textContent: params.textContent,
    senderName,
    senderAddress,
  });

  const client = new BrevoClient({ apiKey });

  try {
    const response = await client.transactionalEmails.sendTransacEmail(payload);
    return { providerMessageId: response.messageId ?? null };
  } catch (error) {
    // Rethrow after describing — a send failure must never let the caller
    // report success. describeBrevoFailure is for the caller's own logging;
    // this function never logs the raw error itself (it could carry the
    // recipient address or request body).
    throw error;
  }
}
