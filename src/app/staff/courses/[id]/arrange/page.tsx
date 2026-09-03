import { notFound } from "next/navigation";
import { AuthorizationError } from "@/server/permissions";
import { courseService } from "@/server/services/course-service";
import {
  listWithdrawnModules,
} from "@/server/services/module-service";
import {
  listWithdrawnLessons,
  loadCourseTree,
} from "@/server/services/lesson-service";
import { serialiseOrderToken } from "@/server/services/reorder-service";
import { UnsavedOrderProvider, GuardedLink } from "@/components/catalogue";
import { ArrangeClient } from "./ArrangeClient";

export const metadata = { title: "Arrange course structure" };

type CourseMeta = { id: string; title?: string; slug?: string };

export default async function ArrangePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let course: CourseMeta | null;
  let tree: Awaited<ReturnType<typeof loadCourseTree>>;
  let withdrawnModuleRows: Awaited<ReturnType<typeof listWithdrawnModules>>;
  try {
    course = (await courseService.get(id)) as unknown as CourseMeta | null;
    tree = await loadCourseTree(id);
    withdrawnModuleRows = await listWithdrawnModules(id);
  } catch (error) {
    // A denial must not confirm existence — same response as "not found".
    if (error instanceof AuthorizationError) notFound();
    throw error;
  }

  if (!course || !tree) notFound();

  const moduleMeta = [
    ...tree.modules.map((m) => ({ id: m.id, title: m.title })),
    ...withdrawnModuleRows.map((m) => ({ id: m.id, title: m.title })),
  ];

  const withdrawnLessons: { id: string; title: string; moduleTitle: string }[] = [];
  for (const meta of moduleMeta) {
    const rows = await listWithdrawnLessons(meta.id);
    for (const lesson of rows) {
      withdrawnLessons.push({
        id: lesson.id,
        title: lesson.title,
        moduleTitle: meta.title,
      });
    }
  }

  const modules = tree.modules.map((m) => ({
    id: m.id,
    title: m.title,
    lessons: m.lessons.map((l) => ({
      id: l.id,
      title: l.title,
      type: l.type,
      required: l.required,
    })),
  }));

  const withdrawnModules = withdrawnModuleRows.map((m) => ({
    id: m.id,
    title: m.title,
  }));

  const token = serialiseOrderToken(tree.updatedAt);

  // Remount the island when the structure (not just the order) changes —
  // adding, renaming, withdrawing or restoring goes through router.refresh().
  const structureKey = JSON.stringify({ modules, withdrawnModules, withdrawnLessons });

  return (
    <UnsavedOrderProvider>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <p className="font-mono text-[11px] text-zinc-500">
            {course.slug ?? course.id}
          </p>
          <h1 className="text-lg font-semibold tracking-tight">
            {course.title ?? "Course"} — structure
          </h1>
          <GuardedLink
            href={`/staff/courses/${id}`}
            className="text-xs text-zinc-600 underline underline-offset-2 hover:text-zinc-900"
          >
            Back to course
          </GuardedLink>
        </div>

        <ArrangeClient
          key={structureKey}
          courseId={id}
          token={token}
          modules={modules}
          withdrawnModules={withdrawnModules}
          withdrawnLessons={withdrawnLessons}
        />
      </div>
    </UnsavedOrderProvider>
  );
}
