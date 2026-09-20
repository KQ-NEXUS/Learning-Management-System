import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

/**
 * LearnerPageHeader — the page title, drawn in the navy band of the learner shell.
 *
 * The learner shell is a navy top bar over a white, rounded-top sheet whose content is
 * centred in a 1120px column. This header pulls itself up out of that column (negative top
 * margin cancels the column's top padding), spans the full viewport width in navy, keeps its
 * text aligned to the same 1120px column, and finishes with a white cap that overlaps the
 * band's bottom edge so the sheet's rounded corners land below the title.
 *
 * Hook-free, so it renders on the server and the h1 is in the initial HTML. It must be the
 * first rendered element inside the shell's <main>.
 */
export type LearnerPageHeaderProps = {
  title: string;
  subtitle?: ReactNode;
  /** A single "go back" link shown above the title. */
  back?: { label: string; href: string };
  actions?: ReactNode;
  /** Catalogue pages draw a bigger headline than the working pages ("hero": 56px, "display": 66px). */
  size?: "default" | "hero" | "display";
  /** Extra content under the title, still on the navy band (e.g. the course facts strip). */
  band?: ReactNode;
};

const H1_SIZE = {
  default: "text-[36px] md:text-[48px]",
  hero: "text-[40px] md:text-[56px]",
  display: "text-[44px] md:text-[66px]",
} as const;

export function LearnerPageHeader({ title, subtitle, back, actions, size = "default", band }: LearnerPageHeaderProps) {
  return (
    <div className="relative left-1/2 -mt-[41px] w-screen -translate-x-1/2">
      <div className="on-navy bg-sidebar-bg text-white">
        <div className="mx-auto flex max-w-[1168px] flex-col gap-3 px-6 pt-4 pb-[56px]">
          {back && (
            <Link
              href={back.href}
              className="inline-flex min-h-8 w-fit items-center gap-2 text-sm text-sidebar-soft hover:text-white"
            >
              <ArrowLeft aria-hidden className="size-4" />
              {back.label}
            </Link>
          )}
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div className="flex min-w-0 flex-col gap-2">
              <h1 className={`${H1_SIZE[size]} leading-[1.04] font-bold tracking-[-0.04em] break-words text-white`}>
                {title}
              </h1>
              {subtitle && (
                <p className={`max-w-[60ch] text-sidebar-fg ${size === "default" ? "text-base" : "text-[16px] md:text-[20px] md:leading-[1.6]"}`}>
                  {subtitle}
                </p>
              )}
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
          </div>
          {band && <div className="mt-6">{band}</div>}
        </div>
      </div>
      <div aria-hidden className="-mt-7 -mb-1 h-8 rounded-t-[28px] bg-surface" />
    </div>
  );
}
