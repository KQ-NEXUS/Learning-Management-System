import { notFound } from "next/navigation";
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
      <div className="flex flex-col gap-1">
        <p className="font-mono text-[11px] text-muted-foreground">Staff / Courses</p>
        <h1 className="text-lg font-semibold tracking-tight">New course</h1>
      </div>
      <CourseForm mode="create" templates={templates} />
    </div>
  );
}
