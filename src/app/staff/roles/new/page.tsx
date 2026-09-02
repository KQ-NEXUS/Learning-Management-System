import { roleService } from "@/server/services/role-service";
import { AuthorizationError, AuthenticationError } from "@/server/permissions";
import { ResourceForm } from "@/components/primitives";
import { RoleForm, type CloneSource } from "../RoleForm";

export const metadata = { title: "New role" };

const DEFAULT_ROLE_ORDER = [
  "Administrator",
  "Programme Manager",
  "Instructor",
  "Finance/Operations",
  "Learner",
];

export default async function NewRolePage() {
  let cloneSources: CloneSource[];

  try {
    const roles = await roleService.list();
    cloneSources = roles
      .filter((r) => r.isDefault)
      .sort((a, b) => DEFAULT_ROLE_ORDER.indexOf(a.name) - DEFAULT_ROLE_ORDER.indexOf(b.name))
      .map((r) => ({ id: r.id, name: r.name, permissions: r.permissions }));
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return <p className="text-sm">Your session has ended. Sign in again.</p>;
    }
    if (error instanceof AuthorizationError) {
      return (
        <ResourceForm
          title="New role"
          state={{ status: "denied", permission: "roles.manage" }}
          onSubmit={() => {}}
        >
          {null}
        </ResourceForm>
      );
    }
    throw error;
  }

  return <RoleForm cloneSources={cloneSources} />;
}
