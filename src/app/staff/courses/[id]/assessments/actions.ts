"use server";

/**
 * The Assessment authoring Server Actions (ASM-01, ASM-03).
 *
 * Every export here is a public POST endpoint (Next.js "Server Actions"
 * guide) — the Origin/Host CSRF check is NOT authorization. So each action:
 *   1. reads its hidden routing fields (courseId, and the immutable `type`)
 *      with a strict envelope schema, then
 *   2. parses the rest of the FormData with `zod` — a QUIZ shape or an
 *      ASSIGNMENT shape, never both — validating `feedbackBehaviour` against
 *      `FEEDBACK_BEHAVIOURS` and `allowedFileTypes` against the closed
 *      `ALLOWED_ASSIGNMENT_FILE_TYPES` list before anything reaches the
 *      service (T-10-13 — the browser control is never the only check), and
 *      only then
 *   3. delegates to `assessmentService` / `publishAssessment`, each of which
 *      re-resolves the Course scope from the row and gates on
 *      `assessments.create` / `assessments.edit`.
 *
 * `type` is immutable once created — `updateAssessmentAction` never writes
 * it, regardless of what a tampered form submits. Nothing in this file
 * imports `@prisma/client`; every write goes through a service (T-10-07,
 * asserted by an AST scan in `tests/assessment-staff-routes.test.ts`).
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { FieldError } from "@/components/primitives";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import type { ReadinessItem } from "@/server/services/readiness-service";
import {
  assessmentService,
  publishAssessment,
  AssessmentNotPublishableError,
  FEEDBACK_BEHAVIOURS,
  type AssessmentRecord,
} from "@/server/services/assessment-service";
import { ALLOWED_ASSIGNMENT_FILE_TYPES } from "@/lib/assignment-file-types";
import { parseCohortDateTime } from "@/lib/cohort-datetime";

const ASSESSMENT_TYPES = ["QUIZ", "ASSIGNMENT"] as const;
const ATTEMPT_GRADING_METHODS = ["HIGHEST", "LATEST", "AVERAGE"] as const;
const ASSESSMENT_TIMEZONE = "Africa/Lagos";

const optionalDateTime = z
  .string()
  .trim()
  .min(1)
  .transform((value, context) => {
    const parsed = parseCohortDateTime(value, ASSESSMENT_TIMEZONE);
    if (!parsed) {
      context.addIssue({ code: "custom", message: "Enter a valid date and time." });
      return z.NEVER;
    }
    return parsed;
  })
  .optional();

// ---------------------------------------------------------------------------
// Field extraction — FormData -> raw strings/arrays, blank -> undefined.
// ---------------------------------------------------------------------------

function textField(form: FormData, key: string): string | undefined {
  const raw = form.get(key);
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function rawFields(form: FormData, type: (typeof ASSESSMENT_TYPES)[number]) {
  const common = {
    title: textField(form, "title"),
    instructions: textField(form, "instructions"),
    availableFrom: textField(form, "availableFrom"),
    availableUntil: textField(form, "availableUntil"),
    feedbackBehaviour: textField(form, "feedbackBehaviour"),
    passMark: textField(form, "passMark"),
  };

  if (type === "QUIZ") {
    return {
      ...common,
      type,
      maxAttempts: textField(form, "maxAttempts"),
      attemptGradingMethod: textField(form, "attemptGradingMethod"),
    };
  }

  return {
    ...common,
    type,
    dueAt: textField(form, "dueAt"),
    allowedFileTypes: form
      .getAll("allowedFileTypes")
      .filter((value): value is string => typeof value === "string"),
    maxFileSizeBytes: textField(form, "maxFileSizeBytes"),
    allowResubmission: form.get("allowResubmission") === "on",
    totalMarks: textField(form, "totalMarks"),
  };
}

// ---------------------------------------------------------------------------
// zod schemas — a QUIZ shape or an ASSIGNMENT shape, discriminated on `type`.
// ---------------------------------------------------------------------------

const commonEditable = {
  title: z.string().trim().min(1, "Enter an assessment title.").max(200),
  instructions: z.string().trim().max(10_000).optional(),
  availableFrom: optionalDateTime,
  availableUntil: optionalDateTime,
  feedbackBehaviour: z.enum([...FEEDBACK_BEHAVIOURS], {
    message: "Choose a valid feedback behaviour.",
  }),
  passMark: z.coerce.number().int().min(0).max(1_000_000).optional(),
};

const quizEditable = {
  maxAttempts: z.coerce.number().int().min(1).max(1000).optional(),
  attemptGradingMethod: z.enum(ATTEMPT_GRADING_METHODS, {
    message: "Choose a valid attempt grading method.",
  }),
};

const assignmentEditable = {
  dueAt: optionalDateTime,
  allowedFileTypes: z
    .array(z.enum(ALLOWED_ASSIGNMENT_FILE_TYPES))
    .min(1, "Select at least one allowed file type."),
  maxFileSizeBytes: z.coerce
    .number()
    .int()
    .min(1, "Enter a maximum file size greater than zero."),
  allowResubmission: z.boolean(),
  totalMarks: z.coerce.number().int().min(0).max(1_000_000).optional(),
};

const createQuizSchema = z
  .object({ type: z.literal("QUIZ"), courseId: z.string().min(1), ...commonEditable, ...quizEditable })
  .strict();
const createAssignmentSchema = z
  .object({
    type: z.literal("ASSIGNMENT"),
    courseId: z.string().min(1),
    ...commonEditable,
    ...assignmentEditable,
  })
  .strict();
const createSchema = z.discriminatedUnion("type", [createQuizSchema, createAssignmentSchema]);

const updateQuizSchema = z
  .object({ type: z.literal("QUIZ"), ...commonEditable, ...quizEditable })
  .strict();
const updateAssignmentSchema = z
  .object({ type: z.literal("ASSIGNMENT"), ...commonEditable, ...assignmentEditable })
  .strict();
const updateSchema = z.discriminatedUnion("type", [updateQuizSchema, updateAssignmentSchema]);

type ParsedAssessment =
  | z.infer<typeof createQuizSchema>
  | z.infer<typeof createAssignmentSchema>
  | z.infer<typeof updateQuizSchema>
  | z.infer<typeof updateAssignmentSchema>;

/**
 * Every nullable Assessment column is written explicitly as `null` when the
 * caller cleared it — never omitted. Omitting a key from a partial `update`
 * payload leaves the prior value untouched (`resource-service.ts`'s
 * `delegate.update` forwards `data` as-is), so a blank "max attempts" field
 * meaning "unlimited" MUST land as `maxAttempts: null`, not be silently
 * dropped and leave a stale number in place.
 */
