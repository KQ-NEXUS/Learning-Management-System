import { notFound } from "next/navigation";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { cohortService } from "@/server/services/cohort-service";
import { courseService } from "@/server/services/course-service";
import { programmeService } from "@/server/services/programme-service";
import { CohortForm, type OfferOption, type Values } from "../../CohortForm";

/**
 * The cohort edit route.
 *
 * `CohortForm`'s `edit` mode (plan 05-12) has been ready since 05-12 but had
 * no route mounting it — the Cohort detail page's "Edit" link (plan 05-15,
 * `CohortDetailActions`) needs a real destination, so this route is added
 * here (Rule 2 — missing critical functionality; an Edit link with nowhere
 * to go would be a dead link, exactly what the staff shell's "nothing
 * promises a page that does not exist" ethic forbids).
 *
 * A denial reads identically to a missing cohort (RBAC-06) — the same
 * `notFound()` collapse the detail page and `courses/[id]/page.tsx` use.
 */

type StatusRow = { id: string; title: string; status: string };

function toDateTimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export const metadata = { title: "Edit cohort" };

export default async function EditCohortPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let cohort: Awaited<ReturnType<typeof cohortService.get>>;
  try {
    cohort = await cohortService.get(id);
    if (!cohort) notFound();
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
      notFound();
    }
    throw error;
  }

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

  const values: Values = {
    code: cohort.code,
    title: cohort.title,
    offerKind: cohort.courseId ? "COURSE" : "PROGRAMME",
    courseId: cohort.courseId ?? undefined,
    programmeId: cohort.programmeId ?? undefined,
    deliveryMode: cohort.deliveryMode,
    timezone: cohort.timezone,
    startsAt: toDateTimeLocal(cohort.startsAt),
    endsAt: toDateTimeLocal(cohort.endsAt),
    enrolmentOpensAt: toDateTimeLocal(cohort.enrolmentOpensAt),
    enrolmentClosesAt: toDateTimeLocal(cohort.enrolmentClosesAt),
    capacity: cohort.capacity,
    priceMinor: cohort.priceMinor,
    currency: cohort.currency,
    attendanceThresholdPct: cohort.attendanceThresholdPct,
    holdMinutes: cohort.holdMinutes,
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="font-mono text-[11px] text-zinc-500">Staff · Cohorts</p>
        <h1 className="text-lg font-semibold tracking-tight">Edit {cohort.title}</h1>
      </div>
      <CohortForm
        mode="edit"
        cohortId={id}
        expectedUpdatedAt={cohort.updatedAt.toISOString()}
        courses={courses}
        programmes={programmes}
        values={values}
      />
    </div>
  );
}
