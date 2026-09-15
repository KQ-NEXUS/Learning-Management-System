"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getCurrentActor } from "@/server/auth/current-actor";
import { loadLearnerQuiz, toSafeQuizAttempt, quizResultForLearner } from "@/server/services/learner-quiz-service";
import { startAttempt, saveAttemptAnswers, submitAttempt, getOwnAttempt, AttemptNotStartableError, AttemptNotWritableError } from "@/server/services/attempt-service";

const route = { enrolmentId: z.string().min(1), lessonId: z.string().min(1) };
const startSchema = z.object({ ...route, assessmentId: z.string().min(1), startNew: z.boolean().optional() }).strict();
const answerSchema = z.object({ ...route, attemptId: z.string().min(1), responses: z.array(z.object({
  questionId: z.string().min(1), selectedOptionIds: z.array(z.string().min(1)).max(100),
}).strict()).max(200) }).strict();

function refusal(error: unknown) {
  if (error instanceof AttemptNotStartableError || error instanceof AttemptNotWritableError) {
    if (error.reason === "window-closed") return "The window for this assessment has closed.";
    if (error.reason === "window-not-open") return "The window for this assessment has not opened yet.";
    if (error.reason === "attempt-limit-reached") return "You've used all of your attempts for this quiz.";
  }
  return "This quiz could not be opened. Reload the lesson and try again.";
}

export async function startAttemptAction(input: unknown) {
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "The quiz request was incomplete." };
  const actor = await getCurrentActor();
  if (!actor) return { ok: false as const, message: "Sign in to start this quiz." };
  try {
    const quiz = await loadLearnerQuiz(actor, parsed.data);
    if (!quiz || quiz.assessmentId !== parsed.data.assessmentId) return { ok: false as const, message: "This quiz could not be opened." };
    const attempt = await startAttempt(actor, parsed.data);
    return { ok: true as const, attempt: toSafeQuizAttempt(attempt) };
  } catch (error) { return { ok: false as const, message: refusal(error) }; }
}

export async function saveAttemptAnswersAction(input: unknown) {
  const parsed = answerSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "The answers were incomplete." };
  const actor = await getCurrentActor();
  if (!actor) return { ok: false as const, message: "Sign in to save your answers." };
  try {
    const quiz = await loadLearnerQuiz(actor, parsed.data);
    const attempt = await getOwnAttempt(actor, parsed.data.attemptId);
    if (!quiz || !attempt || attempt.enrolmentId !== parsed.data.enrolmentId || attempt.assessmentId !== quiz.assessmentId) return { ok: false as const, message: "This attempt could not be opened." };
    await saveAttemptAnswers(actor, parsed.data);
    return { ok: true as const };
  } catch (error) { return { ok: false as const, message: refusal(error) }; }
}

export async function submitAttemptAction(input: unknown) {
  const parsed = answerSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "The answers were incomplete." };
  const actor = await getCurrentActor();
  if (!actor) return { ok: false as const, message: "Sign in to submit your quiz." };
  let saved = false;
  try {
    const quiz = await loadLearnerQuiz(actor, parsed.data);
    const attempt = await getOwnAttempt(actor, parsed.data.attemptId);
    if (!quiz || !attempt || attempt.enrolmentId !== parsed.data.enrolmentId || attempt.assessmentId !== quiz.assessmentId) return { ok: false as const, message: "This attempt could not be opened." };
    if (attempt.status === "EXPIRED" || attempt.status === "SUBMITTED") {
      const result = quiz.history.find(a => a.attemptId === attempt.id);
      if (result) {
        revalidatePath(`/learn/${parsed.data.enrolmentId}/lessons/${parsed.data.lessonId}`);
        return { ok: true as const, result };
      }
    }
    await saveAttemptAnswers(actor, parsed.data);
    saved = true;
    const result = await submitAttempt(actor, parsed.data);
    revalidatePath(`/learn/${parsed.data.enrolmentId}/lessons/${parsed.data.lessonId}`);
    return { ok: true as const, result: quizResultForLearner(result, quiz.feedbackBehaviour) };
  } catch {
    return { ok: false as const, message: "Your quiz couldn't be submitted", body: saved
      ? "Something went wrong scoring your attempt. Your answers are saved — try submitting again."
      : "Your answers could not be saved. Keep this page open and try submitting again." };
  }
}
