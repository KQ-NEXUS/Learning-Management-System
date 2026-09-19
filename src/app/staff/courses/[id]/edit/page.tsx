import { notFound } from "next/navigation";
import { AuthenticationError, AuthorizationError, can } from "@/server/permissions";
import { courseService } from "@/server/services/course-service";
import {
  certificateTemplateService,
  listSelectableTemplates,
} from "@/server/services/certificate-template-service";
import { CourseForm } from "../../CourseForm";

export const metadata = { title: "Edit course" };

type CourseRow = {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  outcomes: string | null;
  audience: string | null;
  prerequisites: string | null;
  durationHours: number | null;
  certificateEnabled: boolean;
  certificateIssuanceMode: "AUTOMATIC" | "MANUAL";
  certificateTemplateId: string | null;
};

export default async function EditCoursePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let course: CourseRow | null;
  let allowed: boolean;
  try {
    course = (await courseService.get(id)) as unknown as CourseRow | null;
    if (!course) notFound();
    allowed = await can("courses.edit", { courseIds: [id] });
  } catch (error) {
    // A denial must not confirm existence — same response as "not found".
    if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
      notFound();
    }
    throw error;
  }
  if (!allowed) notFound();

  // A role that can edit a Course but lacks certificates.view still gets the
  // form — just with an empty picker, falling back to "Use the default
  // template" rather than a hard denial of the whole page.
  let templates: { id: string; name: string; isDefault: boolean }[] = [];
  try {
    templates = await listSelectableTemplates();
  } catch (error) {
    if (!(error instanceof AuthorizationError || error instanceof AuthenticationError)) throw error;
  }

  // Label the stored template if it has since been archived (absent from the
  // selectable list) so the form can keep it visible instead of resetting it.
  let certificateTemplateName: string | null = null;
  if (
    course.certificateTemplateId &&
    !templates.some((template) => template.id === course.certificateTemplateId)
  ) {
    try {
      const stored = (await certificateTemplateService.get(course.certificateTemplateId)) as
        | { name: string }
        | null;
      certificateTemplateName = stored?.name ?? null;
    } catch (error) {
      if (!(error instanceof AuthorizationError || error instanceof AuthenticationError)) throw error;
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="font-mono text-[11px] text-muted-foreground">
          Staff / Courses / {course.title}
        </p>
        <h1 className="text-lg font-semibold tracking-tight">Edit course</h1>
      </div>
      <CourseForm
        mode="edit"
        courseId={id}
        templates={templates}
        values={{
          title: course.title,
          slug: course.slug,
          summary: course.summary,
          outcomes: course.outcomes,
          audience: course.audience,
          prerequisites: course.prerequisites,
          durationHours: course.durationHours,
          certificateEnabled: course.certificateEnabled,
          certificateIssuanceMode: course.certificateIssuanceMode,
          certificateTemplateId: course.certificateTemplateId,
          certificateTemplateName,
        }}
      />
    </div>
  );
}
