"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { issueCertificateManually } from "@/server/services/certificate-service";

/**
 * `issueCertificateAction` — the pending-issuance queue's single mutation.
 *
 * Mirrors `grading-actions.ts`'s shape (`.strict()` zod input, `{ ok: true } | { ok: false,
 * message }`, an auth-error branch, `revalidatePath`) but never passes a raw caught exception's
 * own text back to the browser (T-11-38) — every failure, including the service's own
 * non-`issued` outcomes, maps to a fixed, distinct, actionable string (T-11-66: a click that
 * silently does nothing is the worst outcome here).
 */
const schema = z
  .object({
    enrolmentId: z.string().min(1),
    scope: z.enum(["COURSE", "PROGRAMME"]),
  })
  .strict();

export async function issueCertificateAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "This certificate request is no longer valid. Reload the queue and try again." };
  }

  try {
    const outcome = await issueCertificateManually(parsed.data);
    switch (outcome.kind) {
      case "issued":
        revalidatePath("/staff/certificates");
        return { ok: true };
      case "already-issued":
        revalidatePath("/staff/certificates");
        return {
          ok: false,
          message: "A certificate for this enrolment already exists. Reload the queue to see it.",
        };
      case "not-enabled":
        return {
          ok: false,
          message: "Certificates are no longer enabled for this course or programme. Reload the queue and try again.",
        };
      case "no-template":
        return {
          ok: false,
          message: "No certificate template is configured for this course or programme yet. Add one under Certificate templates before issuing.",
        };
    }
  } catch (error) {
    if (error instanceof AuthenticationError || error instanceof AuthorizationError) {
      return { ok: false, message: "Your role does not permit issuing certificates." };
    }
    return { ok: false, message: "This certificate could not be issued. Reload the queue and try again." };
  }
}
