import { courseService } from "@/server/services/course-service";
import { AuthorizationError, AuthenticationError } from "@/server/permissions";
import { CoursesTable, type CourseRow } from "./CoursesTable";

export const metadata = { title: "Courses" };

export default async function CoursesPage() {
  let courses: CourseRow[];

  try {
    courses = (await courseService.list({})) as unknown as CourseRow[];
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return <p className="text-sm">Your session has ended. Sign in again.</p>;
    }
    if (error instanceof AuthorizationError) {
      // The primitive renders the denial. Copy is identical whether or not
      // any course exists, so the page leaks nothing (RBAC-06).
      return <CoursesTable denied={{ permission: "courses.view" }} />;
    }
    throw error;
  }

  return <CoursesTable rows={courses} />;
}
