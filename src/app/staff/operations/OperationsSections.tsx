import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { StatusPill } from "@/components/primitives/ResourceTable";
import { NOTE_DANGER, TD, TH } from "@/components/primitives/controls";
import { LagosTime } from "@/components/time/LagosTime";
import type {
  OpsEmailFailureRow,
  OpsFailedWorkRow,
  OpsIntegrityRow,
  OpsJobRow,
  OpsJobStatus,
  OpsPaymentExceptionRow,
  OpsStatus,
  OpsSummary,
} from "@/server/services/ops-status-types";

/**
 * The five sections of the Operations status page (plan 15-13, UI-SPEC S1).
 *
 * Server components with no client state: every section is rendered from the
 * plain projection the service returns, which carries references, labels,
 * counts and times only. There is no recipient address, email body, provider
 * error text, webhook payload, learner name or amount to show (P5), so none can
 * leak from here.
 *
 * Layout (UI-SPEC S1): one column, sections stacked by severity. From 768px a
 * section's rows are a `table-fixed` table whose cells wrap long labels; below
 * 768px each row is a stacked card, so nothing scrolls sideways at any width.
 * Each list shows at most ten rows, then "Showing 10 of {n}." and a link to the
 * workspace that owns the full list.
 */

const SECTION_ERROR_COPY = "Couldn't load this section. Reload the page; if it persists, check the host logs.";
export const ALL_CLEAR_LINE = "Nothing needs attention. Check again after the next scheduled run, or reload this page.";
export const JOBS_FOOTNOTE =
  "Status is worked out from stored records, not from the scheduler. Behind means work has waited longer than expected for that job.";

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

// ---------------------------------------------------------------------------
// Header band and overall status
// ---------------------------------------------------------------------------

export function OverallStatusPill({ needsAttention }: { needsAttention: boolean }) {
  return needsAttention ? (
    <StatusPill label="Needs attention" tone="danger" />
  ) : (
    <StatusPill label="All clear" tone="success" />
  );
}

