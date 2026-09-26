"use server";

import { z } from "zod";
import { getCurrentActor } from "@/server/auth/current-actor";
import {
  StaleTicketVersionError,
  TicketNotFoundError,
  addOwnTicketReply,
  closeOwnTicket,
  reopenOwnTicket,
} from "@/server/services/ticket-service";

/**
 * Learner lifecycle Server Actions. Each re-resolves the actor and lets the
 * service re-check ownership and the expected version; nothing here trusts the
 * client for the grace window (the service computes it from `resolvedAt`).
 */

export type TicketActionResult =
  | { ok: true; messageId?: string }
  | { ok: false; kind: "conflict" | "invalid" | "error"; message: string };

const CONFLICT =
  "This ticket changed while you were working. We loaded the latest activity—review it and try again.";

const base = z.object({
  reference: z.string().min(1).max(100),
  expectedVersion: z.number().int().nonnegative(),
});

function failure(error: unknown, fallback: string): TicketActionResult {
  if (error instanceof StaleTicketVersionError) return { ok: false, kind: "conflict", message: CONFLICT };
  if (error instanceof TicketNotFoundError) {
    return { ok: false, kind: "error", message: "You don’t have access to this ticket." };
  }
  if (error instanceof TypeError) return { ok: false, kind: "invalid", message: error.message };
  return { ok: false, kind: "error", message: fallback };
}

async function requireSignedIn(): Promise<TicketActionResult | null> {
  return (await getCurrentActor()) ? null : { ok: false, kind: "error", message: "Sign in to continue." };
}

export async function replyToTicketAction(input: {
  reference: string;
  expectedVersion: number;
  body: string;
}): Promise<TicketActionResult> {
  const denied = await requireSignedIn();
  if (denied) return denied;
  const parsed = base.extend({ body: z.string().trim().min(1).max(5000) }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, kind: "invalid", message: "Enter a reply of up to 5,000 characters." };
  }
  try {
    const result = await addOwnTicketReply(parsed.data);
    return { ok: true, messageId: result.messageId };
  } catch (error) {
    return failure(error, "Your message wasn’t sent. Your text and selected files are still here.");
  }
}

export async function reopenTicketAction(input: {
  reference: string;
  expectedVersion: number;
  reason: string;
}): Promise<TicketActionResult> {
  const denied = await requireSignedIn();
  if (denied) return denied;
  const parsed = base.extend({ reason: z.string().trim().min(1).max(1000) }).safeParse(input);
  if (!parsed.success) return { ok: false, kind: "invalid", message: "Enter a reason for reopening this ticket." };
  try {
    await reopenOwnTicket(parsed.data);
    return { ok: true };
  } catch (error) {
    return failure(error, "This ticket could not be reopened.");
  }
}

export async function closeTicketAction(input: {
  reference: string;
  expectedVersion: number;
}): Promise<TicketActionResult> {
  const denied = await requireSignedIn();
  if (denied) return denied;
  const parsed = base.safeParse(input);
  if (!parsed.success) return { ok: false, kind: "invalid", message: "This ticket could not be closed." };
  try {
    await closeOwnTicket(parsed.data);
    return { ok: true };
  } catch (error) {
    return failure(error, "This ticket could not be closed.");
  }
}
