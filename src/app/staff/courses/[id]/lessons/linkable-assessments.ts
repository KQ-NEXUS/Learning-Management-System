import { assessmentService } from "@/server/services/assessment-service";
import type { LinkableAssessment } from "@/components/catalogue/LessonFormFields";

/**
 * This course's assessments for the lesson editor's Quiz/Assignment picker.
 * Course-scoped like the Assessments list. A caller who cannot view
 * assessments gets an empty list — the picker then explains there is nothing
 * to link — rather than a broken editor; saving still re-checks the link on
 * the server (lesson-service `assertAssessmentLink`).
 */
export async function loadLinkableAssessments(courseId: string): Promise<LinkableAssessment[]> {
  try {
    const rows = (await assessmentService.list({
      where: { courseId },
      scope: { courseIds: [courseId] },
    })) as unknown as Array<{ id: string; title: string; type: string; status: string }>;
    return rows
      .filter((r): r is LinkableAssessment => r.type === "QUIZ" || r.type === "ASSIGNMENT")
      .map(({ id, title, type, status }) => ({ id, title, type, status }));
  } catch {
    return [];
  }
}