function buildAssessmentData(parsed: ParsedAssessment) {
  const common = {
    title: parsed.title,
    instructions: parsed.instructions ?? null,
    availableFrom: parsed.availableFrom ?? null,
    availableUntil: parsed.availableUntil ?? null,
    feedbackBehaviour: parsed.feedbackBehaviour,
    passMark: parsed.passMark ?? null,
  };

  if (parsed.type === "QUIZ") {
    return {
      ...common,
      maxAttempts: parsed.maxAttempts ?? null,
      attemptGradingMethod: parsed.attemptGradingMethod,
      // totalMarks is never written here — it is derived by
      // `saveQuizQuestions` (plan 10-10) as the sum of question marks, and
      // this form never renders it as an editable control (UI-SPEC §7.1).
    };
  }

  return {
    ...common,
    dueAt: parsed.dueAt ?? null,
    allowedFileTypes: parsed.allowedFileTypes,
    maxFileSizeBytes: parsed.maxFileSizeBytes,
    allowResubmission: parsed.allowResubmission,
    totalMarks: parsed.totalMarks ?? null,
  };
}

// ---------------------------------------------------------------------------
// Shared envelope + error mapping.
// ---------------------------------------------------------------------------

const envelopeSchema = z
  .object({
    courseId: z.string().trim().min(1),
    type: z.enum(ASSESSMENT_TYPES),
  })
  .strict();

const FRIENDLY_FIELD_MESSAGE: Record<string, string> = {
  title: "Enter an assessment title.",
  allowedFileTypes: "Select at least one allowed file type.",
  maxFileSizeBytes: "Enter a maximum file size greater than zero.",
  feedbackBehaviour: "Choose a valid feedback behaviour.",
  attemptGradingMethod: "Choose a valid attempt grading method.",
};

function zodFieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => {
    const name = typeof issue.path[0] === "string" ? issue.path[0] : "title";
    const isBaseStringCheck = issue.code === "invalid_type" || issue.code === "too_small";
    const friendly = isBaseStringCheck ? FRIENDLY_FIELD_MESSAGE[name] : undefined;
    return { name, message: friendly ?? issue.message };
  });
}

export type SaveAssessmentState = {
  ok: boolean | null;
  errors: FieldError[];
  message: string | null;
};

function toFailure(error: unknown): SaveAssessmentState {
  if (error instanceof z.ZodError) {
    return { ok: false, errors: zodFieldErrors(error), message: null };
  }
  if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
    return {
      ok: false,
      errors: [],
      message:
        "This assessment could not be saved. It may have moved, or your role no longer permits editing it.",
    };
  }
  throw error;
}

// ---------------------------------------------------------------------------
// createAssessmentAction
// ---------------------------------------------------------------------------

