"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "@/components/shell/PageHeader";
import { BTN, CONTROL, FIELD, NOTE_DANGER, SECTION_TITLE, TD, TH } from "@/components/primitives/controls";
import { QueueTabs } from "@/components/support/QueueTabs";
import { TicketPriorityPill, TicketStatusPill } from "@/components/support/TicketStatusPill";
import { TicketTime, TICKET_CATEGORY_OPTIONS, ticketCategoryLabel } from "@/components/support/ticket-labels";
import type {
  QueueRow,
  QueueView,
  TicketAssigneeOption,
} from "@/server/services/ticket-staff-queue-service";
import { QUEUE_OPTIONS, QUEUE_TABS, QUEUE_TAB_LABEL, type QueueTab } from "@/lib/support-queue";

const EMPTY_COPY: Record<QueueTab, string> = {
  "my-work": "No tickets assigned to you.",
  unassigned: "No tickets are waiting for assignment.",
  open: "No open tickets.",
  escalated: "No escalated tickets.",
  resolved: "No tickets were resolved recently.",
};

const PRIORITY_OPTIONS = [
  ["URGENT", "Urgent"],
  ["HIGH", "High"],
  ["NORMAL", "Normal"],
  ["LOW", "Low"],
] as const;

const QUEUE_LABEL: Record<string, string> = Object.fromEntries(QUEUE_OPTIONS.map((option) => [option.value, option.label]));
const BREADCRUMBS = [{ label: "Operations" }, { label: "Support" }];

type Props = {
  view?: QueueView;
  assignees?: readonly TicketAssigneeOption[];
  denied?: boolean;
  error?: boolean;
};

function ownerText(row: QueueRow): string {
  return row.assigneeName ?? "Unassigned";
}

