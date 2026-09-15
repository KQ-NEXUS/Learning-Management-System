import { notFound } from "next/navigation";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { assessmentService, type AssessmentRecord } from "@/server/services/assessment-service";
import { evaluateAssessmentReadiness } from "@/server/services/assessment-readiness";
import {
  AssessmentFormFields,
  type AssessmentFieldValues,
} from "@/components/catalogue/AssessmentFormFields";

export const metadata = { title: "Edit assessment" };

/** `Date` -> the `datetime-local` input value shape ("YYYY-MM-DDTHH:mm"), or `null`. */
function toDatetimeLocal(value: Date | null): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 16);
}

/**
 * The Assessment edit route (ASM-01, ASM-03) — settings, a `ReadinessPanel`
 * driven by the SAME evaluator the publish refusal checks (T-10-14), and
 * publish/archive controls.
 *
 * No question-authoring UI exists yet (plan 10-10) — a freshly created Quiz
 * can never have a `QuizQuestion` row through this product today, so
 * `questions: []` is the honest current state fed into the evaluator here,
 * not a stand-in for data this route failed to load.
 */
export default async function EditAssessmentPage({
  params,
}: {
  params: Promise<{ id: string; assessmentId: string }>;
}) {
  const { id: courseId, assessmentId } = await params;

  let assessment: AssessmentRecord | null;
  try {
    assessment = (await assessmentService.get(assessmentId)) as unknown as AssessmentRecord | null;
  } catch (error) {
    // A denial must not confirm existence — same response as "not found".
    if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
      notFound();
    }
    throw error;
  }

  if (!assessment || assessment.courseId !== courseId) notFound();

  const initialValues: AssessmentFieldValues = {
    type: assessment.type as "QUIZ" | "ASSIGNMENT",
    title: assessment.title,
    instructions: assessment.instructions,
    availableFrom: toDatetimeLocal(assessment.availableFrom),
    availableUntil: toDatetimeLocal(assessment.availableUntil),
    feedbackBehaviour: assessment.feedbackBehaviour,
    passMark: assessment.passMark,
    totalMarks: assessment.totalMarks,
    maxAttempts: assessment.maxAttempts,
    attemptGradingMethod: assessment.attemptGradingMethod,
    dueAt: toDatetimeLocal(assessment.dueAt),
    allowedFileTypes: assessment.allowedFileTypes,
    maxFileSizeBytes: assessment.maxFileSizeBytes,
    allowResubmission: assessment.allowResubmission,
  };

  const readinessItems = evaluateAssessmentReadiness({
    type: initialValues.type,
    title: initialValues.title,
    instructions: initialValues.instructions,
    availableFrom: initialValues.availableFrom,
    availableUntil: initialValues.availableUntil,
    dueAt: initialValues.dueAt,
    maxAttempts: initialValues.maxAttempts,
    passMark: initialValues.passMark,
    totalMarks: initialValues.totalMarks,
    attemptGradingMethod: initialValues.attemptGradingMethod,
    feedbackBehaviour: initialValues.feedbackBehaviour,
    allowedFileTypes: initialValues.allowedFileTypes,
    maxFileSizeBytes: initialValues.maxFileSizeBytes,
    allowResubmission: initialValues.allowResubmission,
    questions: [],
  });

  return (
    <AssessmentFormFields
      mode="edit"
      courseId={courseId}
      assessmentId={assessment.id}
      status={assessment.status}
      version={assessment.version}
      readinessItems={readinessItems}
      initialValues={initialValues}
    />
  );
}
