import { notFound } from "next/navigation";
import { courseService } from "@/server/services/course-service";
import { AuthorizationError } from "@/server/permissions";
import { DetailLayout, DetailFacts, StatusPill } from "@/components/primitives";

type Course = {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  status: string;
  contentVersion: number;
  durationHours: number | null;
  certificateEnabled: boolean;
};

const TONE: Record<string, "success" | "neutral" | "warning"> = {
  PUBLISHED: "success",
  DRAFT: "neutral",
  ARCHIVED: "warning",
};

export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let course: Course | null;
  try {
    course = (await courseService.get(id)) as unknown as Course | null;
  } catch (error) {
    if (error instanceof AuthorizationError) {
      // Same response as "not found" — a denial must not confirm existence.
      notFound();
    }
    throw error;
  }

  if (!course) notFound();

  return (
    <DetailLayout
      breadcrumbs={[
        { label: "Workspace", href: "/staff/courses" },
        { label: "Courses", href: "/staff/courses" },
        { label: course.title },
      ]}
      title={course.title}
      identifier={course.slug}
      subtitle={course.summary}
      badges={
        <>
          <StatusPill label={course.status} tone={TONE[course.status] ?? "neutral"} />
          {course.certificateEnabled && (
            <StatusPill label="Certificate enabled" tone="accent" />
          )}
        </>
      }
      sections={[
        {
          id: "overview",
          label: "Overview",
          content: (
            <DetailFacts
              facts={[
                { label: "Slug", value: course.slug, mono: true },
                { label: "Status", value: course.status },
                { label: "Version", value: course.contentVersion, mono: true },
                {
                  label: "Duration",
                  value: course.durationHours ? `${course.durationHours} h` : "—",
                  mono: true,
                },
                {
                  label: "Certificate",
                  value: course.certificateEnabled ? "Enabled" : "Disabled",
                },
              ]}
            />
          ),
        },
        {
          id: "content",
          label: "Content",
          content: (
            <p className="text-sm text-zinc-600">
              Modules and lessons appear here once the content builder lands.
            </p>
          ),
        },
        {
          id: "cohorts",
          label: "Cohorts",
          content: (
            <p className="text-sm text-zinc-600">
              Cohorts delivering this course appear here.
            </p>
          ),
        },
      ]}
    />
  );
}
