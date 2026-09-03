"use server";

/**
 * Programme create / edit Server Actions.
 *
 * Each is a public POST endpoint (Next.js "Server Actions" guide): the
 * Origin/Host CSRF check is not authorization. Every action zod-validates and
 * delegates to `programmeService`, which gates on `programmes.manage` at
 * `programmeScope(id)`. A slug change routes through `assertSlugMutable` so
 * D-11's freeze applies to a Programme exactly as it does to a Course.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { programmeService } from "@/server/services/programme-service";
import { assertSlugMutable, SlugFrozenError } from "@/server/services/catalogue-guards";

export type ProgrammeFormError = { name: string; message: string };
export type ProgrammeActionResult =
  | { ok: true; id: string }
  | { ok: false; errors: ProgrammeFormError[]; message: string | null };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const baseSchema = z.object({
  title: z.string().trim().min(1, "Enter a programme title.").max(200),
  slug: z
    .string()
    .trim()
    .min(1, "Enter a slug.")
    .max(120)
    .regex(SLUG, "Use lowercase letters, numbers and single hyphens."),
  summary: z.string().trim().max(2000).optional(),
  outcomes: z.string().trim().max(4000).optional(),
  audience: z.string().trim().max(2000).optional(),
  sequential: z.boolean().default(true),
});

function fields(form: FormData) {
  const value = (key: string) => {
    const raw = form.get(key);
    if (typeof raw !== "string") return undefined;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };
  return {
    title: value("title"),
    slug: value("slug"),
    summary: value("summary"),
    outcomes: value("outcomes"),
    audience: value("audience"),
    sequential: form.get("sequential") === "on",
  };
}

function zodErrors(error: z.ZodError): ProgrammeFormError[] {
  return error.issues.map((issue) => ({
    name: typeof issue.path[0] === "string" ? issue.path[0] : "title",
    message: issue.message,
  }));
}

function toFailure(error: unknown): Extract<ProgrammeActionResult, { ok: false }> {
  if (error instanceof z.ZodError) {
    return { ok: false, errors: zodErrors(error), message: null };
  }
  if (error instanceof SlugFrozenError) {
    return { ok: false, errors: [{ name: "slug", message: error.message }], message: null };
  }
  if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
    return {
      ok: false,
      errors: [],
      message: "Your role does not permit creating or editing programmes.",
    };
  }
  throw error;
}

export async function createProgrammeAction(
  _prev: ProgrammeActionResult,
  form: FormData,
): Promise<ProgrammeActionResult> {
  let id: string | null = null;
  try {
    const parsed = baseSchema.parse(fields(form));
    const created = (await programmeService.create(parsed)) as { id: string };
    id = created.id;
  } catch (error) {
    return toFailure(error);
  }
  revalidatePath("/staff/programmes");
  redirect(`/staff/programmes/${id}`);
}

const updateSchema = baseSchema.partial().extend({ programmeId: z.string().min(1) });

export async function updateProgrammeAction(
  _prev: ProgrammeActionResult,
  form: FormData,
): Promise<ProgrammeActionResult> {
  const programmeId = form.get("programmeId");
  if (typeof programmeId !== "string" || programmeId === "") {
    return { ok: false, errors: [], message: "Reload the page and try again." };
  }

  try {
    const parsed = updateSchema.parse({ ...fields(form), programmeId });
    const data: Record<string, unknown> = { ...parsed };
    delete data.programmeId;

    if (data.slug) {
      const current = (await programmeService.get(programmeId)) as
        | { slug: string; slugLockedAt: Date | null }
        | null;
      if (current && data.slug !== current.slug) {
        assertSlugMutable(current);
      }
    }

    await programmeService.update(programmeId, data, "Edited from the programme editor.");
  } catch (error) {
    return toFailure(error);
  }

  revalidatePath("/staff/programmes");
  revalidatePath(`/staff/programmes/${programmeId}`);
  return { ok: true, id: programmeId };
}
