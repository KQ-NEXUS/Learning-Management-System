"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ChevronRight, Menu, Search } from "lucide-react";
import { BrandMark } from "@/components/shell/BrandMark";

/**
 * StaffShell — the client half of the staff workspace shell (D-19, D-20).
 *
 * `staff/layout.tsx` stays an async Server Component so the actor lookup and
 * its two redirects run before any of this ever mounts (RBAC-06 rendering
 * guard). This component owns only chrome: a 228px navy sidebar, a 48px
 * header bar with a section-level locator trail, and the content pane.
 *
 * Chrome persistence (UI-SPEC 8.17): the sidebar, header bar and identity
 * chip are rendered here, outside `children`. A loading or erroring child
 * route only ever swaps the content pane — there is no branch anywhere in
 * this file that replaces the sidebar or header bar.
 */

export type StaffNavItem = { label: string; href: string };

/** Only what the footer chip needs — never the full profile snapshot. */
export type StaffIdentity = { name: string; email: string } | null;

type StaffShellProps = {
  nav: StaffNavItem[];
  identity: StaffIdentity;
  signOut: ReactNode;
  children: ReactNode;
};

/**
 * Derives the chip's initials + display label.
 *
 * When a display name exists it wins outright. When it does not, initials
 * come from the email local-part (first char, uppercased, plus the first
 * char of a second `.`/`_`/`-`-delimited segment if one exists) and the
 * email itself fills the name slot — there is no role label available from
 * `Actor` or the profile snapshot, so that line is omitted entirely rather
 * than reserving its height (UI-SPEC 8.17 empty).
 */
function deriveIdentityDisplay(
  identity: StaffIdentity,
): { initials: string; label: string } | null {
  if (!identity) return null;
  const trimmedName = identity.name?.trim();
  if (trimmedName) {
    const words = trimmedName.split(/\s+/).filter(Boolean);
    const initials =
      words.length > 1
        ? `${words[0][0]}${words[1][0]}`.toUpperCase()
        : words[0].slice(0, 2).toUpperCase();
    return { initials, label: trimmedName };
  }
  const local = identity.email.split("@")[0] ?? "";
  const segments = local.split(/[._-]/).filter(Boolean);
  const initials = `${segments[0]?.[0] ?? ""}${segments[1]?.[0] ?? ""}`.toUpperCase();
  return { initials, label: identity.email };
}

