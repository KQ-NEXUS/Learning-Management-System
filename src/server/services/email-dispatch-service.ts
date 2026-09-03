/**
 * EmailDispatch bookkeeping sink (D-17).
 *
 * A minimal observability record per send — queued, then sent or failed.
 * Deliberately does not implement Phase 13's deduplication-by-correlationId
 * semantics: a fresh correlation id is generated per dispatch rather than
 * derived from the verification/reset token, so this phase's sends never
 * collide with `EmailDispatch`'s unique (template, correlationId) constraint.
 * The raw token is never stored in any column here.
 */

import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db";
import { sendTransactionalEmail, describeBrevoFailure } from "@/server/email/brevo-client";

export type EmailDispatchRow = {
  id: string;
  template: string;
  toEmail: string;
  userId: string | null;
  correlationId: string;
  status: string;
  providerMessageId: string | null;
  sentAt: Date | null;
  failedAt: Date | null;
  error: string | null;
};

/** The narrow slice of the Prisma client this service actually uses. */
export type EmailDispatchStore = {
  emailDispatch: {
    create(args: { data: Record<string, unknown> }): Promise<EmailDispatchRow>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<EmailDispatchRow>;
  };
};

export function createEmailDispatchService(deps: {
  store: EmailDispatchStore;
  send: (params: { to: string; subject: string; textContent: string }) => Promise<{ providerMessageId: string | null }>;
  describeFailure: (error: unknown) => string;
  now?: () => Date;
}) {
  const { store, send, describeFailure } = deps;
  const now = deps.now ?? (() => new Date());

  async function dispatch(params: {
    template: string;
    toEmail: string;
    userId?: string | null;
    subject: string;
    textContent: string;
  }): Promise<EmailDispatchRow> {
    const row = await store.emailDispatch.create({
      data: {
        template: params.template,
        toEmail: params.toEmail,
        userId: params.userId ?? null,
        correlationId: randomUUID(),
        status: "QUEUED",
      },
    });

    try {
      const result = await send({
        to: params.toEmail,
        subject: params.subject,
        textContent: params.textContent,
      });
      return await store.emailDispatch.update({
        where: { id: row.id },
        data: {
          status: "SENT",
          providerMessageId: result.providerMessageId,
          sentAt: now(),
        },
      });
    } catch (error) {
      await store.emailDispatch.update({
        where: { id: row.id },
        data: {
          status: "FAILED",
          failedAt: now(),
          error: describeFailure(error),
        },
      });
      throw error;
    }
  }

  return { dispatch };
}

export const emailDispatchService = createEmailDispatchService({
  store: prisma as unknown as EmailDispatchStore,
  send: sendTransactionalEmail,
  describeFailure: describeBrevoFailure,
});
