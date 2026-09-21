"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import {
  revokeCertificate,
  reissueCertificate,
  RevocationReasonRequiredError,
  CertificateChangedError,
} from "@/server/services/certificate-service";

/**
 * The certificate detail page's two mutations (CRD-05) — `11-UI-SPEC.md` §0.4, §6.
 *
 * Mirrors `grading-actions.ts`'s shape: a `.strict()` zod schema per action (the client-side
 * `minReasonLength` on `ConfirmModal` is a convenience only — the schema and the service both
 * re-enforce the 10-character minimum independently, T-11-49), a fixed `{ ok: true } | { ok: false,
 * message }` result, and a closed error-message map that never passes a caught exception's own
 * `.message` back to the browser (T-11-38) — every branch below returns a literal string owned by
 * this file, never a property read off the caught value.
 *
 * A `"use server"` module may only export async functions (Next.js's Server Actions constraint),
 * so the schemas stay module-private and are re-validated through the two exported
 * `validate*Input` async wrappers below — this is what a test asserts "the schema directly" through
 * (independent of the UI and of `revokeCertificateAction`/`reissueCertificateAction`'s own
 * `safeParse` call), rather than importing a schema value that cannot be exported from here.
 */
const revokeCertificateSchema = z
  .object({
    certificateId: z.string().min(1),
    reason: z.string().trim().min(10),
  })
  .strict();

const reissueCertificateSchema = z
  .object({
    certificateId: z.string().min(1),
    reason: z.string().trim().min(10),
  })
  .strict();

type ActionResult = { ok: true } | { ok: false; message: string };
type ReissueActionResult = { ok: true; certificateId: string } | { ok: false; message: string };

/** Test-reachable direct schema assertion — see the file docstring. */
export async function validateRevokeCertificateInput(input: unknown) {
  return revokeCertificateSchema.safeParse(input);
}

/** Test-reachable direct schema assertion — see the file docstring. */
export async function validateReissueCertificateInput(input: unknown) {
  return reissueCertificateSchema.safeParse(input);
}

function mapError(error: unknown): string {
  if (error instanceof AuthenticationError || error instanceof AuthorizationError) {
    return "Your role does not permit this action.";
  }
  if (error instanceof RevocationReasonRequiredError) {
    return "Explain the correction using at least 10 characters.";
  }
  if (error instanceof CertificateChangedError) {
    return "This certificate changed while you were working on it. Reload it and try again.";
  }
  return "This action could not be completed. Reload the page and try again.";
}

export async function revokeCertificateAction(input: unknown): Promise<ActionResult> {
  const parsed = revokeCertificateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Explain the correction using at least 10 characters." };
  }

  try {
    const certificate = await revokeCertificate(parsed.data);
    revalidatePath(`/staff/certificates/issued/${certificate.id}`);
    revalidatePath("/staff/certificates/issued");
    return { ok: true };
  } catch (error) {
    return { ok: false, message: mapError(error) };
  }
}

export async function reissueCertificateAction(input: unknown): Promise<ReissueActionResult> {
  const parsed = reissueCertificateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Explain the correction using at least 10 characters." };
  }

  try {
    const certificate = await reissueCertificate(parsed.data);
    revalidatePath(`/staff/certificates/issued/${parsed.data.certificateId}`);
    revalidatePath(`/staff/certificates/issued/${certificate.id}`);
    revalidatePath("/staff/certificates/issued");
    return { ok: true, certificateId: certificate.id };
  } catch (error) {
    return { ok: false, message: mapError(error) };
  }
}
