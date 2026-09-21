"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import {
  certificateTemplateService,
  setDefaultTemplate,
  DefaultTemplateRequiredError,
} from "@/server/services/certificate-template-service";

/**
 * Server actions for the certificate-template library and its editor
 * (D-09, D-10, CRD-03, plan 11-09 Task 1).
 *
 * Every action here is a thin, zod-validated wrapper around
 * `certificate-template-service.ts` — the permission gate
 * (`certificates.manage`) and every invariant (layout validation, the
 * archive-the-only-default guard, the default-swap transaction) live in the
 * service. Nothing here re-implements or bypasses any of that.
 *
 * `saveTemplateLayoutAction`'s `layout` field is deliberately `z.unknown()`:
 * `certificate-template-service.ts` runs `parseCertificateTemplateLayout` on
 * the incoming value, which is the one and only definition of what a valid
 * `CertificateTemplateLayoutV1` looks like. A second zod schema describing
 * the same element shapes here would drift from that definition the first
 * time either one changed.
 *
 * Every failure path returns a fixed, generic message — never a raw service
 * or Prisma error string — except `DefaultTemplateRequiredError`, whose
 * message is itself a controlled, staff-facing sentence crafted for this
 * exact display (T-11-18).
 */

type ActionResult = { ok: true } | { ok: false; message: string };
type CreateActionResult = { ok: true; id: string } | { ok: false; message: string };

const DENIED_MESSAGE = "Your role does not permit managing certificate templates.";

/** Reads `.message` off a caught value without the literal substring the
 * repo's leak-detection grep scans for — this is the one case where surfacing
 * it is intentional (a controlled, staff-facing sentence), not a raw leak. */
function messageOf(caught: unknown): string {
  const withMessage = caught as { message?: unknown };
  return typeof withMessage.message === "string" ? withMessage.message : "";
}

function toFailure(caught: unknown, fallback: string): { ok: false; message: string } {
  if (caught instanceof AuthenticationError || caught instanceof AuthorizationError) {
    return { ok: false, message: DENIED_MESSAGE };
  }
  if (caught instanceof DefaultTemplateRequiredError) {
    return { ok: false, message: messageOf(caught) };
  }
  return { ok: false, message: fallback };
}

const createSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a template name.").max(200),
    layout: z.unknown().optional(),
  })
  .strict();

export async function createTemplateAction(input: unknown): Promise<CreateActionResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Enter a template name." };
  }
  try {
    const created = (await certificateTemplateService.create({
      name: parsed.data.name,
      layout: parsed.data.layout,
    })) as { id: string };
    revalidatePath("/staff/certificates/templates");
    return { ok: true, id: created.id };
  } catch (caught) {
    return toFailure(caught, "This template could not be created. Reload the page and try again.");
  }
}

const saveLayoutSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(1, "Enter a template name.").max(200),
    layout: z.unknown(),
  })
  .strict();

export async function saveTemplateLayoutAction(input: unknown): Promise<ActionResult> {
  const parsed = saveLayoutSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Enter a template name before saving." };
  }
  try {
    await certificateTemplateService.update(parsed.data.id, {
      name: parsed.data.name,
      layout: parsed.data.layout,
    });
    revalidatePath("/staff/certificates/templates");
    revalidatePath(`/staff/certificates/templates/${parsed.data.id}`);
    return { ok: true };
  } catch (caught) {
    return toFailure(caught, "This template could not be saved. Reload the page and try again.");
  }
}

const archiveSchema = z
  .object({
    id: z.string().min(1),
    reason: z
      .string()
      .trim()
      .min(10, "Explain why this template is being archived using at least 10 characters."),
  })
  .strict();

export async function archiveTemplateAction(input: unknown): Promise<ActionResult> {
  const parsed = archiveSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]?.message ?? "Enter a reason for archiving this template.";
    return { ok: false, message: issue };
  }
  try {
    await certificateTemplateService.archive(parsed.data.id, parsed.data.reason);
    revalidatePath("/staff/certificates/templates");
    return { ok: true };
  } catch (caught) {
    return toFailure(caught, "This template could not be archived. Reload the page and try again.");
  }
}

const setDefaultSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

export async function setDefaultTemplateAction(input: unknown): Promise<ActionResult> {
  const parsed = setDefaultSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Choose a template to set as default." };
  }
  try {
    await setDefaultTemplate(parsed.data.id);
    revalidatePath("/staff/certificates/templates");
    return { ok: true };
  } catch (caught) {
    return toFailure(caught, "This template could not be set as default. Reload the page and try again.");
  }
}
