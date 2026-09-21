import Link from "next/link";
import { Award, CreditCard, ListChecks, Users, Plus, ArrowRight, type LucideIcon } from "lucide-react";
import { can } from "@/server/permissions";
import {
  loadStaffOverview,
  type OverviewQueueItem,
  type OverviewSession,
  type StaffOverview,
} from "@/server/services/staff-overview-service";
import { PageHeader } from "@/components/shell/PageHeader";

/**
 * `/staff` — the workspace overview. Figures sit in the navy band under the title; the work
 * that is waiting (oldest first) leads the page, with the enrolment trend beneath it, and the
 * coming sessions and filling cohorts down the side. Each section appears only for staff who
 * can see its data (see `staff-overview-service.ts`).
 */

export const metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

const QUEUE_ICON: Record<OverviewQueueItem["kind"], LucideIcon> = {
  grading: ListChecks,
  attendance: Users,
  certificates: Award,
  refund: CreditCard,
  payment: CreditCard,
};

const dateFormat = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" });

function money(currency: string, minor: number): string {
  const locale = currency === "NGN" ? "en-NG" : "en-US";
  return new Intl.NumberFormat(locale, { style: "currency", currency, notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(minor / 100);
}

function ageLabel(days: number): string {
  if (days <= 0) return "Today";
  return days === 1 ? "1 day" : `${days} days`;
}

function Figure({ label, value, caption, first }: { label: string; value: string; caption: string; first?: boolean }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${first ? "" : "lg:border-l lg:border-sidebar-line lg:pl-6"}`}>
      <span className="text-sm text-sidebar-soft">{label}</span>
      <span className="font-mono text-[36px] leading-[1.15] font-medium tracking-[-0.03em] text-white tabular-nums">{value}</span>
      <span className="text-sm text-sidebar-soft">{caption}</span>
    </div>
  );
}

function FiguresBand({ figures }: { figures: StaffOverview["figures"] }) {
  const cells: { label: string; value: string; caption: string }[] = [];
  if (figures.learnersInDelivery) {
    const f = figures.learnersInDelivery;
    cells.push({
      label: "Learners in delivery",
      value: String(f.learners),
      caption: f.cohorts === 1 ? "1 cohort running" : `${f.cohorts} cohorts running`,
    });
  }
  if (figures.enrolments) {
    const { thisMonth, lastMonth } = figures.enrolments;
    const diff = thisMonth - lastMonth;
    cells.push({
      label: "Enrolments this month",
      value: String(thisMonth),
      caption: diff === 0 ? "Same as last month" : `${Math.abs(diff)} ${diff > 0 ? "more" : "fewer"} than last month`,
    });
  }
  if (figures.revenue) {
    const ngn = figures.revenue.find((r) => r.currency === "NGN");
    const other = figures.revenue.filter((r) => r.currency !== "NGN");
    const primary = ngn ?? other[0];
    cells.push({
      label: "Revenue this month",
      value: primary ? money(primary.currency, primary.amountMinor) : "—",
      caption: ngn && other.length > 0 ? `Plus ${other.map((r) => money(r.currency, r.amountMinor)).join(", ")}` : "Paid orders",
    });
  }
  if (figures.attendance) {
    cells.push({
      label: "Attendance",
      value: figures.attendance.percent === null ? "—" : `${figures.attendance.percent}%`,
      caption: figures.attendance.recorded > 0 ? "Present or late, this month" : "Nothing recorded yet",
    });
  }
  if (cells.length === 0) return null;
  return (
    <div
      className="mt-6 grid grid-cols-2 gap-x-6 gap-y-8 lg:[grid-template-columns:repeat(var(--cols),minmax(0,1fr))]"
      style={{ ["--cols" as string]: cells.length }}
    >
      {cells.map((c, i) => (
        <Figure key={c.label} {...c} first={i === 0} />
      ))}
    </div>
  );
}

function SectionHead({ id, title, right }: { id: string; title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 pb-4">
      <h2 id={id} className="flex items-center gap-3 text-[20px] font-semibold tracking-[-0.015em] text-foreground">
        {title}
      </h2>
      {right}
    </div>
  );
}

function NeedsAttention({ items }: { items: OverviewQueueItem[] }) {
  const overdue = items.filter((i) => i.overdue).length;
  return (
    <section aria-labelledby="needs-attention">
      <div className="flex items-baseline justify-between gap-4 pb-4">
        <h2 id="needs-attention" className="flex items-center gap-3 text-[20px] font-semibold tracking-[-0.015em] text-foreground">
          Needs attention
          {overdue > 0 && <span aria-hidden className="alert-dot" />}
        </h2>
        <span className="text-sm">
          {overdue > 0 && <span className="font-semibold text-danger">{overdue} overdue · </span>}
          <span className="text-muted-foreground">{items.length} open</span>
        </span>
      </div>
      {items.length === 0 ? (
        <p className="border-t border-foreground py-8 text-base text-muted-foreground">Nothing is waiting on you right now.</p>
      ) : (
        <ul className={`border-t-2 ${overdue > 0 ? "border-danger" : "border-foreground"}`}>
          {items.map((item) => {
            const Icon = QUEUE_ICON[item.kind];
            return (
              <li
                key={item.key}
                className={`-mx-3 grid grid-cols-[28px_minmax(0,1fr)_72px_84px] items-center gap-4 border-b border-border px-3 py-4 ${item.overdue ? "bg-danger-surface" : ""}`}
              >
                <Icon aria-hidden className="size-5 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-base font-semibold text-foreground">{item.title}</p>
                  <p className="truncate text-sm text-muted-foreground">{item.detail}</p>
                </div>
                <span className={`text-right font-mono text-[13px] ${item.overdue ? "font-medium text-danger" : "text-muted-foreground"}`}>
                  {ageLabel(item.ageDays)}
                </span>
                <Link href={item.href} className="inline-flex items-center justify-end gap-1.5 text-sm font-semibold text-accent hover:underline">
                  Review <ArrowRight aria-hidden className="size-3.5" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function EnrolmentTrend({ weekly }: { weekly: NonNullable<StaffOverview["weekly"]> }) {
  const W = 640;
  const X0 = 34;
  const plotW = W - X0 - 8;
  const max = Math.max(4, Math.ceil(Math.max(...weekly.map((w) => w.count)) / 4) * 4);
  const x = (i: number) => X0 + (i * plotW) / (weekly.length - 1);
  const y = (v: number) => 176 - (v / max) * 160;
  const pts = weekly.map((w, i) => `${x(i).toFixed(1)},${y(w.count).toFixed(1)}`).join(" ");
  const last = weekly[weekly.length - 1];
  const label = (d: Date) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(d);
  const total = weekly.reduce((n, w) => n + w.count, 0);
  return (
    <section aria-labelledby="enrolment-trend">
      <SectionHead id="enrolment-trend" title="Enrolments per week" right={<span className="text-sm text-muted-foreground">Last 12 weeks</span>} />
      <div className="border-t border-foreground pt-5">
        <svg
          viewBox={`0 0 ${W} 214`}
          role="img"
          aria-label={`${total} enrolments over the last 12 weeks; ${last.count} in the latest week`}
          className="h-auto w-full"
        >
          {[0, max / 2, max].map((v) => (
            <g key={v}>
              <line x1={X0} x2={W} y1={y(v)} y2={y(v)} className="stroke-border" strokeWidth="1" />
              <text x="0" y={y(v) + 4} className="fill-muted-foreground font-mono text-[12px]">
                {Math.round(v)}
              </text>
            </g>
          ))}
          <polygon points={`${X0},176 ${pts} ${x(weekly.length - 1).toFixed(1)},176`} className="fill-accent-wash" />
          <polyline points={pts} fill="none" className="stroke-accent" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={x(weekly.length - 1)} cy={y(last.count)} r="6" className="fill-accent stroke-surface" strokeWidth="3" />
          {[0, 5, 11].map((i) => (
            <text key={i} x={i === 11 ? x(i) + 6 : x(i)} y="204" textAnchor={i === 11 ? "end" : "middle"} className="fill-muted-foreground font-mono text-[12px]">
              {label(weekly[i].weekStart)}
            </text>
          ))}
        </svg>
      </div>
    </section>
  );
}

function dayHeading(d: Date, tz: string) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(d);
}
function timeOf(d: Date, tz: string) {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(d);
}

function NextSessions({ sessions }: { sessions: OverviewSession[] }) {
  const byDay = new Map<string, OverviewSession[]>();
  for (const s of sessions) {
    const k = dayHeading(s.startsAt, s.timezone);
    byDay.set(k, [...(byDay.get(k) ?? []), s]);
  }
  return (
    <section aria-labelledby="next-sessions">
      <SectionHead id="next-sessions" title="Next sessions" right={<span className="text-sm text-muted-foreground">This week</span>} />
      <div className="border-t border-foreground">
        {sessions.length === 0 ? (
          <p className="py-6 text-base text-muted-foreground">No sessions in the next seven days.</p>
        ) : (
          [...byDay.entries()].map(([day, rows]) => (
            <div key={day}>
              <p className="pt-5 pb-1 text-sm font-semibold text-foreground">{day}</p>
              {rows.map((s) => (
                <Link key={s.id} href={`/staff/cohorts/${s.cohortId}/sessions/${s.id}/attendance`} className="grid grid-cols-[56px_minmax(0,1fr)] gap-3 py-2 hover:bg-surface-2">
                  <span className="pt-0.5 font-mono text-[13px] font-medium text-accent">{timeOf(s.startsAt, s.timezone)}</span>
                  <span>
                    <span className="block text-base font-semibold text-foreground">{s.title}</span>
                    <span className="block text-sm text-muted-foreground">
                      <span className="font-mono text-[13px]">{s.cohortCode}</span> · {s.location ?? (s.virtual ? "Virtual" : "Location to be confirmed")}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function Filling({ cohorts }: { cohorts: NonNullable<StaffOverview["filling"]> }) {
  return (
    <section aria-labelledby="filling-up">
      <SectionHead id="filling-up" title="Filling up" right={<span className="text-sm text-muted-foreground">Seats taken</span>} />
      <div className="border-t border-foreground">
        {cohorts.length === 0 ? (
          <p className="py-6 text-base text-muted-foreground">No cohorts are open for registration.</p>
        ) : (
          cohorts.map((c) => (
            <Link key={c.cohortId} href={`/staff/cohorts/${c.cohortId}`} className="block border-b border-border py-4 hover:bg-surface-2">
              <span className="flex items-baseline justify-between gap-3">
                <span className="text-base font-semibold text-foreground">{c.title}</span>
                <span className="font-mono text-[13px] whitespace-nowrap text-foreground">
                  {c.taken} of {c.capacity}
                </span>
              </span>
              <span className="mt-0.5 mb-2 block text-sm text-muted-foreground">
                <span className="font-mono text-[13px]">{c.code}</span> · starts {new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: c.timezone }).format(c.startsAt)}
              </span>
              <span className="block h-1 rounded-sm bg-accent-wash">
                <span className="block h-full rounded-sm bg-accent" style={{ width: `${Math.min(100, Math.round((c.taken / c.capacity) * 100))}%` }} />
              </span>
            </Link>
          ))
        )}
      </div>
    </section>
  );
}

export default async function StaffOverviewPage() {
  const [overview, canCreateCohort] = await Promise.all([loadStaffOverview(), can("cohorts.manage", {})]);

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Overview"
        subtitle={dateFormat.format(overview.now)}
        band={<FiguresBand figures={overview.figures} />}
        actions={
          canCreateCohort ? (
            <Link
              href="/staff/cohorts/new"
              className="inline-flex min-h-11 items-center gap-2 rounded-md bg-accent px-5 text-sm font-semibold text-accent-contrast hover:bg-accent-deep"
            >
              <Plus aria-hidden className="size-4" />
              New cohort
            </Link>
          ) : undefined
        }
      />

      <div className="mt-4 grid gap-12 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex flex-col gap-14">
          {overview.queue && <NeedsAttention items={overview.queue} />}
          {overview.weekly && <EnrolmentTrend weekly={overview.weekly} />}
          {!overview.queue && !overview.weekly && (
            <p className="border-t border-foreground py-8 text-base text-muted-foreground">
              Your role does not include the views this page summarises. Use the menu to open the sections you can access.
            </p>
          )}
        </div>
        <div className="flex flex-col gap-14 xl:border-l xl:border-border xl:pl-10">
          {overview.nextSessions && <NextSessions sessions={overview.nextSessions} />}
          {overview.filling && <Filling cohorts={overview.filling} />}
        </div>
      </div>
    </div>
  );
}