export async function createAssessmentAction(
  _prev: SaveAssessmentState,
  form: FormData,
): Promise<SaveAssessmentState> {
  const envelope = envelopeSchema.safeParse({
    courseId: textField(form, "courseId"),
    type: form.get("type"),
  });
  if (!envelope.success) {
    return {
      ok: false,
      errors: [],
      message: "The assessment form was incomplete. Reload the page and try again.",
    };
  }
  const { courseId, type } = envelope.data;

  let parsed: z.infer<typeof createSchema>;
  try {
    parsed = createSchema.parse({ ...rawFields(form, type), courseId });
  } catch (error) {
    return toFailure(error);
  }

  const data = { ...buildAssessmentData(parsed), courseId, type };

  let created: { id: string };
  try {
    created = (await assessmentService.create(data)) as unknown as { id: string };
  } catch (error) {
    return toFailure(error);
  }

  // One `revalidatePath` call, targeting the list — the current route (this
  // create page) is about to be left behind by `redirect()` below, and per
  // the Next.js 16.3.4 Server Actions guide, `revalidatePath` already bundles
  // a fresh RSC payload for whatever route the action IS invoked from into
  // its own response, so a second call for "this page" would be redundant.
  revalidatePath(`/staff/courses/${courseId}/assessments`);
  redirect(`/staff/courses/${courseId}/assessments/${created.id}`);
}

// ---------------------------------------------------------------------------
// updateAssessmentAction
// ---------------------------------------------------------------------------

export async function updateAssessmentAction(
  assessmentId: string,
  _prev: SaveAssessmentState,
  form: FormData,
): Promise<SaveAssessmentState> {
  const envelope = envelopeSchema.safeParse({
    courseId: textField(form, "courseId"),
    type: form.get("type"),
  });
  if (!envelope.success) {
    return {
      ok: false,
      errors: [],
      message: "The assessment form was incomplete. Reload the page and try again.",
    };
  }
  const { courseId, type } = envelope.data;

  let parsed: z.infer<typeof updateSchema>;
  try {
    parsed = updateSchema.parse(rawFields(form, type));
  } catch (error) {
    return toFailure(error);
  }

  const data = buildAssessmentData(parsed);

  try {
    await assessmentService.update(assessmentId, data, "Edited from the assessment editor.");
  } catch (error) {
    return toFailure(error);
  }

  // One call, targeting the list. The Next.js 16.3.4 Server Actions guide
  // ("When updateTag, revalidatePath, or refresh runs, Next.js re-renders
  // the current route... in the action's response") means this same call
  // already carries a fresh RSC payload back to THIS edit page in the same
  // round trip — no second `revalidatePath` for `assessments/${assessmentId}`
  // is needed, and no `router.refresh()` (forbidden — see actions.ts header).
  revalidatePath(`/staff/courses/${courseId}/assessments`);
  return { ok: true, errors: [], message: null };
}

// ---------------------------------------------------------------------------
// archiveAssessmentAction — CAT-08: archive replaces delete throughout.
// ---------------------------------------------------------------------------

export type ArchiveAssessmentResult = { ok: true } | { ok: false; message: string };

const archiveSchema = z
  .object({
    assessmentId: z.string().min(1),
    courseId: z.string().min(1),
    reason: z.string().trim().min(10).max(500),
  })
  .strict();

export async function archiveAssessmentAction(
  input: z.input<typeof archiveSchema>,
): Promise<ArchiveAssessmentResult> {
  const parsed = archiveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Give a reason of at least 10 characters." };
  }

  try {
    await assessmentService.archive(parsed.data.assessmentId, parsed.data.reason);
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
      return { ok: false, message: "This assessment could not be archived." };
    }
    throw error;
  }

  revalidatePath(`/staff/courses/${parsed.data.courseId}/assessments`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// publishAssessmentAction — readiness-gated, never a silent partial publish.
// ---------------------------------------------------------------------------

export type PublishAssessmentResult =
  | { ok: true; status: string; version: number }
  | { ok: false; items: ReadinessItem[]; message: string };

const publishSchema = z.object({ assessmentId: z.string().min(1) }).strict();

export async function publishAssessmentAction(
  input: z.input<typeof publishSchema>,
): Promise<PublishAssessmentResult> {
  const parsed = publishSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      items: [],
      message: "The assessment could not be identified. Reload the page and try again.",
    };
  }

  let after: AssessmentRecord;
  try {
    after = (await publishAssessment({ assessmentId: parsed.data.assessmentId })) as AssessmentRecord;
  } catch (error) {
    if (error instanceof AssessmentNotPublishableError) {
      return { ok: false, items: error.failures, message: error.message };
    }
    if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
      return { ok: false, items: [], message: "This assessment could not be published." };
    }
    throw error;
  }

  // One call, targeting the list — this action is invoked from the edit
  // page itself, and per the Next.js 16.3.4 Server Actions guide the
  // revalidation call already bundles a fresh RSC payload for THAT current
  // route into its own response, so this single call is both what makes the
  // list page's cached status/version stale AND what refreshes the page the
  // staff member is looking at — never a follow-up `router.refresh()`.
  revalidatePath(`/staff/courses/${after.courseId}/assessments`);
  return { ok: true, status: after.status, version: after.version };
}
