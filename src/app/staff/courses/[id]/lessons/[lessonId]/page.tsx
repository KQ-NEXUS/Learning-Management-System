import { notFound } from "next/navigation";
import { AuthorizationError } from "@/server/permissions";
import { lessonService, type LessonRecord } from "@/server/services/lesson-service";
import type { LessonType } from "@/lib/upload-limits";
import { formatVideoLength } from "@/lib/lesson-input";
import { LessonEditorClient } from "./LessonEditorClient";
import { loadLinkableAssessments } from "../linkable-assessments";

export const metadata = { title: "Edit lesson" };

export default async function EditLessonPage({
  params,
}: {
  params: Promise<{ id: string; lessonId: string }>;
}) {
  const { id: courseId, lessonId } = await params;

  let lesson: LessonRecord | null;
  try {
    lesson = await lessonService.get(lessonId);
  } catch (error) {
    // A denial must not confirm existence — same response as "not found".
    if (error instanceof AuthorizationError) notFound();
    throw error;
  }

  if (!lesson) notFound();
  const assessmentOptions = await loadLinkableAssessments(courseId);

  return (
    <LessonEditorClient
      mode="edit"
      courseId={courseId}
      lessonId={lesson.id}
      initialType={lesson.type as LessonType}
      assessmentOptions={assessmentOptions}
      values={{
        title: lesson.title,
        body: lesson.body ?? "",
        embedUrl: lesson.embedUrl ?? "",
        linkUrl: lesson.linkUrl ?? "",
        required: lesson.required,
        allowManualComplete: lesson.allowManualComplete,
        assessmentId: lesson.assessmentId,
        videoLength: formatVideoLength(lesson.videoDurationSeconds),
      }}
    />
  );
}
