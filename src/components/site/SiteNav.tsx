"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** The public header's desktop links; the one for the current section is underlined in orange. */
export function SiteNav({ nav }: { nav: ReadonlyArray<{ label: string; href: string }> }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="hidden gap-7 font-semibold text-ink-soft md:flex">
      {nav.map((item) => {
        const active = isActivePath(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={active ? "pb-[3px] text-ink shadow-[0_3px_0_var(--ietc-orange)]" : "hover:text-ink"}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function isActivePath(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}
