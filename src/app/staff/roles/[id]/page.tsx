import { notFound } from "next/navigation";
import { roleService, MIN_REASON_LENGTH, type RoleRecord, type RoleVersionRecord } from "@/server/services/role-service";
import { AuthorizationError } from "@/server/permissions";
import { DetailLayout, DetailFacts, StatusPill } from "@/components/primitives";
import { RolePermissionsPanel, RoleActivationControl } from "../RoleDetailPanels";

export default async function RoleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let role: RoleRecord | null;
  let versions: RoleVersionRecord[];
  let assignmentCount: number;

  try {
    role = (await roleService.get(id)) as unknown as RoleRecord | null;
    if (!role) notFound();
    versions = await roleService.versions(id);
    assignmentCount = await roleService.assignmentCount(id);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      // Same response as "not found" — a denial must not confirm existence.
      notFound();
    }
    throw error;
  }

  return (
    <DetailLayout
      breadcrumbs={[
        { label: "Workspace", href: "/staff/roles" },
        { label: "Roles", href: "/staff/roles" },
        { label: role.name },
      ]}
      title={role.name}
      identifier={role.id}
      badges={
        <>
          <StatusPill label={role.active ? "Active" : "Inactive"} tone={role.active ? "success" : "warning"} />
          {role.isDefault && <StatusPill label="Default" tone="accent" />}
        </>
      }
      actions={
        <RoleActivationControl
          role={role}
          minReasonLength={MIN_REASON_LENGTH}
          assignmentCount={assignmentCount}
        />
      }
      sections={[
        {
          id: "overview",
          label: "Overview",
          content: (
            <DetailFacts
              facts={[
                { label: "Name", value: role.name },
                { label: "Description", value: role.description ?? "—" },
                { label: "Status", value: role.active ? "Active" : "Inactive" },
                { label: "Default role", value: role.isDefault ? "Yes" : "No" },
                { label: "Version", value: role.version, mono: true },
                { label: "Active assignments", value: assignmentCount, mono: true },
              ]}
            />
          ),
        },
        {
          id: "permissions",
          label: "Permissions",
          content: (
            <RolePermissionsPanel
              role={role}
              minReasonLength={MIN_REASON_LENGTH}
              assignmentCount={assignmentCount}
            />
          ),
        },
        {
          id: "history",
          label: "History",
          // Bare version count, never pluralized copy (edge RBAC-07-adjacent
          // zero-one-many rule reused here for the History tab).
          badge: versions.length,
          content: (
            <ul className="flex flex-col gap-3">
              {versions.map((version, index) => {
                // versions is ordered newest-first; the next array entry is
                // the prior (older) version.
                const prior = versions[index + 1];
                const added = prior
                  ? version.permissions.filter((p) => !prior.permissions.includes(p))
                  : version.permissions;
                const removed = prior
                  ? prior.permissions.filter((p) => !version.permissions.includes(p))
                  : [];

                return (
                  <li key={version.id} className="rounded-xl border border-border bg-surface px-3 py-2.5 shadow-xs">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        v{version.version}
                      </span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {version.createdAt.toLocaleString()}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        by {version.createdById ?? "system"}
                      </span>
                    </div>
                    {version.reason && (
                      <p className="mt-1 text-sm text-foreground">{version.reason}</p>
                    )}
                    {(added.length > 0 || removed.length > 0) && (
                      <p className="mt-1 font-mono text-xs text-foreground">
                        {added.length > 0 && <span>+ {added.join(", ")} </span>}
                        {removed.length > 0 && <span>− {removed.join(", ")}</span>}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          ),
        },
      ]}
    />
  );
}
