import { notFound } from "next/navigation";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { courseService } from "@/server/services/course-service";
import { AssessmentFormFields } from "@/components/catalogue/AssessmentFormFields";

export const metadata = { title: "New assessment" };

/**
 * The Assessment create route (ASM-01, ASM-03). `type` (Quiz/Assignment) is
 * chosen here and is fixed afterwards — `Assessment.type` discriminates
 * which settings columns are meaningful.
 */
export default async function NewAssessmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: courseId } = await params;

  let course: { id: string } | null;
  try {
    course = (await courseService.get(courseId)) as unknown as { id: string } | null;
  } catch (error) {
    // A denial must not confirm existence — same response as "not found".
    if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
      notFound();
    }
    throw error;
  }
  if (!course) notFound();

  return <AssessmentFormFields mode="create" courseId={courseId} />;
}
