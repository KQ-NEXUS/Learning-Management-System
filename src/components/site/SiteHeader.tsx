import Image from "next/image";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { SiteMenu } from "./SiteMenu";
import { SiteNav } from "./SiteNav";

/**
 * The public header in the IETC look: the shield and name, three destinations, and the
 * sign-in pair (or one link home for someone already signed in). On a phone the links and
 * buttons fold into SiteMenu. Server component; only the menu toggle runs in the browser.
 */

export const SITE_NAV = [
  { label: "Courses", href: "/courses" },
  { label: "Programmes", href: "/programmes" },
  { label: "Verify a certificate", href: "/verify-certificate" },
] as const;

export type SiteAccount = { href: string; label: string } | null;

export function SiteBrand({ href = "/", tone = "ink" }: { href?: string; tone?: "ink" | "white" }) {
  return (
    <Link
      href={href}
      className={`inline-flex shrink-0 items-center gap-2 text-[15px] leading-[1.12] font-extrabold tracking-[-0.01em] ${tone === "white" ? "text-white" : "text-ink"}`}
    >
      <Image src={BRAND.logo.src} width={BRAND.logo.width} height={BRAND.logo.height} alt="" className="h-10 w-auto sm:h-[46px]" priority />
      <span>
        {BRAND.nameLines.map((line) => (
          <b key={line} className="block font-extrabold whitespace-nowrap">
            {line}
          </b>
        ))}
        <span className="sr-only">, home</span>
      </span>
    </Link>
  );
}

const BTN_INK = "inline-flex min-h-12 items-center justify-center rounded-[10px] bg-ink px-[22px] text-[15.5px] font-bold text-white hover:bg-ink-hover";

export function SiteHeader({ account }: { account: SiteAccount }) {
  return (
    <header className="relative z-30 flex items-center gap-10 border-b border-rule bg-paper px-5 py-3 md:px-14 md:py-4">
      <SiteBrand />
      <SiteNav nav={SITE_NAV} />
      <div className="ml-auto hidden items-center gap-[18px] font-semibold md:flex">
        {account ? (
          <Link href={account.href} className={BTN_INK}>
            {account.label}
          </Link>
        ) : (
          <>
            <Link href="/signin" className="hover:underline hover:underline-offset-4">
              Sign in
            </Link>
            <Link href="/register" className={BTN_INK}>
              Register
            </Link>
          </>
        )}
      </div>
      <SiteMenu nav={SITE_NAV} account={account} />
    </header>
  );
}
