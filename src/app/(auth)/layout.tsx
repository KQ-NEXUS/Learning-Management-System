import Link from "next/link";
import type { ReactNode } from "react";
import { SiteBrand } from "@/components/site/SiteHeader";
import { BRAND } from "@/lib/brand";

/**
 * The sign-in area shell shared by all six `(auth)` routes (IETC redesign,
 * design/mockups/auth-signin.html): a black IETC panel that says who IETC is, and the form
 * beside it. On a phone the panel shortens to the brand, the headline and the verify link.
 *
 * Deliberately guard-free: every screen this wraps exists to be reached by someone who is
 * not signed in (sign-in, register, password recovery, email verification), so this file
 * performs no actor lookup and no redirect. A guard here would lock a locked-out user out
 * of the recovery flow (RESEARCH.md Pitfall 5).
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen bg-ground md:grid-cols-[44%_1fr]">
      <header className="flex flex-col justify-between gap-[22px] bg-ink px-5 pt-[22px] pb-[26px] text-white md:gap-10 md:px-14 md:py-11">
        <SiteBrand tone="white" />
        <div>
          <p className="ietc-display max-w-none text-[32px] md:max-w-[12ch] md:text-[clamp(38px,4.4vw,64px)]">
            Professional training that an employer can <span className="text-orange">verify.</span>
          </p>
          <p className="mt-4 hidden max-w-[40ch] text-on-ink-soft md:block">
            Every {BRAND.shortName} certificate carries a public verification reference. No phone call, no letterhead.
          </p>
          <Link href="/verify-certificate" className="mt-3 inline-block font-bold underline underline-offset-4 hover:text-orange md:mt-[18px]">
            Verify a certificate
          </Link>
        </div>
        <span className="hidden text-sm font-semibold text-on-ink-soft md:inline">Lekki, Lagos · {BRAND.accreditation.title}, New Jersey, USA</span>
      </header>

      <main className="flex items-start justify-center px-5 pt-8 pb-12 md:items-center md:px-8 md:py-12">
        <div className="flex w-full max-w-[400px] flex-col gap-5">{children}</div>
      </main>
    </div>
  );
}
