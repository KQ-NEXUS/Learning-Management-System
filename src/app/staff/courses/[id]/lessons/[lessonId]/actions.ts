"use server";

/**
 * The lesson editor's Server Actions.
 *
 * Every export here is a public POST endpoint (Next.js "Server Actions" guide) —
 * the Origin/Host CSRF check is NOT authorization. So each action:
 *   1. reads its hidden routing fields (courseId, and either lessonId or
 *      moduleId) with a strict envelope schema, then
 *   2. funnels the rest of the FormData through `parseLessonInput` /
 *      `parseLessonUpdateInput` — the single validation + body-sanitisation
 *      entry point (T-04-12) — and only then
 *   3. delegates to `createLesson` / `updateLesson` / `lessonService.archive`,
 *      each of which re-resolves the Course scope from the row and gates on
 *      `courses.edit`.
 *
 * The client's editor-side cleaning of the HTML proves nothing and is never
 * trusted. An ordering slot is never read from the form or the query string —
 * `createLesson` assigns it (plan 04-04 <position_rule>). Nothing in this folder
 * imports the Prisma client; every write goes through a service.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { FieldError } from "@/components/primitives";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { parseLessonInput, parseLessonUpdateInput } from "@/lib/lesson-input";
import { createLesson, lessonService, updateLesson } from "@/server/services/lesson-service";

const LESSON_TYPES = [
  "TEXT",
  "FILE",
  "IMAGE",
  "VIDEO",
  "EMBED",
  "LINK",
  "QUIZ",
  "ASSIGNMENT",
] as const;

// ---------------------------------------------------------------------------
// saveLessonAction — one action, both create and edit.
// ---------------------------------------------------------------------------

export type SaveLessonState = {
  ok: boolean | null;
  errors: FieldError[];
  message: string | null;
};

export const INITIAL_SAVE_STATE: SaveLessonState = { ok: null, errors: [], message: null };

/** The hidden routing fields — never forwarded to `parseLessonInput` (`.strict()`). */
const envelopeSchema = z
  .object({
    lessonId: z.string().trim().min(1).optional(),
    moduleId: z.string().trim().min(1).optional(),
    courseId: z.string().trim().min(1),
    type: z.enum(LESSON_TYPES),
  })
  .strict();

function fieldValue(form: FormData, key: string): string | undefined {
  const raw = form.get(key);
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function zodFieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    name: typeof issue.path[0] === "string" ? issue.path[0] : "title",
    message: issue.message,
  }));
}

/** ZodError -> field errors; an authz failure -> one generic, non-enumerating line. */
function toFailure(error: unknown): SaveLessonState {
  if (error instanceof z.ZodError) {
    return { ok: false, errors: zodFieldErrors(error), message: null };
  }
  if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
    return {
      ok: false,
      errors: [],
      message:
        "This lesson could not be saved. It may have moved, or your role no longer permits editing it.",
    };
  }
  throw error;
}

export async function saveLessonAction(
  _prev: SaveLessonState,
  form: FormData,
): Promise<SaveLessonState> {
  const envelope = envelopeSchema.safeParse({
    lessonId: fieldValue(form, "lessonId"),
    moduleId: fieldValue(form, "moduleId"),
    courseId: fieldValue(form, "courseId"),
    type: form.get("type"),
  });
  if (!envelope.success) {
    return {
      ok: false,
      errors: [],
      message: "The lesson form was incomplete. Reload the page and try again.",
    };
  }
  const { lessonId, moduleId, courseId, type } = envelope.data;

  // Checkboxes: an unchecked box sends no key at all, so read an explicit
  // boolean rather than letting the schema default a missing key back to `true`.
  const fields = {
    title: fieldValue(form, "title"),
    type,
    body: fieldValue(form, "body"),
    embedUrl: fieldValue(form, "embedUrl"),
    linkUrl: fieldValue(form, "linkUrl"),
    required: form.get("required") === "on",
    allowManualComplete: form.get("allowManualComplete") === "on",
  };

  let newLessonId: string | null = null;
  try {
    if (lessonId) {
      const parsed = parseLessonUpdateInput(fields);
      await updateLesson(lessonId, parsed, "Edited from the lesson editor.");
    } else {
      if (!moduleId) {
        return {
          ok: false,
          errors: [],
          message: "This lesson has no parent module. Start again from the arrange screen.",
        };
      }
      const parsed = parseLessonInput({ ...fields, moduleId });
      const created = await createLesson(parsed);
      newLessonId = created.id;
    }
  } catch (error) {
    return toFailure(error);
  }

  revalidatePath(`/staff/courses/${courseId}`);
  revalidatePath(`/staff/courses/${courseId}/arrange`);
  if (lessonId) revalidatePath(`/staff/courses/${courseId}/lessons/${lessonId}`);

  // A brand-new lesson: move to its own editor, where the UploadPanel (which
  // needs a lessonId) and the rest of the per-type fields become usable.
  if (newLessonId) {
    redirect(`/staff/courses/${courseId}/lessons/${newLessonId}`);
  }
  return { ok: true, errors: [], message: null };
}

// ---------------------------------------------------------------------------
// withdrawLessonAction — D-17 withdrawal (`withdrawnAt`), never a delete.
// ---------------------------------------------------------------------------

export type WithdrawLessonResult = { ok: true } | { ok: false; message: string };

const withdrawSchema = z
  .object({
    lessonId: z.string().min(1),
    courseId: z.string().min(1),
    reason: z.string().trim().min(10).max(500),
  })
  .strict();

export async function withdrawLessonAction(
  input: z.input<typeof withdrawSchema>,
): Promise<WithdrawLessonResult> {
  const parsed = withdrawSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Give a reason of at least 10 characters." };
  }

  try {
    await lessonService.archive(parsed.data.lessonId, parsed.data.reason);
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
      return { ok: false, message: "This lesson could not be withdrawn." };
    }
    throw error;
  }

  revalidatePath(`/staff/courses/${parsed.data.courseId}`);
  revalidatePath(`/staff/courses/${parsed.data.courseId}/arrange`);
  redirect(`/staff/courses/${parsed.data.courseId}/arrange`);
}
