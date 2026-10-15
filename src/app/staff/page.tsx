import Link from "next/link";
import { Award, CreditCard, ListChecks, Users, Plus, type LucideIcon } from "lucide-react";
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

/** One headline figure in the white strip (design/mockups/staff-overview.html `.figs`). */
function Figure({ label, value, caption, index }: { label: string; value: string; caption: string; index: number }) {
  return (
    <div
      className={`flex min-w-0 flex-col px-5 py-5 md:px-8 md:py-[26px] ${index % 2 === 1 ? "border-l border-rule" : ""} ${index > 1 ? "border-t border-rule lg:border-t-0" : ""} ${index > 0 ? "lg:border-l lg:border-rule" : "lg:pl-14"}`}
    >
      <span className="font-bold">{label}</span>
      <span className="ietc-display mt-2 mb-1.5 text-[48px] leading-none tabular-nums lg:text-[76px]">{value}</span>
      <span className="text-[14.5px] text-ink-soft">{caption}</span>
    </div>
  );
}

function FiguresStrip({ figures }: { figures: StaffOverview["figures"] }) {
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
    <section aria-label="This month" className="-mx-5 mt-12 bg-paper md:-mx-14 md:mt-[52px]">
      <div
        className="grid grid-cols-2 lg:[grid-template-columns:repeat(var(--cols),minmax(0,1fr))]"
        style={{ ["--cols" as string]: cells.length }}
      >
        {cells.map((c, i) => (
          <Figure key={c.label} {...c} index={i} />
        ))}
      </div>
    </section>
  );
}

