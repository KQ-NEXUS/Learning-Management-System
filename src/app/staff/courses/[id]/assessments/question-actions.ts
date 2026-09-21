"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { loadAssessmentForAuthoring, saveQuizQuestions, NotAQuizError } from "@/server/services/assessment-service";
import type { QuestionSaveResult } from "@/components/catalogue/QuestionBuilder";

const schema = z.object({
  assessmentId: z.string().min(1),
  questions: z.array(z.object({
    prompt: z.string().trim().min(1, "Enter a question prompt.").max(10000),
    type: z.enum(["SINGLE_CHOICE", "MULTI_CHOICE", "TRUE_FALSE"]),
    marks: z.number().int().positive().max(1000000),
    explanation: z.string().max(10000).nullable(),
    options: z.array(z.object({ label: z.string().trim().min(1).max(2000), isCorrect: z.boolean() }).strict()).min(2).max(100),
  }).strict()).max(200),
}).strict();

export async function saveQuizQuestionsAction(input: unknown): Promise<QuestionSaveResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  try {
    const assessment = await loadAssessmentForAuthoring({ assessmentId: parsed.data.assessmentId });
    if (!assessment) return { ok: false, message: "This assessment could not be found." };
    const saved = await saveQuizQuestions(parsed.data);
    revalidatePath(`/staff/courses/${assessment.courseId}/assessments/${assessment.id}`);
    return { ok: true, totalMarks: saved.totalMarks };
  } catch (error) {
    if (error instanceof NotAQuizError) return { ok: false, message: "Questions can only be saved to a quiz." };
    if (error instanceof AuthenticationError || error instanceof AuthorizationError) {
      return { ok: false, message: "Your role no longer permits editing this assessment." };
    }
    throw error;
  }
}
