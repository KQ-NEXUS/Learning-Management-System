import { AuthorizationError, AuthenticationError } from "@/server/permissions";
import { listProgrammesForIndex, type ProgrammeIndexRow } from "@/server/services/programme-service";
import { ProgrammesTable } from "./ProgrammesTable";

export const metadata = { title: "Programmes" };

export default async function ProgrammesPage() {
  let programmes: ProgrammeIndexRow[];

  try {
    programmes = await listProgrammesForIndex();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return <p className="text-sm">Your session has ended. Sign in again.</p>;
    }
    if (error instanceof AuthorizationError) {
      // The primitive renders the denial. Copy is identical whether or not any
      // programme exists, so the page leaks nothing (RBAC-06 / T-04-58).
      return <ProgrammesTable denied={{ permission: "programmes.view" }} />;
    }
    throw error;
  }

  return <ProgrammesTable rows={programmes} />;
}
