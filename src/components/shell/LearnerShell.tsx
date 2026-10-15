"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Menu, X } from "lucide-react";
import { SiteBrand } from "@/components/site/SiteHeader";
import { MAIN_CONTENT_ID, SkipLink } from "@/components/shell/SkipLink";
import { BRAND } from "@/lib/brand";

/**
 * LearnerShell — the signed-in chrome for the learner area, `/account` and checkout
 * (IETC redesign, design/mockups/learner-dashboard.html).
 *
 * A white top bar with the IETC shield, the learner's links (the active one underlined in
 * orange), the caller's right slot (bell, avatar, Sign out), the content area and a quiet
 * footer. On a phone the links fold into a Menu panel. It owns chrome only: no actor lookup
 * and no redirect — each layout keeps its own guard.
 *
 * Chrome persistence: the bar and footer render outside `children`, so a loading or
 * erroring child route only ever swaps the content area.
 */

export type LearnerNavItem = { label: string; href: string };

type LearnerShellProps = {
  nav: LearnerNavItem[];
  /** Where the brand links. Defaults to the public catalogue; signed-in shells pass /dashboard. */
  homeHref?: string;
  rightSlot: ReactNode;
  /** Extra content at the end of the open phone menu, e.g. sign-in links hidden from the cramped header. */
  mobileMenuExtra?: ReactNode;
  children: ReactNode;
};

function isActiveNavItem(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function LearnerShell({ nav, rightSlot, mobileMenuExtra, children, homeHref = "/courses" }: LearnerShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  // Escape closes the phone menu and returns focus to the button that opened it.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        menuButtonRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // A route change closes the menu. Adjusted during render (React's documented pattern for
  // resetting state on a prop change) rather than in an effect.
  const [previousPathname, setPreviousPathname] = useState(pathname);
  if (previousPathname !== pathname) {
    setPreviousPathname(pathname);
    if (open) setOpen(false);
  }

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-ground">
      <SkipLink />
      <header className="relative z-30 flex items-center gap-3 border-b border-rule bg-paper px-5 py-3 sm:gap-6 md:px-14 md:py-4 lg:gap-10">
        <SiteBrand href={homeHref} />

        <nav aria-label="Main" className="hidden items-center gap-7 font-semibold text-ink-soft md:flex">
          {nav.map((item) => {
            const active = isActiveNavItem(pathname, item.href);
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

        <div className="ml-auto flex shrink-0 items-center gap-3 font-semibold md:gap-[18px]">
          {rightSlot}
          {/* No navigation (e.g. the root 404) means no menu to open. */}
          {nav.length > 0 && (
            <button
              type="button"
              ref={menuButtonRef}
              aria-expanded={open}
              aria-controls={menuId}
              onClick={() => setOpen((v) => !v)}
              className="inline-flex min-h-11 items-center gap-2 rounded-[10px] px-3.5 text-[15px] font-bold text-ink shadow-[inset_0_0_0_2px_var(--ietc-ink)] md:hidden"
            >
              {open ? <X aria-hidden className="size-[19px]" strokeWidth={2.3} /> : <Menu aria-hidden className="size-[19px]" strokeWidth={2.3} />}
              <span aria-hidden>{open ? "Close" : "Menu"}</span>
              <span className="sr-only">{open ? "Close navigation" : "Open navigation"}</span>
            </button>
          )}
        </div>

        {open && (
          <nav
            id={menuId}
            aria-label="Main"
            className="absolute inset-x-0 top-full flex flex-col border-b border-rule bg-paper px-5 pb-5 shadow-[0_16px_30px_-18px_rgba(0,0,0,0.3)] md:hidden"
          >
            {nav.map((item) => {
              const active = isActiveNavItem(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-12 items-center border-b border-rule text-[17px] font-semibold ${active ? "text-orange-text" : "text-ink"}`}
                >
                  {item.label}
                </Link>
              );
            })}
            {mobileMenuExtra && <div className="mt-4 flex flex-col gap-2.5">{mobileMenuExtra}</div>}
          </nav>
        )}
      </header>

      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="w-full flex-1 px-5 pb-12 focus:outline-none md:px-14 md:pb-16">
        {children}
      </main>

      <footer className="flex flex-col justify-between gap-4 border-t border-rule px-5 py-[22px] text-sm text-ink-soft md:flex-row md:px-14">
        <span>
          © {new Date().getFullYear()} {BRAND.name}
        </span>
        <span>
          <Link href="/support" className="hover:text-ink hover:underline hover:underline-offset-4">
            Get help
          </Link>{" "}
          ·{" "}
          <Link href="/policies/terms" className="hover:text-ink hover:underline hover:underline-offset-4">
            Policies
          </Link>{" "}
          · {BRAND.poweredBy}
        </span>
      </footer>
    </div>
  );
}
