import { notFound } from "next/navigation";
import { staffAccountService, type StaffUserRow } from "@/server/services/staff-account-service";
import { assignmentService, type AssignmentWithRole } from "@/server/services/assignment-service";
import { roleService, MIN_REASON_LENGTH } from "@/server/services/role-service";
import { AuthorizationError } from "@/server/permissions";
import { DetailLayout, DetailFacts, StatusPill } from "@/components/primitives";
import { AssignmentsPanel, AccountStatusControl, type AssignmentRow } from "../AssignmentsPanel";

const TONE: Record<string, "success" | "warning" | "neutral"> = {
  ACTIVE: "success",
  DEACTIVATED: "warning",
  PENDING_VERIFICATION: "neutral",
};

function fmtDate(value: Date | string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
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

  return (
    <DetailLayout
      breadcrumbs={[
        { label: "Workspace", href: "/staff/users" },
        { label: "Staff accounts", href: "/staff/users" },
        { label: user.name },
      ]}
      title={user.name}
      identifier={user.email}
      badges={<StatusPill label={user.status} tone={TONE[user.status] ?? "neutral"} />}
      actions={
        <AccountStatusControl
          userId={user.id}
          userName={user.name}
          status={user.status}
          minReasonLength={MIN_REASON_LENGTH}
        />
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
                { label: "Status", value: user.status },
                { label: "Created", value: fmtDate(user.createdAt), mono: true },
                ...(user.deactivatedAt
                  ? [{ label: "Deactivated", value: fmtDate(user.deactivatedAt), mono: true }]
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
            />
          ),
        },
      ]}
    />
  );
}
