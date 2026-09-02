/**
 * D-24/D-29/D-30/D-31 — the single validated shape for a Lesson write.
 *
 * `body` is run through `sanitizeLessonBody` in this schema's transform, so
 * no write path can bypass it (T-04-12) — `createLesson`/`updateLesson` in
 * `lesson-service.ts` are the only exported write entry points, and both
 * validate through this schema before delegating to the factory.
 *
 * Sanitisation on write is not the last defence: D-30 also requires
 * sanitising again on render (plan 04-14), because a row written before a
 * sanitiser bug was fixed must still be safe when read.
 *
 * `.strict()` means an input carrying a `position` key is REJECTED rather
 * than silently dropped — see the plan's `<position_rule>`. A client that
 * thinks it is choosing a position should be told it is not.
 */

import { z } from "zod";
import { sanitizeLessonBody } from "@/lib/sanitize";
import { parseEmbedUrl, parseLinkUrl } from "@/lib/embed-url";

/** Mirrors `enum LessonType` in prisma/schema.prisma exactly. */
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

const baseLessonSchema = z
  .object({
    // Required on create — a Lesson has no parent otherwise and
    // moduleScope cannot resolve it. lesson-service.ts relaxes this to
    // optional for update via `.partial()`, since re-parenting is not an
    // update concern.
    moduleId: z.string().min(1),
    title: z.string().trim().min(1).max(200),
    type: z.enum(LESSON_TYPES),
    body: z
      .string()
      .optional()
      .transform((value) => (value === undefined ? undefined : sanitizeLessonBody(value))),
    embedUrl: z
      .string()
      .optional()
      .superRefine((value, ctx) => {
        if (value === undefined) return;
        const result = parseEmbedUrl(value);
        if (!result.ok) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.message });
        }
      }),
    linkUrl: z
      .string()
      .optional()
      .superRefine((value, ctx) => {
        if (value === undefined) return;
        const result = parseLinkUrl(value);
        if (!result.ok) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.message });
        }
      }),
    // D-24 — the required toggle is saved with the lesson, not derived from
    // the arrange screen.
    required: z.boolean().default(true),
    allowManualComplete: z.boolean().default(true),
    assessmentId: z.string().nullable().optional(),
  })
  .strict();

/**
 * Cross-field rule: EMBED needs embedUrl, LINK needs linkUrl, TEXT needs a
 * non-empty body after sanitisation. QUIZ and ASSIGNMENT require nothing
 * beyond a title (D-31) — the assessment picker has nothing to choose yet,
 * and readiness flags a missing assessmentId as a named gap, not a
 * validation error.
 */
export const lessonInputSchema = baseLessonSchema.superRefine((data, ctx) => {
  if (data.type === "EMBED" && !data.embedUrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "EMBED lessons require an embedUrl.",
      path: ["embedUrl"],
    });
  }
  if (data.type === "LINK" && !data.linkUrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "LINK lessons require a linkUrl.",
      path: ["linkUrl"],
    });
  }
  if (data.type === "TEXT" && !data.body) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "TEXT lessons require a non-empty body.",
      path: ["body"],
    });
  }
});

export type LessonInput = z.infer<typeof lessonInputSchema>;

/** Validated shape for an update — moduleId is not re-parenting surface. */
const lessonUpdateSchema = baseLessonSchema.partial({ moduleId: true, title: true, type: true });

export type LessonUpdateInput = z.infer<typeof lessonUpdateSchema>;

/** Validates a Lesson create payload. Throws a `ZodError` on failure. */
export function parseLessonInput(raw: unknown): LessonInput {
  return lessonInputSchema.parse(raw);
}

/** Validates a Lesson update payload (moduleId/title/type all optional). */
export function parseLessonUpdateInput(raw: unknown): LessonUpdateInput {
  return lessonUpdateSchema.parse(raw);
}
