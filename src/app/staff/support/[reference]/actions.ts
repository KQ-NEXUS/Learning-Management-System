"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  acceptTicketEscalation,
  addInternalTicketNote,
  addPublicTicketReply,
  assignTicket,
  changeTicketPriority,
  claimTicket,
  escalateTicket,
  moveTicketQueue,
  resolveTicket,
} from "@/server/services/ticket-service";
import { listTicketAssignees } from "@/server/services/ticket-staff-queue-service";
import { mapStaffTicketFailure, type StaffTicketActionResult } from "../action-result";

/**
 * Thin Server Actions. Each validates its payload, then calls exactly one
 * ticket-service command; tickets.manage is enforced by the service, not here.
 * Every action carries expectedVersion so a stale browser is rejected (D-08).
 */
const base = {
  reference: z.string().trim().min(1).max(64),
  expectedVersion: z.number().int().positive(),
};
const QUEUES = ["GENERAL_SUPPORT", "ACCOUNTS", "FINANCE", "LEARNING_ASSESSMENT", "TECHNICAL"] as const;
const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
const reason = z.string().trim().min(1).max(1_000);

const messageSchema = z.object({ ...base, body: z.string().trim().min(1).max(5_000) }).strict();
const versionOnly = z.object(base).strict();
const assignSchema = z.object({ ...base, assigneeId: z.string().trim().min(1).max(64), reason: reason.optional() }).strict();
const queueSchema = z.object({ ...base, queue: z.enum(QUEUES), reason }).strict();
const prioritySchema = z.object({ ...base, priority: z.enum(PRIORITIES), reason: reason.optional() }).strict();
const escalateSchema = z
  .object({ ...base, queue: z.enum(QUEUES), assigneeId: z.string().trim().min(1).max(64).optional(), reason })
  .strict();
const resolveSchema = z.object({ ...base, reason }).strict();

function refresh(reference: string) {
  revalidatePath("/staff/support", "page");
  revalidatePath(`/staff/support/${reference}`, "page");
}

const INVALID: StaffTicketActionResult = {
  ok: false,
  kind: "validation",
  message: "Check the highlighted fields and try again.",
};

/** An owner must be someone who can currently manage tickets. */
async function assertEligibleAssignee(assigneeId: string): Promise<StaffTicketActionResult | null> {
  const eligible = await listTicketAssignees();
  return eligible.some((option) => option.id === assigneeId)
    ? null
    : { ok: false, kind: "validation", message: "Choose a staff member who can manage support tickets." };
}

export async function sendPublicReplyAction(input: z.input<typeof messageSchema>): Promise<StaffTicketActionResult> {
  const parsed = messageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, kind: "validation", message: "Enter a message before sending." };
  try {
    const result = await addPublicTicketReply(parsed.data);
    refresh(parsed.data.reference);
    return { ok: true, messageId: result.messageId };
  } catch (error) {
    return mapStaffTicketFailure(error);
  }
}

export async function addInternalNoteAction(input: z.input<typeof messageSchema>): Promise<StaffTicketActionResult> {
  const parsed = messageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, kind: "validation", message: "Enter a note before saving." };
  try {
    const result = await addInternalTicketNote(parsed.data);
    refresh(parsed.data.reference);
    return { ok: true, messageId: result.messageId };
  } catch (error) {
    return mapStaffTicketFailure(error);
  }
}

export async function claimTicketAction(input: z.input<typeof versionOnly>): Promise<StaffTicketActionResult> {
  const parsed = versionOnly.safeParse(input);
  if (!parsed.success) return INVALID;
  try {
    await claimTicket(parsed.data);
    refresh(parsed.data.reference);
    return { ok: true };
  } catch (error) {
    return mapStaffTicketFailure(error);
  }
}

export async function acceptEscalationAction(input: z.input<typeof versionOnly>): Promise<StaffTicketActionResult> {
  const parsed = versionOnly.safeParse(input);
  if (!parsed.success) return INVALID;
  try {
    await acceptTicketEscalation(parsed.data);
    refresh(parsed.data.reference);
    return { ok: true };
  } catch (error) {
    return mapStaffTicketFailure(error);
  }
}

export async function assignTicketAction(input: z.input<typeof assignSchema>): Promise<StaffTicketActionResult> {
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return INVALID;
  try {
    const ineligible = await assertEligibleAssignee(parsed.data.assigneeId);
    if (ineligible) return ineligible;
    await assignTicket(parsed.data);
    refresh(parsed.data.reference);
    return { ok: true };
  } catch (error) {
    return mapStaffTicketFailure(error);
  }
}

export async function moveQueueAction(input: z.input<typeof queueSchema>): Promise<StaffTicketActionResult> {
  const parsed = queueSchema.safeParse(input);
  if (!parsed.success) return { ok: false, kind: "validation", message: "Choose a queue and enter a queue reason." };
  try {
    await moveTicketQueue(parsed.data);
    refresh(parsed.data.reference);
    return { ok: true };
  } catch (error) {
    return mapStaffTicketFailure(error);
  }
}

export async function changePriorityAction(input: z.input<typeof prioritySchema>): Promise<StaffTicketActionResult> {
  const parsed = prioritySchema.safeParse(input);
  if (!parsed.success) return INVALID;
  try {
    await changeTicketPriority(parsed.data);
    refresh(parsed.data.reference);
    return { ok: true };
  } catch (error) {
    return mapStaffTicketFailure(error);
  }
}

export async function escalateTicketAction(input: z.input<typeof escalateSchema>): Promise<StaffTicketActionResult> {
  const parsed = escalateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, kind: "validation", message: "Choose the target queue and enter an escalation reason." };
  try {
    if (parsed.data.assigneeId) {
      const ineligible = await assertEligibleAssignee(parsed.data.assigneeId);
      if (ineligible) return ineligible;
    }
    await escalateTicket(parsed.data);
    refresh(parsed.data.reference);
    return { ok: true };
  } catch (error) {
    return mapStaffTicketFailure(error);
  }
}

export async function resolveTicketAction(input: z.input<typeof resolveSchema>): Promise<StaffTicketActionResult> {
  const parsed = resolveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, kind: "validation", message: "Enter a resolution note." };
  try {
    await resolveTicket(parsed.data);
    refresh(parsed.data.reference);
    return { ok: true };
  } catch (error) {
    return mapStaffTicketFailure(error);
  }
}
