import Link from "next/link";
import { ShieldAlert, TriangleAlert } from "lucide-react";

/**
 * Persistent Administrator banner (Phase 14, plan 14-19; D-15, UI-SPEC "Persistent banner (shell)").
 *
 * Presentational and hook-free so the staff layout (a Server Component) can build it and
 * hand it to `StaffShell` as a node. It sits on the navy frame between the header and
 * `<main>`; the state label and icon are one tone element so the existing
 * `.on-navy [data-tone]` rules colour them. Colour is never the only signal: the state
 * label is always text. Not dismissible, no animation, no new CSS.
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
      className="on-navy flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 border-b border-sidebar-line bg-sidebar-hover px-6 py-2 lg:px-8"
    >
      <span
        data-tone={tone}
        className="flex shrink-0 items-center gap-2 border-l-4 border-current pl-3 text-sm font-semibold"
      >
        <Icon aria-hidden className="size-5 shrink-0" />
        {stateLabel}
      </span>
      <p className="min-w-0 flex-1 basis-64 text-sm text-white">{message}</p>
      <Link
        href={href}
        className="inline-flex min-h-11 w-full items-center text-sm font-semibold text-white underline underline-offset-2 sm:w-auto"
      >
        {linkLabel}
      </Link>
    </div>
  );
}
