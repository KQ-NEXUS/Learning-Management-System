import { formatDateShort } from "@/lib/format-timestamp";
import { notFound } from "next/navigation";
import { staffAccountService, type StaffUserRow } from "@/server/services/staff-account-service";
import { assignmentService, type AssignmentWithRole } from "@/server/services/assignment-service";
import { roleService, MIN_REASON_LENGTH } from "@/server/services/role-service";
import { AuthorizationError, can } from "@/server/permissions";
import { DetailLayout, DetailFacts, StatusPill } from "@/components/primitives";
import { AssignmentsPanel, AccountStatusControl, type AssignmentRow } from "../AssignmentsPanel";

const TONE: Record<string, "success" | "warning" | "neutral"> = {
  ACTIVE: "success",
  DEACTIVATED: "warning",
  PENDING_VERIFICATION: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  DEACTIVATED: "Deactivated",
  PENDING_VERIFICATION: "Pending verification",
};

function fmtDate(value: Date | string | null): string {
  if (!value) return "—";
  return formatDateShort(new Date(value));
}

export default async function StaffUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let user: StaffUserRow | null;
  let assignments: AssignmentWithRole[];
  let roles: { id: string; name: string }[];

  try {
    user = await staffAccountService.get(id);
    if (!user) notFound();
    assignments = await assignmentService.listForUser(id);
    const roleRows = await roleService.list();
    roles = roleRows.filter((r) => r.active).map((r) => ({ id: r.id, name: r.name }));
  } catch (error) {
    if (error instanceof AuthorizationError) {
      // Same response as "not found" — a denial must not confirm existence.
      notFound();
    }
    throw error;
  }

  const activeCount = assignments.filter((a) => a.active).length;
  const assignmentRows: AssignmentRow[] = assignments.map((a) => ({
    id: a.id,
    role: a.role,
    scopeType: a.scopeType,
    scopeId: a.scopeId,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    active: a.active,
    revokedAt: a.revokedAt,
    reason: a.reason,
  }));

  // Mutation controls only for staff who can actually use them (the server actions re-check).
  const [canManageUsers, canManageRoles] = await Promise.all([can("users.manage", {}), can("roles.manage", {})]);

  return (
    <DetailLayout
      breadcrumbs={[
        { label: "Workspace", href: "/staff/users" },
        { label: "Staff accounts", href: "/staff/users" },
        { label: user.name },
      ]}
      title={user.name}
      identifier={user.email}
      badges={<StatusPill label={STATUS_LABEL[user.status] ?? user.status} tone={TONE[user.status] ?? "neutral"} />}
      actions={
        canManageUsers ? (
          <AccountStatusControl
            userId={user.id}
            userName={user.name}
            status={user.status}
            minReasonLength={MIN_REASON_LENGTH}
          />
        ) : undefined
      }
      sections={[
        {
          id: "overview",
          label: "Overview",
          content: (
            <DetailFacts
              facts={[
                { label: "Name", value: user.name },
                { label: "Email", value: user.email, mono: true },
                { label: "Status", value: <StatusPill label={STATUS_LABEL[user.status] ?? user.status} tone={TONE[user.status] ?? "neutral"} /> },
                { label: "Created", value: fmtDate(user.createdAt) },
                ...(user.deactivatedAt
                  ? [{ label: "Deactivated", value: fmtDate(user.deactivatedAt) }]
                  : []),
              ]}
            />
          ),
        },
        {
          id: "assignments",
          // Zero is a real, valid, reachable value here — unlike the role
          // page's version badge.
          label: "Assignments",
          badge: activeCount,
          content: (
            <AssignmentsPanel
              userId={user.id}
              userName={user.name}
              userEmail={user.email}
              assignments={assignmentRows}
              roles={roles}
              minReasonLength={MIN_REASON_LENGTH}
              canManage={canManageRoles}
            />
          ),
        },
      ]}
    />
  );
}
