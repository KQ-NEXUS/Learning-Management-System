import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { SiteBrand, SITE_NAV } from "./SiteHeader";

/** The black public footer: who IETC is, where to go, the policies and how to get in touch. */

const POLICIES = [
  { label: "Terms of Service", href: "/policies/terms" },
  { label: "Refund and Cancellation Policy", href: "/policies/refund-cancellation" },
  { label: "Privacy Notice", href: "/policies/privacy" },
];

const LINK = "hover:text-white hover:underline hover:underline-offset-4";

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="ietc-display mb-3 text-[18px]">{title}</h2>
      <ul className="flex flex-col gap-2 text-on-ink-soft">{children}</ul>
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line-on-ink bg-ink px-5 pt-11 pb-7 text-white md:px-14">
      <div className="grid gap-[26px] md:grid-cols-[1.4fr_1fr_1fr_1fr] md:gap-10">
        <div>
          <SiteBrand tone="white" />
          <p className="mt-3.5 max-w-[34ch] text-on-ink-soft">{BRAND.footerBlurb}</p>
        </div>
        <Column title="Learn">
          {SITE_NAV.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className={LINK}>
                {item.label}
              </Link>
            </li>
          ))}
        </Column>
        <Column title="Policies">
          {POLICIES.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className={LINK}>
                {item.label}
              </Link>
            </li>
          ))}
        </Column>
        <Column title="Contact">
          <li>{BRAND.contact.address}</li>
          {/* The number and address stay visible as text: a tel:/mailto: link is a convenience only. */}
          <li>
            <a href={BRAND.contact.phoneHref} className={LINK}>
              {BRAND.contact.phone}
            </a>
          </li>
          <li>
            <a href={`mailto:${BRAND.contact.email}`} className={LINK}>
              {BRAND.contact.email}
            </a>
          </li>
        </Column>
      </div>
      <div className="mt-9 flex flex-col justify-between gap-4 border-t border-line-on-ink pt-[18px] text-sm text-on-ink-soft md:flex-row">
        <span>
          © {new Date().getFullYear()} {BRAND.name}
        </span>
        <span>{BRAND.poweredBy}</span>
      </div>
    </footer>
  );
}
