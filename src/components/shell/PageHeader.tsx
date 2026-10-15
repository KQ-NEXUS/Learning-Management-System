import Link from "next/link";
import type { ReactNode } from "react";

/**
 * PageHeader — a staff page's head in the IETC look (design/mockups/system.css `.st-head`):
 * the breadcrumb, the condensed display title with any status beside it, the record's
 * identifier and a one-line description, and the page's actions on the right.
 *
 * It sits on the page ground at the top of the staff shell's <main>. `tint` paints the head
 * in a course's class colour (a cohort or course page) and pulls it out to the full width.
 * Plain, hook-free markup, so it renders on the server and the h1 is in the initial HTML.
 */

export type PageHeaderProps = {
  breadcrumbs?: { label: string; href?: string }[];
  title: string;
  /** Record identifier (a code or slug). */
  identifier?: string;
  subtitle?: ReactNode;
  /** Status shown beside the title. */
  meta?: ReactNode;
  actions?: ReactNode;
  /** Extra content under the title (e.g. the overview figures). */
  band?: ReactNode;
  /** A class tint utility such as `bg-tint-2`; the head then spans the full width in that colour. */
  tint?: string;
};

export function PageHeader({ breadcrumbs, title, identifier, subtitle, meta, actions, band, tint }: PageHeaderProps) {
  return (
    <header
      className={`flex flex-col gap-3 pt-[26px] pb-7 ${tint ? `${tint} -mx-5 px-5 md:-mx-14 md:px-14` : ""}`}
    >
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb">
          <ol className={`flex flex-wrap items-center gap-2 text-sm font-semibold ${tint ? "text-tint-text" : "text-ink-soft"}`}>
            {breadcrumbs.map((crumb, i) => (
              <li
                key={`${crumb.label}-${i}`}
                className={`flex items-center gap-2 ${i === breadcrumbs.length - 1 ? "min-w-0" : "shrink-0"} ${i < breadcrumbs.length - 2 ? "max-sm:hidden" : ""}`}
              >
                {i > 0 && (
                  <span aria-hidden className={`text-rule ${i === breadcrumbs.length - 2 ? "max-sm:hidden" : ""}`}>
                    /
                  </span>
                )}
                {crumb.href ? (
                  <Link href={crumb.href} className="hover:text-ink hover:underline hover:underline-offset-4">
                    {crumb.label}
                  </Link>
                ) : (
                  <span aria-current="page" className="truncate">
                    {crumb.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div className="flex flex-wrap items-end justify-between gap-x-7 gap-y-[18px]">
        <div className="flex min-w-0 flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h1 className="ietc-display text-[clamp(38px,4.4vw,64px)] break-words">{title}</h1>
            {meta && <div className="flex flex-wrap items-center gap-3">{meta}</div>}
          </div>
          {(identifier || subtitle) && (
            <div className={`flex max-w-[70ch] flex-wrap items-center gap-x-4 gap-y-1 ${tint ? "text-tint-text" : "text-ink-soft"} text-[17px] md:text-[18.5px]`}>
              {identifier && <p className="font-bold tracking-[0.04em]">{identifier}</p>}
              {subtitle && <p>{subtitle}</p>}
            </div>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2.5 max-sm:w-full max-sm:[&>*]:flex-1">{actions}</div>}
      </div>
      {band}
    </header>
  );
}
