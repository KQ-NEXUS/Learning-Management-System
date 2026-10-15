import Link from "next/link";
import { ShieldAlert, TriangleAlert } from "lucide-react";

/**
 * Persistent Administrator banner (Phase 14, plan 14-19; D-15, UI-SPEC "Persistent banner (shell)").
 *
 * Presentational and hook-free so the staff layout (a Server Component) can build it and
 * hand it to `StaffShell` as a node. It is a tinted strip (amber for a warning, red for a
 * restriction) between the top bar and `<main>`. Colour is never the only signal: the state
 * label is always text. Not dismissible, no animation.
 */

export type LicenceBannerProps = {
  tone: "warning" | "danger";
  stateLabel: string;
  message: string;
  linkLabel: string;
  href: string;
};

export function LicenceBanner({ tone, stateLabel, message, linkLabel, href }: LicenceBannerProps) {
  const Icon = tone === "danger" ? ShieldAlert : TriangleAlert;
  return (
    <div
      role="status"
      id="licence-restriction-notice"
      className={`flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2.5 md:px-14 ${tone === "danger" ? "bg-danger-surface text-pill-red-ink" : "bg-warning-surface text-pill-amber-ink"}`}
    >
      <span
        data-tone={tone}
        className="flex shrink-0 items-center gap-2 font-bold"
      >
        <Icon aria-hidden className={`size-5 shrink-0 ${tone === "danger" ? "text-danger" : "text-warning"}`} />
        {stateLabel}
      </span>
      <p className="min-w-0 flex-1 basis-64 text-[15px]">{message}</p>
      <Link
        href={href}
        className="inline-flex min-h-11 w-full items-center font-bold underline underline-offset-4 sm:w-auto"
      >
        {linkLabel}
      </Link>
    </div>
  );
}
