"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActivePath } from "./SiteNav";
import { useEffect, useId, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import type { SiteAccount } from "./SiteHeader";

/**
 * The phone menu for SiteHeader: one "Menu" button that opens every header link in a
 * panel under the header. Escape closes it and puts focus back on the button; following a
 * link closes it too. Hidden from md up, where the links sit in the header itself.
 */
export function SiteMenu({
  nav,
  account,
}: {
  nav: ReadonlyArray<{ label: string; href: string }>;
  account: SiteAccount;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // A route change closes the menu (React's documented reset-on-prop-change pattern).
  const [previousPathname, setPreviousPathname] = useState(pathname);
  if (previousPathname !== pathname) {
    setPreviousPathname(pathname);
    if (open) setOpen(false);
  }
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const close = () => setOpen(false);
  const row = "flex min-h-12 items-center border-b border-rule text-[17px] font-semibold";

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="ml-auto inline-flex min-h-11 items-center gap-2 rounded-[10px] px-3.5 text-[15px] font-bold text-ink shadow-[inset_0_0_0_2px_var(--ietc-ink)] md:hidden"
      >
        {open ? <X aria-hidden className="size-[19px]" strokeWidth={2.3} /> : <Menu aria-hidden className="size-[19px]" strokeWidth={2.3} />}
        {open ? "Close" : "Menu"}
      </button>
      {open && (
        <nav
          id={panelId}
          aria-label="Main"
          className="absolute inset-x-0 top-full z-20 border-b border-rule bg-paper px-5 pb-5 shadow-ietc-card md:hidden"
        >
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={close}
              aria-current={isActivePath(pathname, item.href) ? "page" : undefined}
              className={`${row} aria-[current=page]:text-orange-text`}
            >
              {item.label}
            </Link>
          ))}
          <div className="mt-4 flex flex-col gap-2.5">
            {account ? (
              <Link href={account.href} onClick={close} className="inline-flex min-h-12 items-center justify-center rounded-[10px] bg-ink font-bold text-white">
                {account.label}
              </Link>
            ) : (
              <>
                <Link href="/register" onClick={close} className="inline-flex min-h-12 items-center justify-center rounded-[10px] bg-ink font-bold text-white">
                  Register
                </Link>
                <Link
                  href="/signin"
                  onClick={close}
                  className="inline-flex min-h-12 items-center justify-center rounded-[10px] font-bold text-ink shadow-[inset_0_0_0_2px_var(--ietc-ink)]"
                >
                  Sign in
                </Link>
              </>
            )}
          </div>
        </nav>
      )}
    </>
  );
}
