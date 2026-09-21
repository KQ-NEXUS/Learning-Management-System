"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { courseService } from "@/server/services/course-service";
import { assertSlugMutable, SlugFrozenError } from "@/server/services/catalogue-guards";
import { createCourseSchema, updateCourseSchema } from "./course-schema";
import {
  assertTemplateSelectable,
  TemplateNotSelectableError,
} from "@/server/services/certificate-template-service";

export type CourseFormError = { name: string; message: string };
export type CourseActionResult =
  | { ok: true; id: string }
  | { ok: false; errors: CourseFormError[]; message: string | null };

function text(form: FormData, key: string): string | undefined {
  const raw = form.get(key);
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** "" (the "Use the default template" option) maps to `null`; an absent key maps to `undefined`. */
function templateId(form: FormData): string | null | undefined {
  const raw = form.get("certificateTemplateId");
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function fields(form: FormData) {
  const durationHours = text(form, "durationHours");
  return {
    title: text(form, "title"),
    slug: text(form, "slug"),
    summary: text(form, "summary"),
    outcomes: text(form, "outcomes"),
    audience: text(form, "audience"),
    prerequisites: text(form, "prerequisites"),
    durationHours,
    certificateEnabled: form.get("certificateEnabled") === "on",
    certificateIssuanceMode: text(form, "certificateIssuanceMode"),
    certificateTemplateId: templateId(form),
  };
}

function zodErrors(error: z.ZodError): CourseFormError[] {
  return error.issues.map((issue) => ({
    name: typeof issue.path[0] === "string" ? issue.path[0] : "title",
    message: issue.message,
  }));
}

/** `verb` completes "Your role does not permit ___ courses." — never `error.message`. */
function toFailure(
  error: unknown,
  verb: "creating" | "editing",
): Extract<CourseActionResult, { ok: false }> {
  if (error instanceof z.ZodError) {
    return { ok: false, errors: zodErrors(error), message: null };
  }
  if (error instanceof SlugFrozenError) {
    return { ok: false, errors: [{ name: "slug", message: error.message }], message: null };
  }
  if (error instanceof TemplateNotSelectableError) {
    return {
      ok: false,
      errors: [{ name: "certificateTemplateId", message: error.message }],
      message: null,
    };
  }
  if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
    return {
      ok: false,
      errors: [],
      message: `Your role does not permit ${verb} courses.`,
    };
  }
  throw error;
}

export async function createCourseAction(
  _prev: CourseActionResult,
  form: FormData,
): Promise<CourseActionResult> {
  let id: string | null = null;
  try {
    const parsed = createCourseSchema.parse(fields(form));
    // Pitfall 5 / T-11-33: re-resolve against the live selectable-template
    // list server-side — the client's <option> list is never trusted.
    await assertTemplateSelectable(parsed.certificateTemplateId);
    const created = (await courseService.create(parsed)) as { id: string };
    id = created.id;
  } catch (error) {
    return toFailure(error, "creating");
  }

  revalidatePath("/staff/courses");
  redirect(`/staff/courses/${id}`);
}

/** Blank optional text on the edit form clears the column (`null`), unlike create which omits it. */
function blankToNull(form: FormData, key: string): string | null {
  return text(form, key) ?? null;
}

function updateFields(form: FormData, courseId: string) {
  const duration = text(form, "durationHours");
  return {
    courseId,
    title: text(form, "title"),
    slug: text(form, "slug"),
    summary: blankToNull(form, "summary"),
    outcomes: blankToNull(form, "outcomes"),
    audience: blankToNull(form, "audience"),
    prerequisites: blankToNull(form, "prerequisites"),
    // Mapped BEFORE parsing: `z.coerce.number()` would turn a blank into 0.
    durationHours: duration === undefined ? null : Number(duration),
    certificateEnabled: form.get("certificateEnabled") === "on",
    certificateIssuanceMode: text(form, "certificateIssuanceMode"),
    certificateTemplateId: templateId(form),
  };
}

export async function updateCourseAction(
  _prev: CourseActionResult,
  form: FormData,
): Promise<CourseActionResult> {
  const courseId = form.get("courseId");
  if (typeof courseId !== "string" || courseId.trim() === "") {
    return { ok: false, errors: [], message: "Reload the page and try again." };
  }

  try {
    const parsed = updateCourseSchema.parse(updateFields(form, courseId));

    const current = (await courseService.get(courseId)) as
      | { slug: string; slugLockedAt: Date | null; certificateTemplateId: string | null }
      | null;
    if (!current) {
      return { ok: false, errors: [], message: "Reload the page and try again." };
    }

    // D-11: only a slug CHANGE is refused once the slug is frozen.
    if (parsed.slug !== current.slug) {
      assertSlugMutable(current);
    }

    // Pitfall 5 / T-11-33 / T-11-85: the client's <option> list is never
    // trusted, but an already-stored template that has since been archived
    // must not block an unrelated edit — so only a CHANGED template is
    // re-resolved. An absent key (undefined) means "leave unchanged".
    if (
      parsed.certificateTemplateId !== undefined &&
      parsed.certificateTemplateId !== current.certificateTemplateId
    ) {
      await assertTemplateSelectable(parsed.certificateTemplateId);
    }

    // Built only from the named fields (T-11-82); undefined keys are omitted
    // so a disabled certificate control never resets the stored value.
    const { courseId: _id, ...rest } = parsed;
    void _id;
    const data = Object.fromEntries(
      Object.entries(rest).filter(([, value]) => value !== undefined),
    );

    // Authorization (courses.edit at courseScope(id)) and the course.updated
    // audit both come from the resource factory, not from this file.
    await courseService.update(courseId, data, "Edited from the course editor.");
  } catch (error) {
    return toFailure(error, "editing");
  }

  revalidatePath("/staff/courses");
  revalidatePath(`/staff/courses/${courseId}`);
  // A title or slug edit reaches the public catalogue too.
  revalidatePath("/courses");
  revalidatePath("/courses/[slug]", "page");
  return { ok: true, id: courseId };
}