function isActiveNavItem(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

const DESKTOP_QUERY = "(min-width: 1024px)";
function subscribeToViewport(onChange: () => void) {
  const media = window.matchMedia(DESKTOP_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
const getDesktopSnapshot = () => window.matchMedia(DESKTOP_QUERY).matches;
const getServerDesktopSnapshot = () => false;

export function StaffShell({ nav, identity, signOut, children }: StaffShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const desktop = useSyncExternalStore(subscribeToViewport, getDesktopSnapshot, getServerDesktopSnapshot);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const backgroundRef = useRef<HTMLDivElement>(null);
  const sidebarId = useId();
  const mobileOpen = open && !desktop;

  const [previousDesktop, setPreviousDesktop] = useState(desktop);
  if (previousDesktop !== desktop) {
    setPreviousDesktop(desktop);
    if (open) setOpen(false);
  }

  // Isolate only the content sibling, retaining its previous inert state.
  // Desktop transitions must never return focus to the CSS-hidden trigger.
  useEffect(() => {
    if (!mobileOpen) return;
    const sidebar = sidebarRef.current!;
    const background = backgroundRef.current!;
    const menuButton = menuButtonRef.current;
    const previousInert = background.getAttribute("inert");
    background.setAttribute("inert", "");
    const focusable = () => Array.from(sidebar.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ));
    (focusable()[0] ?? sidebar).focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      } else if (event.key === "Tab") {
        const items = focusable();
        const first = items[0] ?? sidebar;
        const last = items.at(-1) ?? sidebar;
        if (!sidebar.contains(document.activeElement) ||
          (event.shiftKey && document.activeElement === first) ||
          (!event.shiftKey && document.activeElement === last)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previousInert === null) background.removeAttribute("inert");
      else background.setAttribute("inert", previousInert);
      if (!window.matchMedia(DESKTOP_QUERY).matches) menuButton?.focus();
    };
  }, [mobileOpen]);

  useEffect(() => {
    if (!desktop && !mobileOpen && sidebarRef.current?.contains(document.activeElement)) {
      menuButtonRef.current?.focus();
    }
  }, [desktop, mobileOpen]);

  // A stale open drawer surviving a navigation would strand it over the new
  // screen, so every route change closes it. Adjusted during render (React's
  // documented pattern for resetting state on a prop change, using state
  // rather than a ref since refs may not be read during render) instead of
  // an effect, which would cascade an extra render after the browser paints.
  const [previousPathname, setPreviousPathname] = useState(pathname);
  if (previousPathname !== pathname) {
    setPreviousPathname(pathname);
    if (open) setOpen(false);
  }

  const currentNavItem = nav.find((item) => isActiveNavItem(pathname, item.href));
  const trailLabel = currentNavItem?.label ?? "Workspace";
  const display = deriveIdentityDisplay(identity);

  return (
    // No `overflow-x` clip on this row wrapper: `overflow-x: hidden` forces
    // `overflow-y` to compute to `auto`, turning it into a scroll container, and
    // the sidebar's `lg:sticky` would then anchor to this non-scrolling box
    // instead of the viewport — so it scrolled away with the page on tall
    // routes. Horizontal bleed is clipped on the content column instead.
    <div className="flex min-h-screen bg-surface-2">
      {mobileOpen && (
        <div
          aria-hidden
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-foreground/40 lg:hidden"
        />
      )}

      <aside
        ref={sidebarRef}
        id={sidebarId}
        tabIndex={-1}
        inert={!desktop && !mobileOpen}
        aria-hidden={!desktop && !mobileOpen ? true : undefined}
        aria-label="Workspace navigation"
        className={`fixed inset-y-0 left-0 z-40 flex w-[228px] shrink-0 flex-col overflow-y-auto bg-sidebar-bg pb-4 transition-transform duration-200 lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand block */}
        <div className="flex items-center gap-2 px-4 pt-4 pb-4">
          <BrandMark />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-base font-semibold text-sidebar-fg">
              KQ Nexus
            </span>
            <span className="truncate text-[11px] text-sidebar-muted">
              Admin workspace
            </span>
          </div>
        </div>

        {/* Decorative search chip — performs no search this phase (D-24
            search wiring is out of scope). Never focusable, never announced:
            a control that does nothing is a worse failure than no control. */}
        <div className="px-2 pb-4">
          <div
            aria-hidden
            className="flex items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/10 px-2 py-2"
          >
            <Search aria-hidden className="size-3.5 shrink-0 text-sidebar-muted" />
            <span className="flex-1 truncate text-sm text-sidebar-muted">Search</span>
            <span className="shrink-0 rounded-sm border border-sidebar-border px-1 font-mono text-[11px] text-sidebar-muted">
              ⌘K
            </span>
          </div>
        </div>

        <nav aria-label="Workspace" className="flex flex-1 flex-col gap-1 px-2">
          {nav.map((item) => {
            const active = isActiveNavItem(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                aria-current={active ? "page" : undefined}
                title={item.label}
                className={`flex min-w-0 items-center gap-2 rounded-sm px-2 py-2 text-sm ${
                  active
                    ? "bg-sidebar-accent font-semibold text-white"
                    : "font-normal text-sidebar-muted hover:text-sidebar-fg"
                }`}
              >
                <span
                  aria-hidden
                  className={`size-1.5 shrink-0 rounded-full ${
                    active ? "bg-pill-blue-dot" : "bg-sidebar-muted/50"
                  }`}
                />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Footer identity chip. */}
        <div className="mt-auto px-4 pt-4">
          <div
            className="flex items-center gap-2 border-t border-sidebar-border pt-4"
            aria-label={display ? undefined : "Signed in"}
          >
            <span
              aria-hidden
              className="flex size-[27px] shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-accent-contrast"
              style={{
                background:
                  "linear-gradient(140deg, var(--color-teal-fill), var(--color-teal-deep))",
              }}
            >
              {display?.initials ?? ""}
            </span>
            <span
              className="min-w-0 flex-1 truncate text-sm font-semibold text-sidebar-fg"
              title={display?.label ?? "Signed in"}
            >
              {display?.label ?? "Signed in"}
            </span>
          </div>
        </div>
      </aside>

      <div ref={backgroundRef} className="flex min-w-0 flex-1 flex-col overflow-x-hidden">
        <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border bg-surface px-6">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              ref={menuButtonRef}
              aria-expanded={mobileOpen}
              aria-controls={sidebarId}
              onClick={() => setOpen((v) => !v)}
              className="-ml-1.5 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-2 lg:hidden"
            >
              <Menu aria-hidden className="size-4" />
              <span className="sr-only">
                {open ? "Close navigation" : "Open navigation"}
              </span>
            </button>

            <div className="flex min-w-0 items-center gap-2 text-sm">
              <span className="shrink-0 text-muted-foreground">Admin workspace</span>
              <ChevronRight aria-hidden className="size-3 shrink-0 text-border" />
              <span
                className="min-w-0 truncate font-semibold text-foreground"
                title={trailLabel}
              >
                {trailLabel}
              </span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-4">
            <span className="font-mono text-[11px] text-muted-foreground">
              Africa/Lagos
            </span>
            {signOut}
          </div>
        </header>

        <main className="min-w-0 flex-1 bg-surface-2 px-6 pt-6 pb-8">{children}</main>
      </div>
    </div>
  );
}
