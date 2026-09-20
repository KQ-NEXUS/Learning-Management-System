/** DD-15: learner reads derive every enrolment from the authenticated owner.
 * Released scores are selected in the database before constructing a payload. */
import { prisma } from "@/server/db";
import type { Actor } from "@/server/permissions/with-permission";
import { loadLearnerPath, type LearnerPath } from "./learner-access";
import { getOwnAssessmentResult } from "./attempt-service";
import { getOwnSubmissions } from "./submission-service";
import { selectEffectiveAttempt, type AttemptGradingMethod } from "./quiz-scoring";

export type ResultsAssessment = {
  id: string; courseId: string; title: string; type: "QUIZ" | "ASSIGNMENT";
  passMark: number | null; totalMarks: number | null; dueAt: Date | null;
  maxAttempts: number | null; attemptGradingMethod: AttemptGradingMethod; feedbackBehaviour: string;
  lessons: Array<{ id: string }>;
};
export type ResultsGrade = {
  id: string; assessmentId: string; enrolmentId: string; attemptId: string | null;
  score: number; maxScore: number; passed: boolean | null; feedback: string | null;
  status: string; releasedAt: Date | null;
  overrides: Array<{ previousScore: number; newScore: number; reason: string; actorId: string | null; createdAt: Date }>;
};
export type LearnerResultCard = {
  assessmentId: string; title: string; type: "QUIZ" | "ASSIGNMENT";
  effectiveScore: number | null; maxScore: number | null; passed: boolean | null;
  passMark: number | null; feedback: string | null; attemptsRemaining: number | null;
  history: Array<{ kind: "attempt" | "submission"; ref: string; number: number; at: Date; status: string; score: number | null; isLate?: boolean }>;
  overrides: Array<{ previousScore: number; newScore: number; reason: string; actorName: string | null; at: Date }>;
};
export type AssessmentObligation = { assessmentId: string; title: string; type: "QUIZ" | "ASSIGNMENT"; lessonId: string | null; dueAt: Date | null; state: "not-started" | "in-progress" | "not-submitted" };
export type LearnerResultsDeps = {
  enrolment: { findMany(args: { where: { userId: string; id?: string; status: "ACTIVE" }; select: { id: true; userId: true } }): Promise<Array<{ id: string; userId: string }>> };
  loadPath: typeof loadLearnerPath;
  assessment: { findMany(args: { where: { courseId: { in: string[] }; status: "PUBLISHED" }; include: { lessons: { select: { id: true } } } }): Promise<ResultsAssessment[]> };
  grade: { findMany(args: { where: { enrolmentId: string; status: "RELEASED" }; include: { overrides: { orderBy: { createdAt: "asc" } } }; orderBy: { releasedAt: "desc" } }): Promise<ResultsGrade[]> };
  quizResult: typeof getOwnAssessmentResult;
  submissions: typeof getOwnSubmissions;
  user: { findMany(args: { where: { id: { in: string[] } }; select: { id: true; name: true } }): Promise<Array<{ id: string; name: string | null }>> };
  attempt: { findMany(args: { where: { enrolmentId: string; assessmentId: string; status: "IN_PROGRESS" }; select: { id: true } }): Promise<Array<{ id: string }>> };
};

function orderAssessments(path: LearnerPath, assessments: ResultsAssessment[]) {
  const lessonOrder = new Map<string, number>();
  const courseOrder = new Map<string, number>();
  let position = 0;
  for (const course of path.courses) {
    courseOrder.set(course.courseId, position);
    for (const group of course.modules) for (const lesson of group.lessons) lessonOrder.set(lesson.id, position++);
    position++;
  }
  const rank = (a: ResultsAssessment) => Math.min(...a.lessons.map(l => lessonOrder.get(l.id) ?? Infinity), (courseOrder.get(a.courseId) ?? Infinity) + 100000);
  return assessments.slice().sort((a,b) => rank(a)-rank(b) || a.id.localeCompare(b.id));
}

