import { cohortService } from "@/server/services/cohort-service";
import { courseService } from "@/server/services/course-service";
import { programmeService } from "@/server/services/programme-service";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { CohortsTable, type CohortRow } from "./CohortsTable";

export const metadata = { title: "Cohorts" };

type CohortListRow = {
  id: string;
  code: string;
  title: string;
  courseId: string | null;
  programmeId: string | null;
  deliveryMode: string;
  timezone: string;
  enrolmentOpensAt: Date;
  enrolmentClosesAt: Date;
  capacity: number;
  seatsTaken: number;
  status: string;
};

type TitleRow = { id: string; title: string };

export default async function CohortsPage() {
  let rows: CohortRow[];

  try {
    const cohorts = (await cohortService.list({})) as unknown as CohortListRow[];

    // Course/Programme titles are supplementary display data, not the gate
    // for this page — cohorts.view already decided that above. A caller
    // without courses.view / programmes.view still sees their cohorts, just
    // with "—" in the Offer column instead of a title.
    const [courses, programmes] = await Promise.all([
      courseService.list({}).catch(() => [] as unknown[]) as Promise<TitleRow[]>,
      programmeService.list({}).catch(() => [] as unknown[]) as Promise<TitleRow[]>,
    ]);
    const courseTitles = new Map(courses.map((c) => [c.id, c.title]));
    const programmeTitles = new Map(programmes.map((p) => [p.id, p.title]));

    rows = cohorts.map((c) => {
      const isCourse = c.courseId != null;
      const offerTitle = isCourse
        ? (courseTitles.get(c.courseId!) ?? "—")
        : (programmeTitles.get(c.programmeId!) ?? "—");
      return {
        id: c.id,
        code: c.code,
        title: c.title,
        courseId: c.courseId,
        programmeId: c.programmeId,
        offerKind: isCourse ? "Course" : "Programme",
        offerTitle,
        deliveryMode: c.deliveryMode,
        timezone: c.timezone,
        enrolmentOpensAt: c.enrolmentOpensAt.toISOString(),
        enrolmentClosesAt: c.enrolmentClosesAt.toISOString(),
        capacity: c.capacity,
        seatsTaken: c.seatsTaken,
        status: c.status,
      };
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return <p className="text-sm text-foreground">Your session has ended. Sign in again.</p>;
    }
    if (error instanceof AuthorizationError) {
      // The primitive renders the denial. Copy is identical whether or not
      // any cohort exists, so the page leaks nothing (RBAC-06).
      return <CohortsTable denied={{ permission: "cohorts.view" }} />;
    }
    throw error;
  }

  return <CohortsTable rows={rows} />;
}
