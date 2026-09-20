import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { LearnerPageHeader } from "@/components/shell/LearnerPageHeader";
import { DELIVERY_MODE_LABEL, formatPrice } from "@/app/(public)/CohortCards";
import { listPublicProgrammes, type PublicCohort } from "@/server/services/public-catalogue-service";

// Rendered per request, never prerendered — the Docker builder has no
// DATABASE_URL (04-15 planner fallback; 04-10 `docker build` requirement).
export const dynamic = "force-dynamic";
export const metadata = { title: "Programmes" };

/** "30 Nov 2026" — pinned locale so server and browser agree. */
function shortDate(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(value),
  );
}

function headlinePrice(cohort: PublicCohort | null): string | null {
  if (!cohort) return null;
  if (cohort.priceNgnMinor !== null) return formatPrice(cohort.priceNgnMinor, "NGN");
  if (cohort.priceUsdMinor !== null) return formatPrice(cohort.priceUsdMinor, "USD");
  return null;
}

export default async function PublicProgrammesPage() {
  const programmes = await listPublicProgrammes();

  return (
    <div className="flex flex-col gap-6">
      <LearnerPageHeader size="hero" title="Programmes" subtitle="Structured programmes made of several courses." />
      {programmes.length === 0 ? (
        <p className="border-t border-foreground py-12 text-sm text-muted-foreground">
          No programmes are listed right now.
        </p>
      ) : (
        <ul className="border-t border-foreground">
          {programmes.map((programme) => {
            const price = headlinePrice(programme.nextCohort);
            return (
              <li key={programme.slug} className="border-b border-border">
                <Link
                  href={`/programmes/${programme.slug}`}
                  className="grid gap-3 py-8 text-foreground hover:bg-surface-2/60 md:grid-cols-[minmax(0,1fr)_220px_150px_28px] md:items-center md:gap-8"
                >
                  <div className="min-w-0">
                    <div className="text-[24px] leading-[1.2] font-semibold tracking-[-0.025em] break-words">
                      {programme.title}
                    </div>
                    {programme.summary && (
                      <p className="mt-2 max-w-[560px] text-muted-foreground">{programme.summary}</p>
                    )}
                  </div>
                  <div>
                    {programme.nextCohort && (
                      <div className="text-[13px] text-muted-foreground">
                        {DELIVERY_MODE_LABEL[programme.nextCohort.deliveryMode] ?? programme.nextCohort.deliveryMode}
                      </div>
                    )}
                    <div className={`mt-1 font-semibold ${programme.nextCohort ? "" : "text-muted-foreground"}`}>
                      {programme.nextCohort
                        ? `Next start ${shortDate(programme.nextCohort.startsAt)}`
                        : "No dates scheduled"}
                    </div>
                  </div>
                  <div className="font-mono text-[16px] font-medium tabular-nums md:text-right">
                    {price ?? <span className="text-muted-foreground">—</span>}
                  </div>
                  <ArrowRight aria-hidden className="hidden size-5 text-accent md:block" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
