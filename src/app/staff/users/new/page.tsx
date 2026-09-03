import { roleService } from "@/server/services/role-service";
import { AuthorizationError, AuthenticationError } from "@/server/permissions";
import { ResourceForm } from "@/components/primitives";
import { StaffAccountForm, type RoleOption } from "../StaffAccountForm";

export const metadata = { title: "New staff account" };

export default async function NewStaffAccountPage() {
  let roles: RoleOption[];

  try {
    const rows = await roleService.list();
    roles = rows.filter((r) => r.active).map((r) => ({ id: r.id, name: r.name }));
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return <p className="text-sm">Your session has ended. Sign in again.</p>;
    }
    if (error instanceof AuthorizationError) {
      return (
        <ResourceForm
          title="New staff account"
          state={{ status: "denied", permission: "users.manage" }}
          onSubmit={() => {}}
        >
          {null}
        </ResourceForm>
      );
    }
    throw error;
  }

  return <StaffAccountForm roles={roles} />;
}
