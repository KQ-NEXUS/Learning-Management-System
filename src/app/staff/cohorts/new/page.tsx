import { notFound } from "next/navigation";
import { AuthenticationError, AuthorizationError, can } from "@/server/permissions";
import { courseService } from "@/server/services/course-service";
import { programmeService } from "@/server/services/programme-service";
import { CohortForm, type OfferOption } from "../CohortForm";

export const metadata = { title: "New cohort" };

type StatusRow = { id: string; title: string; status: string };

export default async function NewCohortPage() {
  // The action re-checks; this is the courtesy gate so the form is not
  // offered to someone who cannot submit it (T-05-76).
  let allowed: boolean;
  try {
    allowed = await can("cohorts.manage", {});
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof AuthenticationError) notFound();
    throw error;
  }
  if (!allowed) notFound();

  // COH-01 — a cohort binds to a PUBLISHED Course/Programme snapshot only.
  // Best-effort: a caller without courses.view/programmes.view still reaches
  // this form with an empty picker rather than a 500.
  const [courseRows, programmeRows] = await Promise.all([
    courseService.list({}).catch(() => [] as unknown[]) as Promise<StatusRow[]>,
    programmeService.list({}).catch(() => [] as unknown[]) as Promise<StatusRow[]>,
  ]);
  const courses: OfferOption[] = courseRows
    .filter((c) => c.status === "PUBLISHED")
    .map((c) => ({ id: c.id, title: c.title }));
  const programmes: OfferOption[] = programmeRows
    .filter((p) => p.status === "PUBLISHED")
    .map((p) => ({ id: p.id, title: p.title }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="font-mono text-[11px] text-muted-foreground">Staff · Cohorts</p>
        <h1 className="text-[25px] leading-[1.2] font-semibold tracking-tight">New cohort</h1>
      </div>
      <CohortForm mode="create" courses={courses} programmes={programmes} />
    </div>
  );
}
