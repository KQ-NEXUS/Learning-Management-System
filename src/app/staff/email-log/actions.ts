"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { emailDeliveryLogService } from "@/server/services/email-delivery-log-service";

/**
 * The delivery log's one mutation (D-06). The `.strict()` schema and the
 * 10-character reason minimum are a convenience only — `ConfirmModal`'s
 * `minReasonLength` already stops a short reason reaching this action from
 * the UI, and the service independently re-enforces the same minimum
 * (T-13-08). Every failure branch — validation, authorization, or an
 * ineligible/not-found row — collapses to the same UI-SPEC copy so neither
 * becomes an oracle a caller can use to tell them apart.
 */
const resendSchema = z
  .object({
    dispatchId: z.string().min(1),
    reason: z.string().trim().min(10).max(500),
  })
  .strict();

export type ResendEmailActionResult = { ok: true } | { ok: false; message: string };

export async function resendEmailAction(input: unknown): Promise<ResendEmailActionResult> {
  const parsed = resendSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Email not resent. Try again." };
  }

  try {
    await emailDeliveryLogService.resendDispatch(parsed.data);
    revalidatePath("/staff/email-log");
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthenticationError || error instanceof AuthorizationError) {
      return { ok: false, message: "You are not authorised to perform this action." };
    }
    return { ok: false, message: "Email not resent. Try again." };
  }
}
