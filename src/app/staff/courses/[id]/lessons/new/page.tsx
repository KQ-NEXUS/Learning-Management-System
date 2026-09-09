import { notFound } from "next/navigation";
import { AuthorizationError } from "@/server/permissions";
import { moduleService, type ModuleRecord } from "@/server/services/module-service";
import { LessonEditorClient } from "../[lessonId]/LessonEditorClient";

export const metadata = { title: "New lesson" };

export default async function NewLessonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ moduleId?: string }>;
}) {
  const { id: courseId } = await params;
  const { moduleId } = await searchParams;

  // A Lesson with no parent Module cannot be scoped, and `parseLessonInput`
  // requires `moduleId` on create — a missing or unknown target is a 404, not a
  // silent default. Module creation is plan 04-09's job, on the arrange screen,
  // which links here with `?moduleId=<id>`.
  if (!moduleId) notFound();

  let parentModule: ModuleRecord | null;
  try {
    parentModule = await moduleService.get(moduleId);
  } catch (error) {
    if (error instanceof AuthorizationError) notFound();
    throw error;
  }

  if (
    !parentModule ||
    parentModule.courseId !== courseId ||
    parentModule.withdrawnAt !== null
  ) {
    notFound();
  }

  return (
    <LessonEditorClient
      mode="create"
      courseId={courseId}
      moduleId={moduleId}
      initialType="TEXT"
      values={{ required: true, allowManualComplete: true }}
    />
  );
}
