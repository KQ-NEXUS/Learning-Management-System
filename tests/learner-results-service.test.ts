import { describe, expect, it, vi } from "vitest";
import { createLearnerResultsService, type LearnerResultsDeps, type ResultsAssessment, type ResultsGrade } from "@/server/services/learner-results-service";

const date = new Date("2026-09-01T12:00:00Z");
function harness() {
  const assessments: ResultsAssessment[] = [
    { id: "assignment", courseId: "course", title: "Released assignment", type: "ASSIGNMENT", passMark: 5, totalMarks: 10, dueAt: date, maxAttempts: null, feedbackBehaviour: "ON_RELEASE", attemptGradingMethod: "HIGHEST", lessons: [{ id: "l2" }] },
    { id: "draft", courseId: "course", title: "Hidden draft", type: "ASSIGNMENT", passMark: 5, totalMarks: 10, dueAt: date, maxAttempts: null, feedbackBehaviour: "ON_RELEASE", attemptGradingMethod: "HIGHEST", lessons: [{ id: "l3" }] },
    { id: "quiz", courseId: "course", title: "Quiz", type: "QUIZ", passMark: 5, totalMarks: 10, dueAt: null, maxAttempts: 4, feedbackBehaviour: "NEVER", attemptGradingMethod: "HIGHEST", lessons: [{ id: "l1" }] },
  ];
  const grades: ResultsGrade[] = [
    { id: "g1", assessmentId: "assignment", enrolmentId: "e1", attemptId: null, score: 8, maxScore: 10, passed: true, feedback: "Good work", releasedAt: date, status: "RELEASED", overrides: [{ previousScore: 6, newScore: 8, reason: "Correct grading mistake", actorId: "staff", createdAt: date }] },
    { id: "g2", assessmentId: "draft", enrolmentId: "e1", attemptId: null, score: 999, maxScore: 1000, passed: true, feedback: "Secret", releasedAt: null, status: "DRAFT", overrides: [] },
    ...[4,9,6].map((score, i) => ({ id: "qg"+i, assessmentId: "quiz", enrolmentId: "e1", attemptId: "at"+i, score, maxScore: 10, passed: score >= 5, feedback: "Secret feedback", releasedAt: date, status: "RELEASED", overrides: [] })),
  ];
  const gradeRead = vi.fn(async ({ where }) => grades.filter(g => g.status === where.status && g.enrolmentId === where.enrolmentId));
  const quizResult = vi.fn<LearnerResultsDeps["quizResult"]>(async () => ({ effective: { score: 9, maxScore: 10, passed: true, attemptNumber: 2 }, attempts: [4,9,6].map((score,i) => ({ attemptId: "at"+i, attemptNumber: i+1, status: "SUBMITTED", score, maxScore: 10, passed: score>=5, submittedAt: date, perQuestion: [], expired: false })), attemptsRemaining: 1 }));
  const submissions = vi.fn<LearnerResultsDeps["submissions"]>(async () => [2,1].map(n => ({ submissionId: "s"+n, receiptId: "receipt"+n, attemptNumber: n, filename: "file.pdf", sizeBytes: 100, submittedAt: date, isLate: n===2, uploadStatus: "READY" })));
  const service = createLearnerResultsService({
    enrolment: { findMany: async ({ where }) => where.userId === "learner" && (!where.id || where.id === "e1") ? [{ id: "e1", userId: "learner" }] : [] },
    loadPath: async () => ({ courses: [{ courseId: "course", modules: [{ lessons: [{ id: "l1" },{ id: "l2" },{ id: "l3" }] }] }] }) as never,
    attempt: { findMany: async () => [] }, assessment: { findMany: async () => assessments }, grade: { findMany: gradeRead },
    quizResult, submissions, user: { findMany: async () => [{ id: "staff", name: "Instructor", email: "private@example.test" }] },
  });
  return { service, assessments, grades, gradeRead, quizResult, submissions };
}

describe("learner released results", () => {
  it("excludes a draft from the entire serialized payload at the query boundary", async () => {
    const h=harness();const result=await h.service.getOwnResults({userId:"learner"},{});
    expect(result).toHaveLength(2);expect(JSON.stringify(result)).not.toMatch(/Hidden draft|999|Secret/);
    expect(h.gradeRead).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({status:"RELEASED",enrolmentId:"e1"})}));
  });
  it("returns nothing for another learner or another enrolment id", async () => {
    const h=harness();expect(await h.service.getOwnResults({userId:"stranger"},{})).toEqual([]);
    expect(await h.service.getOwnResults({userId:"learner"},{enrolmentId:"other"})).toEqual([]);
    expect(await h.service.getOwnAssessmentObligations({userId:"stranger"},{enrolmentId:"e1"})).toEqual([]);
    expect(h.gradeRead).not.toHaveBeenCalled();
  });
  it.each([["HIGHEST",9],["LATEST",6],["AVERAGE",6]] as const)("uses %s across released quiz grades",async(method,score)=>{
    const h=harness();h.assessments[2].attemptGradingMethod=method;
    const card=(await h.service.getOwnResults({userId:"learner"},{}))[0];
    expect(card).toMatchObject({assessmentId:"quiz",effectiveScore:score,attemptsRemaining:1,feedback:null});
    expect(h.quizResult).toHaveBeenCalledWith({userId:"learner"},{assessmentId:"quiz",enrolmentId:"e1"});
  });
  it("uses corrected quiz grade scores instead of the original attempt score",async()=>{
    const h=harness();h.grades.find(g=>g.id==='qg0')!.score=10;
    expect((await h.service.getOwnResults({userId:'learner'},{}))[0].effectiveScore).toBe(10);
  });
  it("preserves prior receipts, late flags, feedback and private attribution",async()=>{
    const h=harness();const card=(await h.service.getOwnResults({userId:'learner'},{}))[1];
    expect(card.feedback).toBe('Good work');expect(card.history.map(v=>v.ref)).toEqual(['receipt2','receipt1']);
    expect(card.history[0].isLate).toBe(true);expect(card.overrides[0]).toMatchObject({actorName:'Instructor',previousScore:6,newScore:8});
    expect(JSON.stringify(card)).not.toContain('private@example.test');
    h.assessments[0].feedbackBehaviour='NEVER';expect((await h.service.getOwnResults({userId:'learner'},{}))[1].feedback).toBeNull();
  });
  it.each([0, null])("preserves the remaining-attempt count %s", async attemptsRemaining => {
    const h = harness(); const result = await h.quizResult({ userId: "learner" }, { assessmentId: "quiz" });
    h.quizResult.mockResolvedValue({ ...result!, attemptsRemaining });
    expect((await h.service.getOwnResults({ userId: "learner" }, {}))[0].attemptsRemaining).toBe(attemptsRemaining);
  });
  it("returns ordered outstanding obligations and honest empty states",async()=>{
    const h=harness();h.quizResult.mockResolvedValue({effective:null,attempts:[],attemptsRemaining:null});h.submissions.mockResolvedValue([]);
    expect((await h.service.getOwnAssessmentObligations({userId:'learner'},{enrolmentId:'e1'})).map(v=>[v.assessmentId,v.lessonId])).toEqual([['quiz','l1'],['assignment','l2'],['draft','l3']]);
    h.assessments.splice(0);expect(await h.service.getOwnAssessmentObligations({userId:'learner'},{enrolmentId:'e1'})).toEqual([]);
  });
});
