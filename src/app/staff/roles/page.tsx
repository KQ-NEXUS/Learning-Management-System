import { roleService } from "@/server/services/role-service";
import { AuthorizationError, AuthenticationError } from "@/server/permissions";
import { RolesTable, type RoleRow } from "./RolesTable";

export const metadata = { title: "Roles" };

export default async function RolesPage() {
  let roles: RoleRow[];

  try {
    roles = (await roleService.list()) as unknown as RoleRow[];
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return <p className="text-sm">Your session has ended. Sign in again.</p>;
    }
    if (error instanceof AuthorizationError) {
      return <RolesTable denied={{ permission: "roles.view" }} />;
    }
    throw error;
  }

  return <RolesTable rows={roles} />;
}
