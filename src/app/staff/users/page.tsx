import { staffAccountService } from "@/server/services/staff-account-service";
import { AuthorizationError, AuthenticationError, can } from "@/server/permissions";
import { UsersTable, type StaffUserRow } from "./UsersTable";
import { SessionEnded } from "@/components/shell/SessionEnded";

export const metadata = { title: "Staff accounts" };

export default async function UsersPage() {
  let users: StaffUserRow[];

  try {
    users = await staffAccountService.list();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return <SessionEnded />;
    }
    if (error instanceof AuthorizationError) {
      return <UsersTable denied={{ permission: "users.view" }} />;
    }
    throw error;
  }

  // Only offer "create" to staff who can actually use it; the destination page 404s otherwise.
  const canCreate = await can("users.manage", {});
  return <UsersTable rows={users} canCreate={canCreate} />;
}