function SectionHead({ id, title, right }: { id: string; title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b-2 border-ink pb-3">
      <h2 id={id} className="ietc-display text-[25px] leading-none md:text-[28px]">
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
      <div className="border-b-2 border-ink pb-3">
        <h2 id="needs-attention" className="ietc-display text-[clamp(30px,3.4vw,46px)] leading-[0.95]">
          {items.length === 0 ? (
            "Needs attention"
          ) : (
            <>
              {items.length} {items.length === 1 ? "thing needs" : "things need"} attention
              {overdue > 0 && <span className="text-danger">, {overdue} overdue</span>}
            </>
          )}
        </h2>
      </div>
      {items.length === 0 ? (
        <p className="py-6 text-ink-soft">Nothing is waiting on you right now.</p>
      ) : (
        <ul>
          {items.map((item) => {
            const Icon = QUEUE_ICON[item.kind];
            return (
              <li
                key={item.key}
                className={`grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-4 py-4 sm:grid-cols-[24px_minmax(0,1fr)_76px_auto] ${
                  item.overdue ? "-mx-3.5 mt-1.5 rounded-[10px] bg-danger-surface px-3.5" : "border-b border-rule"
                }`}
              >
                <Icon aria-hidden className={`size-5 ${item.overdue ? "text-danger" : "text-ink-soft"}`} />
                <div className="min-w-0">
                  <p className="text-[17px] font-bold">{item.title}</p>
                  <p className="truncate text-[14.5px] text-ink-soft">{item.detail}</p>
                </div>
                <span className={`text-right text-[14.5px] font-semibold max-sm:hidden ${item.overdue ? "text-danger" : "text-ink-soft"}`}>
                  {ageLabel(item.ageDays)}
                </span>
                <Link href={item.href} className="font-bold underline underline-offset-4 hover:text-orange-text">
                  Review
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
  // SVG text cannot hold a <time> element, so the week label is formatted in Lagos time directly (D-17).
  const label = (d: Date) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" }).format(d);
  const total = weekly.reduce((n, w) => n + w.count, 0);
  return (
    <section aria-labelledby="enrolment-trend">
      <SectionHead id="enrolment-trend" title="Enrolments per week" right={<span className="text-[14.5px] text-ink-soft">Last 12 weeks</span>} />
      <div className="pt-[18px]">
        <svg
          viewBox={`0 0 ${W} 214`}
          role="img"
          aria-label={`${total} enrolments over the last 12 weeks; ${last.count} in the latest week`}
          className="h-auto w-full"
        >
          {[0, max / 2, max].map((v) => (
            <g key={v}>
              <line x1={X0} x2={W} y1={y(v)} y2={y(v)} className="stroke-rule" strokeWidth="1" />
              <text x="0" y={y(v) + 4} className="fill-ink-soft text-[12px]">
                {Math.round(v)}
              </text>
            </g>
          ))}
          <polygon points={`${X0},176 ${pts} ${x(weekly.length - 1).toFixed(1)},176`} className="fill-peach" />
          <polyline points={pts} fill="none" className="stroke-ink" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={x(weekly.length - 1)} cy={y(last.count)} r="6" className="fill-orange stroke-paper" strokeWidth="3" />
          {[0, 5, 11].map((i) => (
            <text key={i} x={x(i)} y="204" textAnchor={i === 0 ? "start" : i === 11 ? "end" : "middle"} className="fill-ink-soft text-[12px]">
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
      <SectionHead id="next-sessions" title="Next sessions" right={<span className="text-[14.5px] text-ink-soft">This week</span>} />
      {sessions.length === 0 ? (
        <p className="py-6 text-ink-soft">No sessions in the next seven days.</p>
      ) : (
        [...byDay.entries()].map(([day, rows]) => (
          <div key={day}>
            <p className="pt-3.5 pb-1 text-sm font-bold text-ink-soft">{day}</p>
            {rows.map((s) => (
              <Link
                key={s.id}
                href={`/staff/cohorts/${s.cohortId}/sessions/${s.id}/attendance`}
                className="group grid grid-cols-[76px_minmax(0,1fr)] gap-3 border-b border-rule py-3"
              >
                <span className="ietc-display text-[26px] leading-[1.1]">{timeOf(s.startsAt, s.timezone)}</span>
                <span>
                  <b className="block font-bold group-hover:underline group-hover:underline-offset-4">{s.title}</b>
                  <span className="block text-sm text-ink-soft">
                    {s.cohortCode} · {s.location ?? (s.virtual ? "Virtual" : "Location to be confirmed")}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        ))
      )}
    </section>
  );
}

function Filling({ cohorts }: { cohorts: NonNullable<StaffOverview["filling"]> }) {
  return (
    <section aria-labelledby="filling-up">
      <SectionHead id="filling-up" title="Filling up" right={<span className="text-[14.5px] text-ink-soft">Seats taken</span>} />
      {cohorts.length === 0 ? (
        <p className="py-6 text-ink-soft">No cohorts are open for registration.</p>
      ) : (
        cohorts.map((c) => (
          <Link key={c.cohortId} href={`/staff/cohorts/${c.cohortId}`} className="group block border-b border-rule py-4">
            <span className="flex items-baseline justify-between gap-3">
              <b className="font-bold group-hover:underline group-hover:underline-offset-4">{c.title}</b>
              <span className="ietc-display text-[22px] whitespace-nowrap">
                {c.taken} of {c.capacity}
              </span>
            </span>
            <span className="mt-0.5 mb-2.5 block text-sm text-ink-soft">
              {c.code} · starts {new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: c.timezone }).format(c.startsAt)}
            </span>
            <span className="block h-2.5 overflow-hidden rounded-full bg-rule">
              <span className="block h-full rounded-full bg-ink" style={{ width: `${Math.min(100, Math.round((c.taken / c.capacity) * 100))}%` }} />
            </span>
          </Link>
        ))
      )}
    </section>
  );
}

export default async function StaffOverviewPage() {
  const [overview, canCreateCohort] = await Promise.all([loadStaffOverview(), can("cohorts.manage", {})]);
  const nothingVisible = !overview.queue && !overview.weekly && !overview.nextSessions && !overview.filling;

  return (
    <div data-primary-content className="flex flex-col">
      <PageHeader
        title="Overview"
        subtitle={dateFormat.format(overview.now)}
        actions={
          canCreateCohort ? (
            <Link
              href="/staff/cohorts/new"
              className="inline-flex min-h-12 items-center gap-2.5 rounded-[10px] bg-ink px-[22px] text-[15.5px] font-bold text-white hover:bg-ink-hover"
            >
              <Plus aria-hidden className="size-[19px]" strokeWidth={2.3} />
              New cohort
            </Link>
          ) : undefined
        }
      />

      {nothingVisible && (
        <p className="border-t-2 border-ink py-8 text-ink-soft">
          Your role does not include the views this page summarises. Use the menu to open the sections you can access.
        </p>
      )}

      {(overview.queue || overview.nextSessions) && (
        <div className="grid items-start gap-11 pt-2 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-16">
          {overview.queue ? <NeedsAttention items={overview.queue} /> : <div />}
          {overview.nextSessions && <NextSessions sessions={overview.nextSessions} />}
        </div>
      )}

      <FiguresStrip figures={overview.figures} />

      {(overview.weekly || overview.filling) && (
        <div className="grid items-start gap-11 pt-12 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-16">
          {overview.weekly ? <EnrolmentTrend weekly={overview.weekly} /> : <div />}
          {overview.filling && <Filling cohorts={overview.filling} />}
        </div>
      )}
    </div>
  );
}