export function SupportWorkspace({ view, assignees = [], denied = false, error = false }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(view?.params.q ?? "");

  if (denied) {
    return (
      <div className="flex min-w-0 flex-col gap-8">
        <PageHeader breadcrumbs={BREADCRUMBS} title="Support" />
        <section className="border-t border-foreground pt-5">
          <h2 className={SECTION_TITLE}>You do not have access to Support</h2>
          <p className="mt-2 text-sm text-muted-foreground">Your role does not include the tickets.view permission.</p>
        </section>
      </div>
    );
  }

  if (error || !view) {
    return (
      <div className="flex min-w-0 flex-col gap-8">
        <PageHeader breadcrumbs={BREADCRUMBS} title="Support" subtitle="Triage, assign, and resolve learner requests." />
        <div role="alert" className={NOTE_DANGER}>
          We couldn’t load the support queue. Try again.
          <button type="button" onClick={() => router.refresh()} className={`${BTN} ml-4`}>Retry</button>
        </div>
      </div>
    );
  }

  const { params } = view;

  function href(patch: Record<string, string>, resetPage = true): string {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (resetPage) next.delete("page");
    return next.size ? `${pathname}?${next}` : pathname;
  }

  const filtersActive = Boolean(params.q || params.category || params.priority || params.queue || params.owner);
  const tabs = QUEUE_TABS.map((tab) => ({
    value: tab,
    label: QUEUE_TAB_LABEL[tab],
    count: view.tabCounts[tab],
    href: href({ tab: tab === "my-work" ? "" : tab }),
  }));
  const health = [
    { label: "Open", value: view.health.open, href: `${pathname}?tab=open` },
    { label: "Unassigned", value: view.health.unassigned, href: `${pathname}?tab=unassigned` },
    { label: "Urgent", value: view.health.urgent, href: `${pathname}?tab=open&priority=URGENT` },
    { label: "Escalated", value: view.health.escalated, href: `${pathname}?tab=escalated` },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <PageHeader
        breadcrumbs={BREADCRUMBS}
        title="Support"
        subtitle="Triage, assign, and resolve learner requests."
        band={
          <p className="mt-4 font-mono text-[13px] text-sidebar-soft">
            Data as of <time dateTime={new Date(view.asOf).toISOString()}>{new Date(view.asOf).toLocaleString("en-GB", { timeZone: "UTC" })} UTC</time>
          </p>
        }
      />

      <ul aria-label="Queue health" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {health.map((item) => (
          <li key={item.label}>
            <Link href={item.href} className="flex min-h-11 flex-col gap-1 rounded-md border border-border bg-surface p-4 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-focus">
              <span className="text-[13px] text-muted-foreground">{item.label}</span>
              <span className="font-mono text-2xl font-semibold tabular-nums">{item.value}</span>
            </Link>
          </li>
        ))}
      </ul>

      <QueueTabs tabs={tabs} active={params.tab} idPrefix="support-queue" />

      <form
        role="search"
        aria-label="Filter tickets"
        className="flex flex-wrap items-end gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          router.push(href({ q: search.trim() }));
        }}
      >
        <label className={`${FIELD} min-w-56 grow`}>Search
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Reference, subject or learner" className={CONTROL} />
        </label>
        <label className={FIELD}>Category
          <select value={params.category} onChange={(event) => router.push(href({ category: event.target.value }))} className={CONTROL}>
            <option value="">All categories</option>
            {TICKET_CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className={FIELD}>Priority
          <select value={params.priority} onChange={(event) => router.push(href({ priority: event.target.value }))} className={CONTROL}>
            <option value="">All priorities</option>
            {PRIORITY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className={FIELD}>Queue
          <select value={params.queue} onChange={(event) => router.push(href({ queue: event.target.value }))} className={CONTROL}>
            <option value="">All queues</option>
            {QUEUE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className={FIELD}>Owner
          <select value={params.owner} onChange={(event) => router.push(href({ owner: event.target.value }))} className={CONTROL}>
            <option value="">Anyone</option>
            <option value="me">Me</option>
            <option value="unassigned">Unassigned</option>
            {assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.name}</option>)}
          </select>
        </label>
        <button type="submit" className={BTN}>Search</button>
      </form>

      <section
        id="support-queue-panel"
        role="tabpanel"
        aria-labelledby={`support-queue-tab-${params.tab}`}
        className="min-w-0"
      >
        <h2 className={`${SECTION_TITLE} pb-4`}>{QUEUE_TAB_LABEL[params.tab]}</h2>
        <div className="border-t border-foreground">
          {view.rows.length === 0 ? (
            <div className="py-6">
              {filtersActive ? (
                <>
                  <p className="text-base font-semibold">No tickets match these filters.</p>
                  <Link href={href({ q: "", category: "", priority: "", queue: "", owner: "" })} className={`${BTN} mt-4 inline-block`}>Clear filters</Link>
                </>
              ) : (
                <p className="text-base font-semibold">{view.hasAnyTickets ? EMPTY_COPY[params.tab] : "No support tickets exist yet."}</p>
              )}
            </div>
          ) : (
            <>
              <table className="hidden w-full table-fixed lg:table">
                <caption className="sr-only">{QUEUE_TAB_LABEL[params.tab]} tickets</caption>
                <thead>
                  <tr>
                    <th scope="col" className={TH}>Reference</th>
                    <th scope="col" className={TH}>Subject and learner</th>
                    <th scope="col" className={TH}>Category</th>
                    <th scope="col" className={TH}>Priority</th>
                    <th scope="col" className={TH}>Status</th>
                    <th scope="col" className={TH}>Queue and owner</th>
                    <th scope="col" className={TH}>Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {view.rows.map((row) => (
                    <tr key={row.id} className="border-t border-border">
                      <td className={`${TD} font-mono text-sm break-words`}>
                        <Link href={`/staff/support/${row.reference}`} className="font-semibold text-accent hover:underline">{row.reference}</Link>
                      </td>
                      <td className={`${TD} min-w-0`}>
                        <p className="text-sm font-semibold break-words [overflow-wrap:anywhere]">{row.subject}</p>
                        <p className="text-[13px] break-words text-muted-foreground [overflow-wrap:anywhere]">{row.learnerName} · {row.learnerEmail}</p>
                      </td>
                      <td className={`${TD} text-sm`}>{ticketCategoryLabel(row.category)}</td>
                      <td className={TD}><TicketPriorityPill priority={row.priority} /></td>
                      <td className={TD}><TicketStatusPill status={row.status} /></td>
                      <td className={`${TD} text-sm`}>
                        <p>{QUEUE_LABEL[row.queue] ?? row.queue}</p>
                        <p className="text-[13px] text-muted-foreground">{ownerText(row)}</p>
                      </td>
                      <td className={TD}><TicketTime value={row.updatedAt} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul aria-label="Tickets" className="flex flex-col lg:hidden">
                {view.rows.map((row) => (
                  <li key={row.id} className="flex min-w-0 flex-col gap-2 border-b border-border py-4">
                    <Link href={`/staff/support/${row.reference}`} className="font-mono text-sm font-semibold text-accent hover:underline">{row.reference}</Link>
                    <p className="text-sm font-semibold break-words [overflow-wrap:anywhere]">{row.subject}</p>
                    <p className="text-[13px] break-words text-muted-foreground [overflow-wrap:anywhere]">Learner: {row.learnerName}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <TicketPriorityPill priority={row.priority} />
                      <TicketStatusPill status={row.status} />
                    </div>
                    <p className="text-[13px] text-muted-foreground">{QUEUE_LABEL[row.queue] ?? row.queue} · Owner: {ownerText(row)}</p>
                    <TicketTime value={row.updatedAt} />
                  </li>
                ))}
              </ul>
              <nav aria-label="Pagination" className="flex items-center justify-between gap-4 pt-4 text-sm">
                <span className="text-muted-foreground">{view.total} tickets · Page {params.page} of {view.pageCount}</span>
                <span className="flex gap-3">
                  {params.page > 1 && <Link href={href({ page: String(params.page - 1) }, false)} className={BTN}>Previous</Link>}
                  {params.page < view.pageCount && <Link href={href({ page: String(params.page + 1) }, false)} className={BTN}>Next</Link>}
                </span>
              </nav>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
