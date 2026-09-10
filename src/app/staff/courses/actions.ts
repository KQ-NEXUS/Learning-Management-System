"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { courseService } from "@/server/services/course-service";

export type CourseFormError = { name: string; message: string };
export type CourseActionResult =
  | { ok: true; id: string }
  | { ok: false; errors: CourseFormError[]; message: string | null };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const createSchema = z.object({
  title: z.string().trim().min(1, "Enter a course title.").max(200),
  slug: z
    .string()
    .trim()
    .min(1, "Enter a slug.")
    .max(120)
    .regex(SLUG, "Use lowercase letters, numbers and single hyphens."),
  summary: z.string().trim().max(2000).optional(),
  outcomes: z.string().trim().max(4000).optional(),
  audience: z.string().trim().max(2000).optional(),
  prerequisites: z.string().trim().max(4000).optional(),
  durationHours: z.coerce.number().int().min(0).max(10_000).optional(),
  certificateEnabled: z.boolean().default(false),
});

function text(form: FormData, key: string): string | undefined {
  const raw = form.get(key);
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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
  };
}

function zodErrors(error: z.ZodError): CourseFormError[] {
  return error.issues.map((issue) => ({
    name: typeof issue.path[0] === "string" ? issue.path[0] : "title",
    message: issue.message,
  }));
}

function toFailure(error: unknown): Extract<CourseActionResult, { ok: false }> {
  if (error instanceof z.ZodError) {
    return { ok: false, errors: zodErrors(error), message: null };
  }
  if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
    return {
      ok: false,
      errors: [],
      message: "Your role does not permit creating courses.",
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
    const parsed = createSchema.parse(fields(form));
    const created = (await courseService.create(parsed)) as { id: string };
    id = created.id;
  } catch (error) {
    return toFailure(error);
  }

  revalidatePath("/staff/courses");
  redirect(`/staff/courses/${id}`);
}
