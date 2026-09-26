"use server";

import { z } from "zod";
import { createOwnTicket } from "@/server/services/ticket-service";
import { getCurrentActor } from "@/server/auth/current-actor";
import {
  parseLearnerContextHint,
  validateLearnerTicketContext,
} from "@/server/services/ticket-learner-context-service";

const CATEGORIES = [
  "ACCOUNT_ACCESS",
  "PAYMENT_ORDER",
  "COURSE_CONTENT",
  "ASSESSMENT_RESULT",
  "CERTIFICATE",
  "TECHNICAL_PROBLEM",
  "OTHER",
] as const;

const schema = z.object({
  category: z.enum(CATEGORIES, { error: "Choose a category." }),
  subject: z.string().trim().min(3, "Enter a subject of at least 3 characters.").max(160, "Subject must be 160 characters or fewer."),
  message: z.string().trim().min(3, "Enter a message of at least 3 characters.").max(5000, "Message must be 5,000 characters or fewer."),
  contextKind: z.string().max(40).nullish(),
  contextId: z.string().max(100).nullish(),
});

export type CreateTicketInput = z.input<typeof schema>;

export type CreateTicketResult =
  | { ok: true; reference: string; initialMessageId: string; version: number }
  | { ok: false; message: string; fieldErrors?: Partial<Record<"category" | "subject" | "message", string>> };

/**
 * Creates exactly one ticket with its initial public message. The context is
 * only a hint: it is resolved and ownership-checked here before persisting.
 * Attachments are uploaded by the client afterwards against the returned
 * initial message id.
 */
export async function createTicketAction(input: CreateTicketInput): Promise<CreateTicketResult> {
  const actor = await getCurrentActor();
  if (!actor) return { ok: false, message: "Sign in to continue." };

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<"category" | "subject" | "message", string>> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if ((key === "category" || key === "subject" || key === "message") && !fieldErrors[key]) {
        fieldErrors[key] = issue.message;
      }
    }
    return { ok: false, message: "Check the highlighted fields and try again.", fieldErrors };
  }

  try {
    const context = await validateLearnerTicketContext(
      actor.userId,
      parseLearnerContextHint(parsed.data.contextKind, parsed.data.contextId),
    );
    const ticket = await createOwnTicket({
      category: parsed.data.category,
      subject: parsed.data.subject,
      body: parsed.data.message,
      context: context?.input,
    });
    return { ok: true, reference: ticket.reference, initialMessageId: ticket.initialMessageId, version: ticket.version };
  } catch {
    return { ok: false, message: "Your ticket wasn’t created. Your text and selected files are still here." };
  }
}
