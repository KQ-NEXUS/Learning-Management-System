import { staffAccountService } from "@/server/services/staff-account-service";
import { AuthorizationError, AuthenticationError } from "@/server/permissions";
import { UsersTable, type StaffUserRow } from "./UsersTable";

export const metadata = { title: "Staff accounts" };

export default async function UsersPage() {
  let users: StaffUserRow[];

  try {
    users = (await staffAccountService.list()) as unknown as StaffUserRow[];
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return <p className="text-sm">Your session has ended. Sign in again.</p>;
    }
    if (error instanceof AuthorizationError) {
      return <UsersTable denied={{ permission: "users.view" }} />;
    }
    throw error;
  }

  return <UsersTable rows={users} />;
}