function Figure({
  label,
  value,
  spoken,
  caption,
  first,
}: {
  label: string;
  value: number | null;
  /** The count in words ("1 failed job"), read out for screen readers. */
  spoken: string;
  caption: string;
  first?: boolean;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${first ? "" : "lg:border-l lg:border-sidebar-line lg:pl-6"}`}>
      <span className="text-sm text-sidebar-soft">{label}</span>
      <span className="font-mono text-[36px] leading-[1.15] font-medium tracking-[-0.03em] text-white tabular-nums">
        <span aria-hidden>{value === null ? "—" : value}</span>
        <span className="sr-only">{value === null ? `${label}: unavailable` : spoken}</span>
      </span>
      <span className="text-sm text-sidebar-soft">{caption}</span>
    </div>
  );
}

/** The three band figures and the "Checked" line, drawn on the navy header band. */
export function OperationsBand({
  summary,
  checkedAt,
  maxSendAttempts,
}: {
  summary: OpsSummary;
  checkedAt: Date;
  maxSendAttempts: number;
}) {
  return (
    <div className="mt-6 flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-3">
        <Figure
          first
          label="Failed jobs"
          value={summary.failedJobs}
          spoken={plural(summary.failedJobs ?? 0, "failed job")}
          caption="Exports and events that stopped"
        />
        <Figure
          label="Payment exceptions"
          value={summary.paymentExceptions}
          spoken={plural(summary.paymentExceptions ?? 0, "payment exception")}
          caption="Orders, webhooks and refunds"
        />
        <Figure
          label="Email failures"
          value={summary.emailFailures}
          spoken={plural(summary.emailFailures ?? 0, "email failure")}
          caption={`Not delivered after ${maxSendAttempts} attempts`}
        />
      </div>
      <p className="text-sm text-sidebar-soft">
        Checked <LagosTime value={checkedAt} />
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared section frame and responsive rows
// ---------------------------------------------------------------------------

function ActionLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-accent hover:underline md:min-h-0">
      {label}
      <ArrowRight aria-hidden className="size-3.5" />
    </Link>
  );
}

function SectionFrame({
  id,
  title,
  count,
  hasFailure,
  children,
}: {
  id: string;
  title: string;
  /** Right-aligned count text ("3 open"); omitted when there is nothing to count. */
  count?: string;
  hasFailure: boolean;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id}>
      <div className="flex items-baseline justify-between gap-4 pb-4">
        <h2 id={id} className="flex items-center gap-3 text-[20px] font-semibold tracking-[-0.015em] text-foreground">
          {title}
          {hasFailure && <span aria-hidden className="alert-dot" />}
        </h2>
        {count && <span className="text-sm text-muted-foreground">{count}</span>}
      </div>
      <div className={hasFailure ? "border-t-2 border-danger" : "border-t border-foreground"}>{children}</div>
    </section>
  );
}

function SectionError({ id, title }: { id: string; title: string }) {
  return (
    <SectionFrame id={id} title={title} hasFailure={false}>
      <p className={`${NOTE_DANGER} mt-4`}>{SECTION_ERROR_COPY}</p>
    </SectionFrame>
  );
}

function EmptyCopy({ children }: { children: ReactNode }) {
  return <p className="py-8 text-base text-muted-foreground">{children}</p>;
}

type Item = {
  key: string;
  /** One node per table column. */
  cells: ReactNode[];
  /** The stacked-card layout used below 768px. */
  title: ReactNode;
  lines: ReactNode[];
  status?: ReactNode;
  link?: ReactNode;
};

type Header = { label: string; width: string; hidden?: boolean };

/** Stacked cards below 768px, a fixed-layout table from 768px. */
function Rows({ label, headers, items }: { label: string; headers: Header[]; items: Item[] }) {
  return (
    <>
      <ul aria-label={`${label} (cards)`} className="flex flex-col md:hidden">
        {items.map((item) => (
          <li key={item.key} className="flex min-w-0 flex-col gap-2 border-b border-border py-4">
            <p className="text-sm font-semibold break-words text-foreground">{item.title}</p>
            {item.lines.map((line, index) => (
              <p key={index} className="text-[13px] break-words text-muted-foreground">
                {line}
              </p>
            ))}
            {item.status && <div>{item.status}</div>}
            {item.link && <div>{item.link}</div>}
          </li>
        ))}
      </ul>
      <table aria-label={label} className="hidden w-full table-fixed text-left text-sm md:table">
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header.label} scope="col" className={`${TH} ${header.width}`}>
                {header.hidden ? <span className="sr-only">{header.label}</span> : header.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.key} className="border-b border-border">
              {item.cells.map((cell, index) => (
                <td key={index} className={`${TD} min-w-0 break-words`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function ListFooter({ shown, total, href, workspace }: { shown: number; total: number; href: string; workspace: string }) {
  if (total <= shown) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-4 text-sm text-muted-foreground">
      <span>
        Showing {shown} of {total}.
      </span>
      <ActionLink href={href} label={`View all in ${workspace}`} />
    </p>
  );
}

const Ref = ({ value }: { value: string }) => <span className="font-mono text-[13px]">{value}</span>;

// ---------------------------------------------------------------------------
// 1. Scheduled jobs
// ---------------------------------------------------------------------------

const JOB_STATUS: Record<OpsJobStatus, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  running: { label: "Running normally", tone: "success" },
  behind: { label: "Behind", tone: "warning" },
  failing: { label: "Failing", tone: "danger" },
  idle: { label: "Nothing waiting", tone: "neutral" },
  untracked: { label: "Not tracked", tone: "neutral" },
};

function jobDetail(job: OpsJobRow): ReactNode {
  return job.detail.at ? (
    <>
      {job.detail.text}: <LagosTime value={job.detail.at} />
    </>
  ) : (
    job.detail.text
  );
}

export function JobsSection({ section }: { section: OpsStatus["jobs"] }) {
  const id = "ops-jobs";
  const title = "Scheduled jobs";
  if (section.state === "error") return <SectionError id={id} title={title} />;
  const attention = section.jobs.filter((job) => job.status === "behind" || job.status === "failing").length;
  const items: Item[] = section.jobs.map((job) => {
    const pill = <StatusPill label={JOB_STATUS[job.status].label} tone={JOB_STATUS[job.status].tone} />;
    return {
      key: job.id,
      cells: [
        <span key="n" className="font-semibold text-foreground">
          {job.name}
        </span>,
        pill,
        <LagosTime key="t" value={job.lastActivityAt} className="font-mono text-[13px]" />,
        jobDetail(job),
      ],
      title: job.name,
      lines: [
        <>
          Last activity: <LagosTime value={job.lastActivityAt} />
        </>,
        jobDetail(job),
      ],
      status: pill,
    };
  });
  return (
    <SectionFrame
      id={id}
      title={title}
      hasFailure={attention > 0}
      count={attention > 0 ? `${attention} ${attention === 1 ? "needs" : "need"} attention` : undefined}
    >
      <Rows
        label="Scheduled jobs"
        headers={[
          { label: "Job", width: "w-[24%]" },
          { label: "Status", width: "w-[20%]" },
          { label: "Last activity", width: "w-[22%]" },
          { label: "Detail", width: "w-[34%]" },
        ]}
        items={items}
      />
      <p className="pt-4 text-sm text-muted-foreground">{JOBS_FOOTNOTE}</p>
    </SectionFrame>
  );
}

// ---------------------------------------------------------------------------
// 2. Failed and stuck work
// ---------------------------------------------------------------------------

function failedWorkSentence(row: OpsFailedWorkRow): ReactNode {
  switch (row.kind) {
    case "export_failed":
      return `${row.label} export failed`;
    case "export_waiting":
      return (
        <>
          {row.label} export waiting since <LagosTime value={row.at} />
        </>
      );
    case "event_stopped":
      return `${row.label} event stopped after ${row.attempts ?? 0} of ${row.maxAttempts ?? 0} attempts`;
    case "event_retrying":
      return `${row.label} event retrying: ${row.attempts ?? 0} of ${row.maxAttempts ?? 0} attempts`;
  }
}

function failedWorkLink(row: OpsFailedWorkRow): { href: string; label: string } {
  if (row.kind === "event_stopped") return { href: "/staff/audit?action=domain_event.poisoned", label: "Open audit log" };
  if (row.kind === "event_retrying") return { href: "/staff/audit", label: "Open audit log" };
  return { href: "/staff/reports/exports", label: "Open export history" };
}

export function FailedWorkSection({ section }: { section: OpsStatus["failedWork"] }) {
  const id = "ops-failed-work";
  const title = "Failed and stuck work";
  if (section.state === "error") return <SectionError id={id} title={title} />;
  const items: Item[] = section.rows.map((row) => {
    const link = failedWorkLink(row);
    const action = <ActionLink href={link.href} label={link.label} />;
    return {
      key: row.key,
      cells: [
        <span key="s" className="font-semibold text-foreground">
          {failedWorkSentence(row)}
        </span>,
        <Ref key="r" value={row.reference} />,
        <LagosTime key="t" value={row.at} className="font-mono text-[13px]" />,
        action,
      ],
      title: failedWorkSentence(row),
      lines: [<Ref key="r" value={row.reference} />, <LagosTime key="t" value={row.at} />],
      link: action,
    };
  });
  return (
    <SectionFrame id={id} title={title} hasFailure={section.total > 0} count={section.total > 0 ? `${section.total} open` : undefined}>
      {section.rows.length === 0 ? (
        <EmptyCopy>No failed or stuck work.</EmptyCopy>
      ) : (
        <>
          <Rows
            label="Failed and stuck work"
            headers={[
              { label: "Work", width: "w-[46%]" },
              { label: "Reference", width: "w-[14%]" },
              { label: "When", width: "w-[22%]" },
              { label: "Link", width: "w-[18%]", hidden: true },
            ]}
            items={items}
          />
          <ListFooter shown={section.rows.length} total={section.total} href="/staff/reports/exports" workspace="Export history" />
        </>
      )}
    </SectionFrame>
  );
}

// ---------------------------------------------------------------------------
// 3. Payment exceptions
// ---------------------------------------------------------------------------

function paymentSentence(row: OpsPaymentExceptionRow): string {
  switch (row.kind) {
    case "order":
      return `Order ${row.orderReference}: ${row.reasonLabel}`;
    case "webhook":
      return row.reason === "signature_invalid"
        ? `${row.provider} webhook rejected: the signature did not match`
        : `${row.provider} webhook could not be applied`;
    case "refund":
      return `Refund failed for order ${row.orderReference}`;
    case "stuck_attempt":
      return `Payment still processing after ${row.minutes} minutes`;
  }
}

function paymentLink(row: OpsPaymentExceptionRow): { href: string; label: string } {
  if (row.kind === "webhook") return { href: "/staff/reconciliation", label: "Open reconciliation" };
  return { href: `/staff/payments/${encodeURIComponent(row.orderId)}`, label: "Open order" };
}

export function PaymentExceptionsSection({ section }: { section: OpsStatus["paymentExceptions"] }) {
  const id = "ops-payments";
  const title = "Payment exceptions";
  if (section.state === "error") return <SectionError id={id} title={title} />;
  const { open, highRisk } = section.reconciliation;
  const openCount = section.total + open;
  const items: Item[] = section.rows.map((row) => {
    const link = paymentLink(row);
    const action = <ActionLink href={link.href} label={link.label} />;
    const sentence = paymentSentence(row);
    return {
      key: row.key,
      cells: [
        <span key="s" className="font-semibold text-foreground">
          {sentence}
        </span>,
        <LagosTime key="t" value={row.at} className="font-mono text-[13px]" />,
        action,
      ],
      title: sentence,
      lines: [<LagosTime key="t" value={row.at} />],
      link: action,
    };
  });
  if (open > 0) {
    const summary = `${plural(open, "open reconciliation case")} (${highRisk} high risk)`;
    const action = <ActionLink href="/staff/reconciliation" label="Open reconciliation" />;
    items.push({
      key: "reconciliation-summary",
      cells: [
        <span key="s" className="font-semibold text-foreground">
          {summary}
        </span>,
        "—",
        action,
      ],
      title: summary,
      lines: [],
      link: action,
    });
  }
  return (
    <SectionFrame id={id} title={title} hasFailure={openCount > 0} count={openCount > 0 ? `${openCount} open` : undefined}>
      {items.length === 0 ? (
        <EmptyCopy>No payment exceptions.</EmptyCopy>
      ) : (
        <>
          <Rows
            label="Payment exceptions"
            headers={[
              { label: "Exception", width: "w-[56%]" },
              { label: "When", width: "w-[24%]" },
              { label: "Link", width: "w-[20%]", hidden: true },
            ]}
            items={items}
          />
          <ListFooter shown={section.rows.length} total={section.total} href="/staff/payments?status=EXCEPTION" workspace="Payments" />
        </>
      )}
    </SectionFrame>
  );
}

// ---------------------------------------------------------------------------
// 4. Email failures
// ---------------------------------------------------------------------------

function emailWhen(row: OpsEmailFailureRow): ReactNode {
  return row.stuckSending ? (
    <>
      Stuck sending since <LagosTime value={row.since} />
    </>
  ) : (
    <>
      Last attempt <LagosTime value={row.since} />
    </>
  );
}

export function EmailFailuresSection({ section }: { section: OpsStatus["emailFailures"] }) {
  const id = "ops-email";
  const title = "Email failures";
  if (section.state === "error") return <SectionError id={id} title={title} />;
  const items: Item[] = section.rows.map((row) => {
    const action = <ActionLink href="/staff/email-log?status=FAILED" label="Open email log" />;
    const attempts = `${row.attempts} of ${row.maxAttempts} attempts`;
    return {
      key: row.id,
      cells: [
        <span key="s">
          <span className="font-semibold text-foreground">{row.templateLabel}</span> <Ref value={row.reference} />
        </span>,
        attempts,
        emailWhen(row),
        action,
      ],
      title: row.templateLabel,
      lines: [<Ref key="r" value={row.reference} />, attempts, emailWhen(row)],
      link: action,
    };
  });
  return (
    <SectionFrame id={id} title={title} hasFailure={section.total > 0} count={section.total > 0 ? `${section.total} open` : undefined}>
      {section.rows.length === 0 ? (
        <EmptyCopy>No email failures.</EmptyCopy>
      ) : (
        <>
          <Rows
            label="Email failures"
            headers={[
              { label: "Email", width: "w-[34%]" },
              { label: "Attempts", width: "w-[18%]" },
              { label: "Last attempt", width: "w-[28%]" },
              { label: "Link", width: "w-[20%]", hidden: true },
            ]}
            items={items}
          />
          <ListFooter shown={section.rows.length} total={section.total} href="/staff/email-log?status=FAILED" workspace="Email log" />
        </>
      )}
    </SectionFrame>
  );
}

// ---------------------------------------------------------------------------
// 5. Data integrity checks
// ---------------------------------------------------------------------------

function integrityResult(check: OpsIntegrityRow): ReactNode {
  if (check.status === "passed") return <StatusPill label="Passed" tone="success" />;
  if (check.status === "error") return <StatusPill label="Could not run" tone="warning" />;
  return <StatusPill label={`${plural(check.violationCount, "record needs", "records need")} review`} tone="danger" />;
}

export function IntegritySection({ section }: { section: OpsStatus["integrity"] }) {
  const id = "ops-integrity";
  const title = "Data integrity checks";
  if (section.state === "error") return <SectionError id={id} title={title} />;
  const failing = section.checks.filter((check) => check.status !== "passed").length;
  const items: Item[] = section.checks.map((check) => ({
    key: check.id,
    cells: [<span key="l">{check.label}</span>, integrityResult(check)],
    title: check.label,
    lines: [],
    status: integrityResult(check),
  }));
  return (
    <SectionFrame
      id={id}
      title={title}
      hasFailure={failing > 0}
      count={failing > 0 ? `${failing} ${failing === 1 ? "needs" : "need"} review` : undefined}
    >
      <Rows
        label="Data integrity checks"
        headers={[
          { label: "Check", width: "w-[64%]" },
          { label: "Result", width: "w-[36%]" },
        ]}
        items={items}
      />
    </SectionFrame>
  );
}

// ---------------------------------------------------------------------------
// The body of the page
// ---------------------------------------------------------------------------

/** The page body in UI-SPEC order: Scheduled jobs, Failed and stuck work, Payment exceptions, Email failures, Data integrity checks. */
export function OperationsSections({ status, summary }: { status: OpsStatus; summary: OpsSummary }) {
  return (
    <div className="flex flex-col gap-8 lg:gap-12">
      {!summary.needsAttention && <p className="text-base text-muted-foreground">{ALL_CLEAR_LINE}</p>}
      <JobsSection section={status.jobs} />
      <FailedWorkSection section={status.failedWork} />
      <PaymentExceptionsSection section={status.paymentExceptions} />
      <EmailFailuresSection section={status.emailFailures} />
      <IntegritySection section={status.integrity} />
    </div>
  );
}