export function createLearnerResultsService(deps: LearnerResultsDeps) {
  async function contexts(actor: Actor, enrolmentId?: string) {
    const enrolments = await deps.enrolment.findMany({ where: { userId: actor.userId, ...(enrolmentId ? { id: enrolmentId } : {}), status: "ACTIVE" }, select: { id: true, userId: true } });
    const result: Array<{ enrolmentId: string; assessments: ResultsAssessment[] }> = [];
    for (const enrolment of enrolments) {
      const path = await deps.loadPath(actor, enrolment.id);
      if (!path) continue;
      const assessments = await deps.assessment.findMany({ where: { courseId: { in: path.courses.map(c => c.courseId) }, status: "PUBLISHED" }, include: { lessons: { select: { id: true } } } });
      result.push({ enrolmentId: enrolment.id, assessments: orderAssessments(path, assessments) });
    }
    return result;
  }

  async function getOwnResults(actor: Actor, input: { enrolmentId?: string }): Promise<LearnerResultCard[]> {
    const cards: LearnerResultCard[] = [];
    for (const context of await contexts(actor, input.enrolmentId)) {
      const quizResults = new Map<string, Awaited<ReturnType<typeof getOwnAssessmentResult>>>();
      // Resolve lazy quiz expiry before loading grades, so a newly auto-released
      // result is visible in this very read.
      for (const assessment of context.assessments) if (assessment.type === "QUIZ") quizResults.set(assessment.id, await deps.quizResult(actor, { assessmentId: assessment.id, enrolmentId: context.enrolmentId }));
      // DRAFT grades never enter this query result or an RSC payload.
      const grades = await deps.grade.findMany({ where: { enrolmentId: context.enrolmentId, status: "RELEASED" }, include: { overrides: { orderBy: { createdAt: "asc" } } }, orderBy: { releasedAt: "desc" } });
      const actorIds = [...new Set(grades.flatMap(g => g.overrides.flatMap(o => o.actorId ? [o.actorId] : [])))];
      const actors = new Map((await deps.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })).map(u => [u.id,u.name]));
      for (const assessment of context.assessments) {
        const released = grades.filter(g => g.assessmentId === assessment.id).sort((a,b) => (b.releasedAt?.getTime() ?? 0) - (a.releasedAt?.getTime() ?? 0));
        if (released.length === 0) continue;
        const grade = released[0];
        let effectiveScore: number | null = grade.score, maxScore: number | null = grade.maxScore, passed = grade.passed;
        let attemptsRemaining: number | null = null;
        let history: LearnerResultCard["history"];
        if (assessment.type === "QUIZ") {
          const result = quizResults.get(assessment.id);
          const byAttempt = new Map(released.filter(g => g.attemptId).map(g => [g.attemptId,g]));
          const visible = (result?.attempts ?? []).filter(a => byAttempt.has(a.attemptId));
          const effective = selectEffectiveAttempt(assessment.attemptGradingMethod, assessment.passMark, visible.map(a => ({ attemptNumber: a.attemptNumber, status: a.status, score: byAttempt.get(a.attemptId)!.score, maxScore: byAttempt.get(a.attemptId)!.maxScore })));
          effectiveScore = effective?.score ?? null; maxScore = effective?.maxScore ?? null; passed = effective?.passed ?? null;
          attemptsRemaining = result?.attemptsRemaining ?? null;
          history = visible.sort((a,b) => b.attemptNumber-a.attemptNumber).map(a => ({ kind: "attempt", ref: a.attemptId, number: a.attemptNumber, at: a.submittedAt ?? new Date(0), status: a.status, score: byAttempt.get(a.attemptId)!.score }));
        } else {
          history = (await deps.submissions(actor, { assessmentId: assessment.id, enrolmentId: context.enrolmentId })).sort((a,b) => b.attemptNumber-a.attemptNumber).map(s => ({ kind: "submission", ref: s.receiptId, number: s.attemptNumber, at: s.submittedAt, status: s.uploadStatus, score: null, isLate: s.isLate }));
        }
        cards.push({ assessmentId: assessment.id, title: assessment.title, type: assessment.type, effectiveScore, maxScore, passed, passMark: assessment.passMark, attemptsRemaining, feedback: assessment.feedbackBehaviour === "NEVER" ? null : grade.feedback, history,
          overrides: released.flatMap(g => g.overrides).sort((a,b) => a.createdAt.getTime()-b.createdAt.getTime()).map(o => ({ previousScore:o.previousScore,newScore:o.newScore,reason:o.reason,actorName:o.actorId ? actors.get(o.actorId) ?? null : null,at:o.createdAt })) });
      }
    }
    return cards;
  }

  async function getOwnAssessmentObligations(actor: Actor, input: { enrolmentId: string }): Promise<AssessmentObligation[]> {
    const obligations: AssessmentObligation[] = [];
    for (const context of await contexts(actor, input.enrolmentId)) for (const assessment of context.assessments) {
      if (assessment.type === "QUIZ") {
        const result = await deps.quizResult(actor, { assessmentId: assessment.id, enrolmentId: context.enrolmentId });
        if (result?.effective) continue;
        const active = await deps.attempt.findMany({ where: { enrolmentId: context.enrolmentId, assessmentId: assessment.id, status: "IN_PROGRESS" }, select: { id: true } });
        obligations.push({ assessmentId: assessment.id, title: assessment.title, type: assessment.type, lessonId: assessment.lessons[0]?.id ?? null, dueAt: assessment.dueAt, state: active.length ? "in-progress" : "not-started" });
      } else if (!(await deps.submissions(actor, { assessmentId: assessment.id, enrolmentId: context.enrolmentId })).some(s => s.uploadStatus === "READY")) {
        obligations.push({ assessmentId: assessment.id, title: assessment.title, type: assessment.type, lessonId: assessment.lessons[0]?.id ?? null, dueAt: assessment.dueAt, state: "not-submitted" });
      }
    }
    return obligations;
  }
  return { getOwnResults, getOwnAssessmentObligations };
}

const built = createLearnerResultsService({ enrolment: prisma.enrolment, loadPath: loadLearnerPath, assessment: prisma.assessment, grade: prisma.grade, user: prisma.user, attempt: prisma.attempt, quizResult: getOwnAssessmentResult, submissions: getOwnSubmissions });
export const getOwnResults = built.getOwnResults;
export const getOwnAssessmentObligations = built.getOwnAssessmentObligations;
