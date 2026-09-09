import { auditReadService } from "@/server/services/audit-read-service";
import { AuthorizationError, AuthenticationError } from "@/server/permissions";
import { AuditTable, type AuditTableFilters } from "./AuditTable";

export const metadata = { title: "Audit" };

function parseDate(value: string): { date: Date | null; invalid: boolean } {
  if (!value) return { date: null, invalid: false };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: null, invalid: true };
  return { date, invalid: false };
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const actorId = typeof params.actorId === "string" ? params.actorId : "";
  const action = typeof params.action === "string" ? params.action : "";
  const fromRaw = typeof params.from === "string" ? params.from : "";
  const toRaw = typeof params.to === "string" ? params.to : "";

  // An unparseable date becomes a validation message rather than a silently
  // unfiltered full-table read — previous rows are never wiped by bad input.
  const { date: from, invalid: fromInvalid } = parseDate(fromRaw);
  const { date: to, invalid: toInvalid } = parseDate(toRaw);
  const validationError =
    fromInvalid || toInvalid
      ? {
          message:
            "One of the date filters could not be understood — showing results without it.",
        }
      : null;

  const filters: AuditTableFilters = { actorId, action, from: fromRaw, to: toRaw };

  let rows: Awaited<ReturnType<typeof auditReadService.list>>;
  let filterOptions: Awaited<ReturnType<typeof auditReadService.filterOptions>>;

  try {
    [rows, filterOptions] = await Promise.all([
      auditReadService.list({
        actorId: actorId || null,
        action: action || null,
        from: fromInvalid ? null : from,
        to: toInvalid ? null : to,
      }),
      auditReadService.filterOptions(),
    ]);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return <p className="text-sm">Your session has ended. Sign in again.</p>;
    }
    if (error instanceof AuthorizationError) {
      // Same response whether or not any event exists — no counts leak.
      return <AuditTable denied={{ permission: "audit.view" }} />;
    }
    throw error;
  }

  return (
    <AuditTable
      rows={rows}
      filterOptions={filterOptions}
      filters={filters}
      validationError={validationError}
    />
  );
}
