/**
 * Failure diagnostics for the journey (Phase 15, plan 15-17; threat T-15-17-04:
 * a failed run must say why, not just that it failed).
 *
 * When a step stalls or fails, this lists the database sessions that are not
 * idle, with the lock they wait on. It selects only identifiers and wait
 * events: query text is cut to the first 80 characters and bind values are
 * never part of it, so nothing a learner typed can end up in the attachment.
 * The database guard has already passed by the time a test runs.
 */

export async function describeDatabaseActivity(): Promise<string> {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ log: ["error"] });
  try {
    const rows = await prisma.$queryRaw<
      {
        pid: number;
        state: string | null;
        wait_event_type: string | null;
        wait_event: string | null;
        age_seconds: number | null;
        blocked_by: number[] | null;
        query: string;
      }[]
    >`
      SELECT pid, state, wait_event_type, wait_event,
             EXTRACT(EPOCH FROM (now() - COALESCE(xact_start, query_start)))::float AS age_seconds,
             pg_blocking_pids(pid) AS blocked_by,
             left(regexp_replace(query, '\s+', ' ', 'g'), 80) AS query
      FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid() AND state IS DISTINCT FROM 'idle'
      ORDER BY age_seconds DESC NULLS LAST
    `;
    if (rows.length === 0) return "No database session is active.";
    return rows
      .map(
        (row) =>
          `pid=${row.pid} state=${row.state} wait=${row.wait_event_type ?? "-"}/${row.wait_event ?? "-"} ` +
          `age=${Math.round(row.age_seconds ?? 0)}s blockedBy=${JSON.stringify(row.blocked_by ?? [])} query=${row.query}`,
      )
      .join("\n");
  } catch (error) {
    return `Could not read database activity (${error instanceof Error ? error.name : "unknown error"}).`;
  } finally {
    await prisma.$disconnect();
  }
}
