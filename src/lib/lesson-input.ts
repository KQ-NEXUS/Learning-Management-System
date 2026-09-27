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

const MAX_VIDEO_SECONDS = 24 * 60 * 60;

/**
 * F-15 — a staff-typed video length: "95", "12:30" or "1:02:03" to seconds.
 * Anything else (or zero) is NaN, which the schema reports as a field error.
 */
export function parseVideoLength(raw: string): number {
  const text = raw.trim();
  if (!/^\d+(:\d{1,2}){0,2}$/.test(text)) return Number.NaN;
  const parts = text.split(":").map(Number);
  if (parts.slice(1).some((p) => p > 59)) return Number.NaN;
  const seconds = parts.reduce((total, p) => total * 60 + p, 0);
  return seconds > 0 ? seconds : Number.NaN;
}

/** F-15 — seconds back to the editor's "m:ss" / "h:mm:ss". */
export function formatVideoLength(seconds: number | null | undefined): string {
  if (seconds == null) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

const VIDEO_LENGTH_MESSAGE = "Enter the video length as minutes:seconds, for example 12:30.";

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
    // F-15 — optional staff-set length of a VIDEO lesson; null clears it.
    videoDurationSeconds: z
      .preprocess(
        (value) => (typeof value === "string" ? parseVideoLength(value) : value),
        z
          .number({ message: VIDEO_LENGTH_MESSAGE })
          .int({ message: VIDEO_LENGTH_MESSAGE })
          .min(1, { message: VIDEO_LENGTH_MESSAGE })
          .max(MAX_VIDEO_SECONDS, { message: "A video length must be under 24 hours." })
          .nullable(),
      )
      .optional(),
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
