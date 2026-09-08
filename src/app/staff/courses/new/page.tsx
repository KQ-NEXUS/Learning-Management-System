import { notFound } from "next/navigation";
import { AuthenticationError, AuthorizationError, can } from "@/server/permissions";
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="font-mono text-[11px] text-muted-foreground">Staff / Courses</p>
        <h1 className="text-lg font-semibold tracking-tight">New course</h1>
      </div>
      <CourseForm mode="create" />
    </div>
  );
}
