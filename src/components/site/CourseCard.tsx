import Link from "next/link";
import { DELIVERY_MODE_LABEL, formatPrice } from "@/app/(public)/CohortCards";
import type { PublicCohort } from "@/server/services/public-catalogue-service";

/** What a card needs: a course or a programme listing. */
export type CardListing = {
  slug: string;
  title: string;
  summary: string | null;
  durationHours?: number | null;
  nextCohort: PublicCohort | null;
};

/**
 * A course in the IETC catalogue look: a tinted band with when it starts and how it is
 * taught, then the title, summary, naira price and length. The whole card is the link.
 */

const TINTS = ["bg-tint-1", "bg-tint-2", "bg-tint-3", "bg-tint-4", "bg-tint-5", "bg-tint-6", "bg-tint-7", "bg-tint-8"] as const;

/**
 * A course's class colour, picked from its slug so it is the same on every page and every
 * visit. A course with no dated class gets the neutral tint, so colour always means "on".
 */
export function courseTint(slug: string, hasDates: boolean): (typeof TINTS)[number] {
  if (!hasDates) return "bg-tint-4";
  let hash = 0;
  for (const ch of slug) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTS[hash % TINTS.length];
}

const START = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" });

export function startLabel(course: CardListing): string {
  const next = course.nextCohort;
  if (!next) return "No dates yet";
  return next.hasStarted ? "Enrolling now" : `Starts ${START.format(next.startsAt)}`;
}

/** A course card; pass `href` to point it elsewhere (a programme card). */
export function CourseCard({ course, href }: { course: CardListing; href?: string }) {
  const next = course.nextCohort;
  return (
    <Link
      href={href ?? `/courses/${course.slug}`}
      className="flex flex-col overflow-hidden rounded-[18px] bg-paper shadow-ietc-card hover:shadow-ietc-card-hover"
    >
      <div
        className={`ietc-display flex justify-between gap-3 px-5 py-3 text-[18px] tracking-[0.02em] uppercase ${courseTint(course.slug, next !== null)}`}
      >
        <span>{startLabel(course)}</span>
        {next && <span>{DELIVERY_MODE_LABEL[next.deliveryMode]}</span>}
      </div>
      <div className="flex flex-1 flex-col px-5 pt-[18px] pb-5">
        <h3 className="ietc-display text-[25px] leading-[1.02]">{course.title}</h3>
        {course.summary && <p className="mt-2 text-[14.5px] text-ink-soft">{course.summary}</p>}
        <div className="mt-auto flex items-baseline justify-between gap-3 pt-4">
          {next?.priceNgnMinor != null ? (
            <span className="ietc-display text-[24px] leading-none">{formatPrice(next.priceNgnMinor, "NGN")}</span>
          ) : next?.priceUsdMinor != null ? (
            <span className="ietc-display text-[24px] leading-none">{formatPrice(next.priceUsdMinor, "USD")}</span>
          ) : (
            <span className="text-[14.5px] text-ink-soft">Price to be announced</span>
          )}
          {course.durationHours != null && <span className="text-[14.5px] text-ink-soft">{course.durationHours} hours</span>}
        </div>
      </div>
    </Link>
  );
}
