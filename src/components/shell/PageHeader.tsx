import Link from "next/link";
import type { ReactNode } from "react";

/**
 * PageHeader — the page title, drawn in the navy band.
 *
 * The staff shell puts a 68px navy bar above a white content sheet with rounded top
 * corners. A page that renders this component pulls its own header up into that band
 * (negative margins cancel the shell's main padding) and finishes it with a white cap
 * that overlaps the band's bottom edge, so the rounded corners land below the title.
 *
 * It is plain, hook-free markup on purpose: it renders on the server, so the h1 is in
 * the initial HTML (no portal, no post-hydration jump). It must be the FIRST child of
 * the shell's <main>; the negative top margin assumes it.
 *
 * Anything inside `meta` (status text) picks up the on-navy colours through the
 * `on-navy` class in globals.css.
 */

export type PageHeaderProps = {
  breadcrumbs?: { label: string; href?: string }[];
  title: string;
  /** Record identifier, rendered in mono (a code or slug). */
  identifier?: string;
  subtitle?: ReactNode;
  /** Status text shown beside the title. */
  meta?: ReactNode;
  actions?: ReactNode;
  /** Extra content under the title, still on the navy band (e.g. the overview figures). */
  band?: ReactNode;
};

export function PageHeader({
  breadcrumbs,
  title,
  identifier,
  subtitle,
  meta,
  actions,
  band,
}: PageHeaderProps) {
  return (
    <div className="-mx-[25px] -mt-[37px] lg:-mx-[41px]">
      <header className="on-navy flex flex-col gap-3 bg-sidebar-bg px-[25px] pt-[10px] pb-[56px] text-white lg:px-[41px]">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav aria-label="Breadcrumb">
            <ol className="flex items-center gap-1.5 text-sm text-sidebar-soft">
              {breadcrumbs.map((crumb, i) => (
                <li
                  key={`${crumb.label}-${i}`}
                  className={`flex items-center gap-1.5 ${
                    i === breadcrumbs.length - 1 ? "min-w-0" : "shrink-0"
                  } ${i < breadcrumbs.length - 2 ? "max-sm:hidden" : ""}`}
                >
                  {i > 0 && (
                    <span aria-hidden className={i === breadcrumbs.length - 2 ? "max-sm:hidden" : undefined}>
                      /
                    </span>
                  )}
                  {crumb.href ? (
                    <Link href={crumb.href} className="hover:text-white hover:underline">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="truncate font-semibold text-white">{crumb.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        )}

        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <h1 className="text-[36px] leading-[1.05] font-bold tracking-[-0.04em] text-white md:text-[48px]">
                {title}
              </h1>
              {meta && <div className="flex flex-wrap items-center gap-3">{meta}</div>}
            </div>
            {(identifier || subtitle) && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-base text-sidebar-fg">
                {identifier && <p className="font-mono text-[13px]">{identifier}</p>}
                {subtitle && <p>{subtitle}</p>}
              </div>
            )}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
        {band}
      </header>
      <div aria-hidden className="-mt-7 -mb-1 h-8 rounded-t-[28px] bg-surface" />
    </div>
  );
}
