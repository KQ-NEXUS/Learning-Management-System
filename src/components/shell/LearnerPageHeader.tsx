import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

/**
 * LearnerPageHeader — a learner or public page's head in the IETC look: an optional back
 * link, the condensed display title and a lede, the page's actions, and an optional band
 * underneath (e.g. the course facts strip).
 *
 * It sits on the page ground at the top of the shell's <main>. `tint` paints the head in a
 * class colour and pulls it out to the full width (a course's own page). Hook-free, so it
 * renders on the server and the h1 is in the initial HTML.
 */
export type LearnerPageHeaderProps = {
  title: string;
  subtitle?: ReactNode;
  /** A single "go back" link shown above the title. */
  back?: { label: string; href: string };
  actions?: ReactNode;
  /** Catalogue pages draw a bigger headline than the working pages. */
  size?: "default" | "hero" | "display";
  /** Extra content under the title (e.g. the course facts strip). */
  band?: ReactNode;
  /** A class tint utility such as `bg-tint-1` or `bg-peach`; the head then spans the full width. */
  tint?: string;
};

const H1_SIZE = {
  default: "text-[clamp(38px,4.4vw,64px)]",
  hero: "text-[clamp(42px,5.2vw,74px)]",
  display: "text-[clamp(42px,5.2vw,74px)]",
} as const;

export function LearnerPageHeader({ title, subtitle, back, actions, size = "default", band, tint }: LearnerPageHeaderProps) {
  return (
    <header className={`flex flex-col gap-3 pt-7 pb-[30px] md:pt-10 ${tint ? `${tint} -mx-5 px-5 md:-mx-14 md:px-14` : ""}`}>
      {back && (
        <Link href={back.href} className="inline-flex min-h-8 w-fit items-center gap-2 text-[15px] font-bold text-ink hover:underline hover:underline-offset-4">
          <ArrowLeft aria-hidden className="size-[19px]" strokeWidth={2.3} />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-7 gap-y-[18px]">
        <div className="flex min-w-0 flex-col gap-3">
          <h1 className={`ietc-display ${H1_SIZE[size]} break-words`}>{title}</h1>
          {subtitle && <p className={`max-w-[58ch] text-[17px] md:text-[18.5px] ${tint ? "text-tint-text" : "text-ink-soft"}`}>{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
      </div>
      {band && <div className="mt-5">{band}</div>}
    </header>
  );
}
