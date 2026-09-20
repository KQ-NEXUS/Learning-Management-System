import { prisma } from "@/server/db";
import type { Actor } from "@/server/permissions";
import { loadLearnerPath, assertLessonOpenable } from "./learner-access";
import { getOwnAssessmentResult, getOwnAttempt, type AttemptRow, type AttemptResultView } from "./attempt-service";

export function quizResultForLearner(result: AttemptResultView, feedbackBehaviour: string): AttemptResultView {
  return feedbackBehaviour === "NEVER" ? { ...result, perQuestion: [] } : result;
}

// Explicitly project the snapshot: hiding answers in JSX would still leak them in the RSC payload.
export function toSafeQuizAttempt(attempt: AttemptRow) {
  return {
    id: attempt.id, attemptNumber: attempt.attemptNumber,
    questions: (attempt.answers?.questionSnapshot ?? []).map(q => ({
      id: q.id, prompt: q.prompt, type: q.type, marks: q.marks,
      options: q.options.map(o => ({ id: o.id, label: o.label })),
    })),
    responses: attempt.answers?.responses ?? [],
  };
}
export type SafeQuizAttempt = ReturnType<typeof toSafeQuizAttempt>;

export async function loadLearnerQuiz(actor: Actor, input: { enrolmentId: string; lessonId: string }) {
  const path = await loadLearnerPath(actor, input.enrolmentId);
  if (!path || !assertLessonOpenable(path, input.lessonId).ok) return null;
  const lesson = path.courses.flatMap(c => c.modules.flatMap(m => m.lessons)).find(l => l.id === input.lessonId);
  if (!lesson || lesson.type !== "QUIZ") return null;
  const linked = await prisma.lesson.findUnique({ where: { id: input.lessonId }, select: { assessmentId: true } });
  if (!linked?.assessmentId) return null;
  const assessment = await prisma.assessment.findUnique({ where: { id: linked.assessmentId }, select: {
    id: true, title: true, instructions: true, status: true, type: true, availableFrom: true,
    availableUntil: true, maxAttempts: true, passMark: true, feedbackBehaviour: true,
  } });
  if (!assessment || assessment.status !== "PUBLISHED" || assessment.type !== "QUIZ") return null;
  const results = await getOwnAssessmentResult(actor, { assessmentId: assessment.id, enrolmentId: input.enrolmentId });
  if (!results) return null;
  const unfinished = await prisma.attempt.findFirst({ where: { assessmentId: assessment.id, enrolmentId: input.enrolmentId, status: "IN_PROGRESS" }, orderBy: { attemptNumber: "desc" }, select: { id: true } });
  const attempt = unfinished ? await getOwnAttempt(actor, unfinished.id) : null;
  const abandoned = await prisma.attempt.findMany({ where: { assessmentId: assessment.id, enrolmentId: input.enrolmentId, status: "ABANDONED" }, select: { id: true, attemptNumber: true, submittedAt: true } });
  const history: AttemptResultView[] = [
    ...results.attempts.map(a => quizResultForLearner(a, assessment.feedbackBehaviour)),
    ...abandoned.map(a => ({ attemptId: a.id, attemptNumber: a.attemptNumber, submittedAt: a.submittedAt, status: "ABANDONED" as const, score: null, maxScore: null, passed: null, perQuestion: [], expired: false })),
  ].sort((a,b) => b.attemptNumber-a.attemptNumber);
  return {
    assessmentId: assessment.id, title: assessment.title, instructions: assessment.instructions,
    availableFrom: assessment.availableFrom?.toISOString() ?? null,
    availableUntil: assessment.availableUntil?.toISOString() ?? null,
    maxAttempts: assessment.maxAttempts, passMark: assessment.passMark,
    attemptsRemaining: results.attemptsRemaining,
    feedbackBehaviour: assessment.feedbackBehaviour,
    active: attempt?.status === "IN_PROGRESS" ? toSafeQuizAttempt(attempt) : null,
    history,
    result: history.find(a => a.status === "SUBMITTED" || a.status === "EXPIRED") ?? null,
  };
}
export type LearnerQuizView = NonNullable<Awaited<ReturnType<typeof loadLearnerQuiz>>>;
