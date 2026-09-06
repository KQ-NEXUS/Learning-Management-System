import Link from "next/link";
import type { ComponentType, ReactNode } from "react";

/**
 * Shared content helpers for the six `(auth)` screens (D-21, D-22).
 *
 * `(auth)/layout.tsx` owns the split-panel chrome; these three pieces are
 * what each page renders as its own children, so no screen invents its own
 * heading block, icon chip or footer line. Keep all three usable
 * independently — a plain screen renders only `AuthTitle`, and only the two
 * icon-bearing states (the expired-link recovery panel and the email-change
 * success screen) render `AuthIconChip` (UI-SPEC 7.2/8.5).
 */

type IconTone = "danger" | "success";

const ICON_TONE_CLASSES: Record<IconTone, string> = {
  danger: "bg-danger-surface text-danger",
  success: "bg-pill-green-bg text-pill-green-ink",
};

export function AuthIconChip({
  icon: Icon,
  tone,
}: {
  /** A lucide-react icon component, imported by name at the call site. */
  icon: ComponentType<{ className?: string }>;
  tone: IconTone;
}) {
  return (
    <span
      aria-hidden
      className={`flex size-11 shrink-0 items-center justify-center rounded-md ${ICON_TONE_CLASSES[tone]}`}
    >
      <Icon className="size-5" />
    </span>
  );
}

export function AuthTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-[25px] font-semibold tracking-[-0.03em] text-foreground">{title}</h1>
      {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

export function AuthFooterLine({
  text,
  href,
  linkLabel,
}: {
  text: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <p className="text-center text-sm text-muted-foreground">
      {text}{" "}
      <Link href={href} className="font-semibold text-accent underline underline-offset-2">
        {linkLabel}
      </Link>
    </p>
  );
}
