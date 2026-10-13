import { roleService } from "@/server/services/role-service";
import { AuthorizationError, AuthenticationError, can } from "@/server/permissions";
import { RolesTable, type RoleRow } from "./RolesTable";
import { SessionEnded } from "@/components/shell/SessionEnded";

export const metadata = { title: "Roles" };

export default async function RolesPage() {
  let roles: RoleRow[];

  try {
    roles = (await roleService.list()) as unknown as RoleRow[];
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return <SessionEnded />;
    }
    if (error instanceof AuthorizationError) {
      return <RolesTable denied={{ permission: "roles.view" }} />;
    }
    throw error;
  }

  // Only offer "create" to staff who can actually use it; the destination page 404s otherwise.
  const canCreate = await can("roles.manage", {});
  return <RolesTable rows={roles} canCreate={canCreate} />;
}
