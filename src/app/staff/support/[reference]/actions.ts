"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  addInternalTicketNote,
  addPublicTicketReply,
} from "@/server/services/ticket-service";
import { mapStaffTicketFailure, type StaffTicketActionResult } from "../action-result";

const base = {
  reference: z.string().trim().min(1).max(64),
  expectedVersion: z.number().int().positive(),
};

const messageSchema = z.object({ ...base, body: z.string().trim().min(1).max(5_000) }).strict();

function refresh(reference: string) {
  revalidatePath("/staff/support", "page");
  revalidatePath(`/staff/support/${reference}`, "page");
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
