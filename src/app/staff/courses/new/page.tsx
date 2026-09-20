import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/PageHeader";
import { AuthenticationError, AuthorizationError, can } from "@/server/permissions";
import { listSelectableTemplates } from "@/server/services/certificate-template-service";
import { CourseForm } from "../CourseForm";

export const metadata = { title: "New course" };

export default async function NewCoursePage() {
  let allowed: boolean;
  try {
    allowed = await can("courses.create", {});
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof AuthenticationError) notFound();
    throw error;
  }
  if (!allowed) notFound();

  // A role that can create a Course but lacks certificates.view (none in the
  // seeded default set today, but not guaranteed forever) still gets the
  // form — just with an empty picker, falling back to "Use the default
  // template" rather than a hard denial of the whole page.
  let templates: { id: string; name: string; isDefault: boolean }[] = [];
  try {
    templates = await listSelectableTemplates();
  } catch (error) {
    if (!(error instanceof AuthorizationError || error instanceof AuthenticationError)) throw error;
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="New course" breadcrumbs={[{ label: "Courses", href: "/staff/courses" }, { label: "New" }]} />
      <CourseForm mode="create" templates={templates} />
    </div>
  );
}
