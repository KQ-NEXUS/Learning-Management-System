"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Menu } from "lucide-react";
import { BrandMark } from "@/components/shell/BrandMark";

/**
 * LearnerShell — the shared chrome for the public catalogue and `/account`
 * (D-23, UI-SPEC 7.3).
 *
 * This component owns chrome only: the top bar, the brand mark, the nav with
 * its active-underline treatment, the caller-supplied right slot, and the
 * 1080px body container. It performs no actor lookup and no redirect — the
 * public route group has no guard at all and the account route group has
 * exactly one, and those guards live in each layout file
 * (`(public)/layout.tsx`, `account/layout.tsx`) rather than here. Folding
 * either guard into this shell would either lock anonymous visitors out of
 * the catalogue or render an account page for a signed-out visitor.
 *
 * Chrome persistence (UI-SPEC 8.18): the top bar is rendered here, outside
 * the `children` slot. A loading or erroring child route only ever swaps the
 * body container — there is no branch anywhere in this file that replaces
 * the top bar.
 */

export type LearnerNavItem = { label: string; href: string };

type LearnerShellProps = {
  nav: LearnerNavItem[];
  rightSlot: ReactNode;
  children: ReactNode;
};

function isActiveNavItem(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function LearnerShell({ nav, rightSlot, children }: LearnerShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  // Escape closes the collapsed nav menu and returns focus to the button
  // that opened it, so a keyboard user is never left without a focus target.
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

  // A stale open menu surviving a navigation would strand it over the new
  // screen, so every route change closes it. Adjusted during render (React's
  // documented pattern for resetting state on a prop change, using state
  // rather than a ref since refs may not be read during render) instead of
  // an effect, which would cascade an extra render after the browser paints.
  const [previousPathname, setPreviousPathname] = useState(pathname);
  if (previousPathname !== pathname) {
    setPreviousPathname(pathname);
    if (open) setOpen(false);
  }

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-surface-2">
      <header className="shrink-0 border-b border-border bg-surface">
        <div className="mx-auto flex max-w-[1080px] items-center justify-between gap-4 px-6 py-4">
          <div className="flex min-w-0 items-center gap-7">
            <Link href="/courses" className="flex shrink-0 items-center gap-2.5">
              <BrandMark />
              <span className="truncate text-sm font-semibold tracking-[-0.01em] text-foreground">
                KQ Nexus
              </span>
            </Link>

            <nav aria-label="Main" className="hidden items-center gap-5 text-sm sm:flex">
              {nav.map((item) => {
                const active = isActiveNavItem(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`border-b-2 pb-0.5 ${
                      active
                        ? "border-accent font-semibold text-foreground"
                        : "border-transparent font-normal text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            {rightSlot}
            <button
              type="button"
              ref={menuButtonRef}
              aria-expanded={open}
              aria-controls={menuId}
              onClick={() => setOpen((v) => !v)}
              className="-mr-1.5 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-2 sm:hidden"
            >
              <Menu aria-hidden className="size-4" />
              <span className="sr-only">
                {open ? "Close navigation" : "Open navigation"}
              </span>
            </button>
          </div>
        </div>

        {open && (
          <nav
            id={menuId}
            aria-label="Main"
            className="flex flex-col gap-0.5 border-t border-border px-6 py-3 sm:hidden"
          >
            {nav.map((item) => {
              const active = isActiveNavItem(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-md px-2 py-1.5 text-sm ${
                    active
                      ? "font-semibold text-foreground"
                      : "font-normal text-muted-foreground"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        )}
      </header>

      <main className="mx-auto w-full max-w-[1080px] flex-1 px-6 pt-8 pb-12">
        {children}
      </main>
    </div>
  );
}
