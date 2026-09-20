import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { PageHeader } from "@/components/shell/PageHeader";
import { loadSessionRegister } from "@/server/services/attendance-service";
import { listSessionsForCohort } from "@/server/services/scheduled-session-service";
import { UnsavedOrderProvider, GuardedLink } from "@/components/catalogue";
import { AttendanceMarkClient, type RegisterRow } from "./AttendanceMarkClient";

export const metadata = { title: "Mark attendance" };

export default async function AttendanceMarkPage({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>;
}) {
  const { id: cohortId, sessionId } = await params;

  let register: Awaited<ReturnType<typeof loadSessionRegister>>;
  let sessions: Awaited<ReturnType<typeof listSessionsForCohort>>;
  try {
    [register, sessions] = await Promise.all([
      loadSessionRegister({ sessionId }),
      listSessionsForCohort(cohortId),
    ]);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return <p className="text-sm text-foreground">Your session has ended. Sign in again.</p>;
    }
    if (error instanceof AuthorizationError) {
      // Identical copy regardless of whether the session exists (RBAC-06).
      return (
        <div className="flex flex-col items-start gap-2 border-t border-foreground py-12">
          <span className="font-mono text-xs tracking-wide text-muted-foreground">403</span>
          <p className="text-sm font-semibold text-foreground">
            You do not have access to this session&apos;s attendance
          </p>
          <p className="max-w-prose text-sm text-muted-foreground">
            Your role does not include{" "}
            <code className="rounded-sm bg-surface-2 px-1 font-mono text-xs">attendance.view</code> at this
            scope. Ask a workspace administrator to grant it.
          </p>
        </div>
      );
    }
    throw error;
  }

  const session = sessions.find((s) => s.id === sessionId) ?? null;
  const canSetLiveStates = register[0]?.canSetLiveStates ?? true;
  const windowClosesAt = register[0]?.windowClosesAt ?? new Date();

  const roster: RegisterRow[] = register.map((row) => ({
    enrolmentId: row.enrolmentId,
    learnerName: row.learnerName,
    learnerEmail: row.learnerEmail,
    state: row.state,
    note: row.note,
    isCorrection: row.isCorrection,
  }));

  return (
    <UnsavedOrderProvider>
      <div className="flex flex-col gap-4">
        <PageHeader
          title={session?.title ?? "Session"}
          breadcrumbs={[
            { label: "Cohorts", href: "/staff/cohorts" },
            { label: "Cohort", href: `/staff/cohorts/${cohortId}` },
            { label: "Attendance" },
          ]}
          subtitle={
            session?.startsAtLabel && session?.endsAtLabel
              ? `${session.startsAtLabel} → ${session.endsAtLabel}`
              : undefined
          }
          actions={
            <GuardedLink
              href={`/staff/cohorts/${cohortId}`}
              className="inline-flex min-h-10 items-center rounded-md border border-sidebar-line px-4 text-sm font-semibold text-white hover:bg-sidebar-hover"
            >
              Back to cohort
            </GuardedLink>
          }
        />

        <AttendanceMarkClient
          cohortId={cohortId}
          sessionId={sessionId}
          sessionTitle={session?.title ?? "Session"}
          windowClosesAt={windowClosesAt.toISOString()}
          canSetLiveStates={canSetLiveStates}
          roster={roster}
        />
      </div>
    </UnsavedOrderProvider>
  );
}
