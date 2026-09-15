import { notFound } from "next/navigation";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { loadAssessmentForAuthoring } from "@/server/services/assessment-service";
import { QuestionBuilder } from "@/components/catalogue/QuestionBuilder";
import { UnsavedOrderProvider } from "@/components/catalogue/UnsavedOrderGuard";
import { saveQuizQuestionsAction } from "../question-actions";
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
 * The permission-gated aggregate supplies both readiness and authored questions.
 */
export default async function EditAssessmentPage({
  params,
}: {
  params: Promise<{ id: string; assessmentId: string }>;
}) {
  const { id: courseId, assessmentId } = await params;

  let assessment: Awaited<ReturnType<typeof loadAssessmentForAuthoring>>;
  try {
    assessment = await loadAssessmentForAuthoring({ assessmentId });
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
    questions: assessment.questions,
  });

  return (
    <UnsavedOrderProvider>
    <AssessmentFormFields
      mode="edit"
      courseId={courseId}
      assessmentId={assessment.id}
      status={assessment.status}
      version={assessment.version}
      readinessItems={readinessItems}
      initialValues={initialValues}
    />
    {assessment.type === "QUIZ" && assessment.status !== "ARCHIVED" && (
      <QuestionBuilder
        assessmentId={assessment.id}
        initialQuestions={assessment.questions.map(question => ({
          prompt: question.prompt, type: question.type, marks: question.marks,
          explanation: question.explanation ?? null,
          options: question.options.map(option => ({ label: option.label, isCorrect: option.isCorrect })),
        }))}
        onSubmit={saveQuizQuestionsAction}
      />
    )}
    </UnsavedOrderProvider>
  );
}
