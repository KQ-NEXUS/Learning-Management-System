"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Menu, X } from "lucide-react";
import { SiteBrand } from "@/components/site/SiteHeader";
import { MAIN_CONTENT_ID, SkipLink } from "@/components/shell/SkipLink";
import { BRAND } from "@/lib/brand";
import {
  LicenceRestrictionProvider,
  UNRESTRICTED_LICENCE_RESTRICTION,
  type LicenceRestrictionValue,
} from "@/components/licence/LicenceRestrictionProvider";

/**
 * StaffShell — the client half of the staff workspace shell (IETC redesign,
 * design/mockups/staff-overview.html).
 *
 * `staff/layout.tsx` stays an async Server Component so the actor lookup and its two
 * redirects run before any of this mounts (RBAC-06 rendering guard). This component owns
 * only chrome: a white top bar with Overview and one menu per nav group, the bell, who is
 * signed in and Sign out; the licence banner; the content area; a quiet footer.
 *
 * On a phone (below lg) the groups fold into one Menu panel listing every link under its
 * group. Chrome persistence: header, banner and footer render outside `children`, so a
 * loading or erroring child route only ever swaps the content area.
 */

export type StaffNavItem = { label: string; href: string; group?: string };

/** Groups consecutive items that share a group label, preserving nav order. */
function groupNav(nav: StaffNavItem[]): { label: string | null; items: StaffNavItem[] }[] {
  const groups: { label: string | null; items: StaffNavItem[] }[] = [];
  for (const item of nav) {
    const label = item.group ?? null;
    const last = groups.at(-1);
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

/** Only what the header needs — never the full profile snapshot. */
export type StaffIdentity = { name: string; email: string } | null;

type StaffShellProps = {
  nav: StaffNavItem[];
  identity: StaffIdentity;
  signOut: ReactNode;
  /** The notification bell (D-18). Optional so existing callers/tests need no change. */
  bell?: ReactNode;
  /**
   * The persistent licence banner (D-15), rendered between the header and `<main>`.
   * Built by the layout for holders of licence.view only; absent for everyone else.
   */
  banner?: ReactNode;
  /** The licence restriction mirror (D-09). Optional: absent means unrestricted. */
  licenceRestriction?: LicenceRestrictionValue;
  children: ReactNode;
};

/**
 * The initials and full label for the signed-in chip. A display name wins; without one,
 * initials come from the email's local part and the email itself is the label.
 */
function deriveIdentityDisplay(identity: StaffIdentity): { initials: string; label: string } | null {
  if (!identity) return null;
  const trimmedName = identity.name?.trim();
  if (trimmedName) {
    const words = trimmedName.split(/\s+/).filter(Boolean);
    const initials = words.length > 1 ? `${words[0][0]}${words[1][0]}`.toUpperCase() : words[0].slice(0, 2).toUpperCase();
    return { initials, label: trimmedName };
  }
  const local = identity.email.split("@")[0] ?? "";
  const segments = local.split(/[._-]/).filter(Boolean);
  const initials = `${segments[0]?.[0] ?? ""}${segments[1]?.[0] ?? ""}`.toUpperCase();
  return { initials, label: identity.email };
}

function isActiveNavItem(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  // /staff is the overview: every other staff route starts with it, so it must match exactly.
  if (href === "/staff") return pathname === "/staff";
  return pathname === href || pathname.startsWith(`${href}/`);
}

const TOP_LINK =
  "inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 font-semibold text-ink-soft hover:bg-ground hover:text-ink aria-[current]:bg-ink aria-[current]:text-white";
const MENU_LINK = "block rounded-lg px-3 py-2.5 font-semibold text-ink hover:bg-ground aria-[current=page]:bg-peach";

export function StaffShell({ nav, identity, signOut, bell, banner, licenceRestriction, children }: StaffShellProps) {
  const pathname = usePathname();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const phoneButtonRef = useRef<HTMLButtonElement>(null);
  const groupButtons = useRef(new Map<string, HTMLButtonElement>());
  const phonePanelId = useId();
  const menuIdBase = useId();

  // Every navigation closes whatever menu is open. Adjusted during render (React's
  // documented pattern for resetting state on a prop change) rather than in an effect.
  const [previousPathname, setPreviousPathname] = useState(pathname);
  if (previousPathname !== pathname) {
    setPreviousPathname(pathname);
    if (openGroup !== null) setOpenGroup(null);
    if (phoneOpen) setPhoneOpen(false);
  }

  // A group menu closes on Escape (focus back to its button) or a press outside the nav.
  useEffect(() => {
    if (openGroup === null) return;
    const group = openGroup;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpenGroup(null);
      groupButtons.current.get(group)?.focus();
    }
    function onPointerDown(event: PointerEvent) {
      if (!navRef.current?.contains(event.target as Node)) setOpenGroup(null);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [openGroup]);

  // The phone panel closes on Escape and returns focus to the Menu button.
  useEffect(() => {
    if (!phoneOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setPhoneOpen(false);
      phoneButtonRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [phoneOpen]);

  const groups = groupNav(nav);
  const display = deriveIdentityDisplay(identity);

  return (
    // The provider (D-09) wraps the whole shell so the page content can read the licence restriction.
    <LicenceRestrictionProvider value={licenceRestriction ?? UNRESTRICTED_LICENCE_RESTRICTION}>
      <div className="flex min-h-screen flex-col bg-ground">
        <SkipLink />
        <header className="relative z-30 flex items-center gap-3 border-b border-rule bg-paper px-5 py-3 sm:gap-6 md:px-14 lg:gap-10 lg:py-4">
          <SiteBrand href="/staff" />

          <nav ref={navRef} aria-label="Workspace" className="hidden items-center gap-1.5 lg:flex">
            {groups.map((group) => {
              if (group.label === null) {
                return group.items.map((item) => (
                  <Link key={item.href} href={item.href} aria-current={isActiveNavItem(pathname, item.href) ? "page" : undefined} className={TOP_LINK}>
                    {item.label}
                  </Link>
                ));
              }
              const label = group.label;
              const holdsCurrent = group.items.some((item) => isActiveNavItem(pathname, item.href));
              const open = openGroup === label;
              const menuId = `${menuIdBase}-${label}`;
              return (
                <div key={label} className="relative">
                  <button
                    type="button"
                    ref={(node) => {
                      if (node) groupButtons.current.set(label, node);
                      else groupButtons.current.delete(label);
                    }}
                    aria-expanded={open}
                    aria-controls={menuId}
                    aria-current={holdsCurrent ? "true" : undefined}
                    onClick={() => setOpenGroup(open ? null : label)}
                    className={`${TOP_LINK} ${open && !holdsCurrent ? "bg-ground text-ink" : ""}`}
                  >
                    {label}
                    <ChevronDown aria-hidden className={`size-[15px] transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={2.3} />
                  </button>
                  {open && (
                    <div
                      id={menuId}
                      className="absolute top-[calc(100%+8px)] left-0 z-40 min-w-[220px] rounded-xl bg-paper p-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_16px_30px_-18px_rgba(0,0,0,0.3),0_0_0_1px_var(--ietc-rule)]"
                    >
                      {group.items.map((item) => (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setOpenGroup(null)}
                          aria-current={isActiveNavItem(pathname, item.href) ? "page" : undefined}
                          className={MENU_LINK}
                        >
                          {item.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3 lg:gap-[18px]">
            {bell}
            <span
              title={display ? `Signed in as ${display.label}` : "Signed in"}
              className="hidden size-[38px] shrink-0 items-center justify-center rounded-full bg-ink text-[13px] font-extrabold tracking-[0.02em] text-white sm:flex"
            >
              <span aria-hidden>{display?.initials ?? ""}</span>
              <span className="sr-only">Signed in as {display?.label ?? "a staff member"}</span>
            </span>
            <div className="hidden lg:block">{signOut}</div>
            <button
              ref={phoneButtonRef}
              type="button"
              aria-expanded={phoneOpen}
              aria-controls={phonePanelId}
              onClick={() => setPhoneOpen((v) => !v)}
              className="inline-flex min-h-11 items-center gap-2 rounded-[10px] px-3.5 text-[15px] font-bold text-ink shadow-[inset_0_0_0_2px_var(--ietc-ink)] lg:hidden"
            >
              {phoneOpen ? <X aria-hidden className="size-[19px]" strokeWidth={2.3} /> : <Menu aria-hidden className="size-[19px]" strokeWidth={2.3} />}
              {phoneOpen ? "Close" : "Menu"}
            </button>
          </div>

          {phoneOpen && (
            <nav
              id={phonePanelId}
              aria-label="Workspace"
              className="absolute inset-x-0 top-full max-h-[calc(100vh-72px)] overflow-y-auto border-b border-rule bg-paper px-5 pt-2 pb-5 shadow-[0_16px_30px_-18px_rgba(0,0,0,0.3)] md:px-14 lg:hidden"
            >
              {groups.map((group) => (
                <div key={group.label ?? "top"} className="py-1">
                  {group.label && <p className="px-3 pt-3 pb-1 text-sm font-bold text-ink-soft">{group.label}</p>}
                  {group.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setPhoneOpen(false)}
                      aria-current={isActiveNavItem(pathname, item.href) ? "page" : undefined}
                      className={MENU_LINK}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              ))}
              <div className="mt-2 border-t border-rule px-3 pt-3">{signOut}</div>
            </nav>
          )}
        </header>

        {banner}

        <main id={MAIN_CONTENT_ID} tabIndex={-1} className="min-w-0 flex-1 px-5 pb-16 focus:outline-none md:px-14">
          {children}
        </main>

        <footer className="mt-10 flex flex-col justify-between gap-4 border-t border-rule px-5 py-[22px] text-sm text-ink-soft md:flex-row md:px-14">
          <span>© {new Date().getFullYear()} {BRAND.name} · Admin workspace</span>
          <span>{BRAND.poweredBy}</span>
        </footer>
      </div>
    </LicenceRestrictionProvider>
  );
}
