import { BRAND } from "@/lib/brand";
import { VerifyReferenceForm } from "./VerifyReferenceForm";

/**
 * The top of both certificate-check pages (design/mockups/public-verify-certificate.html):
 * the title, the reference form and what a check discloses, beside a drawing of where the
 * reference sits on a certificate.
 */
export function VerifyTop({ reference = "" }: { reference?: string }) {
  return (
    <section className="grid items-start gap-8 pt-8 md:grid-cols-[minmax(0,1fr)_420px] md:gap-[72px] md:pt-12">
      <div>
        <h1 className="ietc-display text-[clamp(38px,4.4vw,64px)]">Verify a certificate</h1>
        <p className="mt-3 max-w-[58ch] text-[17px] text-ink-soft md:text-[18.5px]">
          Enter the verification reference from a certificate to check whether it&apos;s valid.
        </p>
        <VerifyReferenceForm initialValue={reference} />
        <p className="mt-3.5 max-w-[56ch] text-[14.5px] text-ink-soft">
          A check shows only the learner&apos;s name, the award and the date it was issued. Nothing else about the learner is
          disclosed.
        </p>
      </div>
      <aside className="rounded-[18px] bg-paper p-[22px]">
        <svg viewBox="0 0 376 240" role="img" aria-label="A certificate with the verification reference printed along the bottom edge" className="mb-3.5 block h-auto w-full">
          <rect x="1" y="1" width="374" height="238" rx="10" className="fill-paper stroke-rule" strokeWidth="2" />
          <rect x="24" y="28" width="150" height="14" rx="7" className="fill-ink" />
          <rect x="24" y="58" width="250" height="9" rx="4.5" className="fill-rule" />
          <rect x="24" y="76" width="200" height="9" rx="4.5" className="fill-rule" />
          <rect x="24" y="112" width="210" height="20" rx="6" className="fill-tint-4" />
          <rect x="24" y="146" width="120" height="9" rx="4.5" className="fill-rule" />
          <circle cx="318" cy="70" r="28" className="fill-peach" />
          <path d="m306 70 9 9 16-18" fill="none" className="stroke-ink" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="16" y="186" width="344" height="36" rx="8" className="fill-orange" />
          <text x="188" y="210" textAnchor="middle" fontFamily="Archivo, sans-serif" fontWeight="800" fontSize="16" letterSpacing="1.5" className="fill-ink">
            CERT-7F3A-91C2-04B8-E6D5
          </text>
        </svg>
        <b className="font-bold">Where to find the reference</b>
        <p className="mt-1 text-[14.5px] text-ink-soft">
          It is printed along the bottom edge of every {BRAND.shortName} certificate and begins with CERT.
        </p>
      </aside>
    </section>
  );
}
