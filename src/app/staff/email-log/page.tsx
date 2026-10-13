import { emailDeliveryLogService } from "@/server/services/email-delivery-log-service";
import { AuthenticationError, AuthorizationError, can } from "@/server/permissions";
import { EMAIL_STATUS, TEMPLATE_IDS } from "@/server/communications/contracts";
import { EmailLogTable, type EmailLogFilters } from "./EmailLogTable";

export const metadata = { title: "Email log" };

const STATUS_VALUES: string[] = Object.values(EMAIL_STATUS);
const TEMPLATE_VALUES: readonly string[] = TEMPLATE_IDS;

export default async function EmailLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawStatus = typeof params.status === "string" ? params.status : "";
  const rawTemplate = typeof params.template === "string" ? params.template : "";

  // An unrecognised value in the URL (a stale bookmark, a hand-edited query
  // string) is treated as "no filter" rather than passed through to the
  // service — never a 500, never a silently-broken filter.
  const status = STATUS_VALUES.includes(rawStatus) ? rawStatus : "";
  const template = TEMPLATE_VALUES.includes(rawTemplate) ? rawTemplate : "";

  const filters: EmailLogFilters = { status, template };

  let rows: Awaited<ReturnType<typeof emailDeliveryLogService.listDispatches>>;
  let canManageUsers = false;

  try {
    rows = await emailDeliveryLogService.listDispatches({
      status: status || null,
      template: template || null,
    });
    canManageUsers = await can("users.manage", {});
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return <p className="text-sm">Your session has ended. Sign in again.</p>;
    }
    if (error instanceof AuthorizationError) {
      // Same response whether or not any dispatch exists — no counts leak (RBAC-06).
      return <EmailLogTable denied={{ permission: "audit.view" }} filters={filters} />;
    }
    return (
      <EmailLogTable
        error={{
          message: "Couldn't load the delivery log. Reload the page; if it persists, contact an administrator.",
        }}
        filters={filters}
      />
    );
  }

  return <EmailLogTable rows={rows} filters={filters} canManageUsers={canManageUsers} />;
}
