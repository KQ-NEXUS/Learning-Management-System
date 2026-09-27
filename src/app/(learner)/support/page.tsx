import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { LearnerPageHeader } from "@/components/shell/LearnerPageHeader";
import { BTN, BTN_PRIMARY, NOTE_DANGER } from "@/components/primitives/controls";
import { TicketStatusPill, TicketTime, ticketCategoryLabel } from "@/components/support/ticket-labels";
import { getCurrentActor } from "@/server/auth/current-actor";
import { listOwnTickets } from "@/server/services/ticket-service";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

/** `/support` — the actor's own tickets only, newest-updated first, 20 per page. */
export default async function SupportIndexPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await getCurrentActor();
  if (!actor) redirect("/signin");

  const params = await searchParams;
  const rawPage = Array.isArray(params.page) ? params.page[0] : params.page;
  const page = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);

  let tickets: Awaited<ReturnType<typeof listOwnTickets>> | null = null;
  try {
    tickets = await listOwnTickets();
  } catch {
    tickets = null;
  }

  const total = tickets?.length ?? 0;
  const visible = tickets?.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) ?? [];
  const hasNext = page * PAGE_SIZE < total;

  return (
    <div className="flex flex-col gap-6">
      <LearnerPageHeader
        title="Support"
        subtitle="View your requests or ask for help."
        actions={
          <Link href="/support/new" className={`${BTN_PRIMARY} gap-2`}>
            <Plus aria-hidden className="size-4" />
            Create a ticket
          </Link>
        }
      />

      {tickets === null ? (
        <p role="alert" className={NOTE_DANGER}>
          We couldn’t load your tickets. Try again.
        </p>
      ) : total === 0 ? (
        <div className="flex flex-col items-start gap-3 border-t border-foreground py-8">
          <h2 className="text-base font-semibold text-foreground">No support tickets yet</h2>
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            If you need help with your account, payment, course, assessment, certificate, or a technical
            problem, create a ticket.
          </p>
          <Link href="/support/new" className={BTN_PRIMARY}>
            Create a ticket
          </Link>
        </div>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-border border-y border-border">
            {visible.map((ticket) => (
              <li key={ticket.id} className="flex flex-col gap-2 py-4 sm:grid sm:grid-cols-[1fr_auto] sm:items-center sm:gap-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <h2 className="line-clamp-2 text-base font-semibold break-words text-foreground">{ticket.subject}</h2>
                  <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="font-mono break-all">{ticket.reference}</span>
                    <span>{ticketCategoryLabel(ticket.category)}</span>
                    <span>
                      Updated <TicketTime value={ticket.updatedAt} />
                    </span>
                  </p>
                </div>
                <div className="flex items-center justify-between gap-4 sm:justify-end">
                  <TicketStatusPill status={ticket.status} />
                  <Link
                    href={`/support/${encodeURIComponent(ticket.reference)}`}
                    className={BTN}
                    aria-label={`View ticket ${ticket.reference}`}
                  >
                    View ticket
                  </Link>
                </div>
              </li>
            ))}
          </ul>
          {(page > 1 || hasNext) && (
            <nav aria-label="Pagination" className="flex gap-2">
              {page > 1 && (
                <Link href={`/support?page=${page - 1}`} className={BTN}>
                  Previous
                </Link>
              )}
              {hasNext && (
                <Link href={`/support?page=${page + 1}`} className={BTN}>
                  Next
                </Link>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
