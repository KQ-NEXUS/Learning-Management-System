import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { getCurrentActor } from "@/server/auth/current-actor";
import { landingPathFor } from "@/server/auth/landing";
import { listPublicCourses } from "@/server/services/public-catalogue-service";
import { BRAND, LANDING } from "@/lib/brand";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { CourseCard } from "@/components/site/CourseCard";
import { VerifyStrip } from "@/components/site/VerifyStrip";
import { MAIN_CONTENT_ID, SkipLink } from "@/components/shell/SkipLink";

/**
 * The landing page (IETC redesign, design/mockups/public-landing.html). A visitor sees
 * what IETC teaches, the next dated classes, how a class works and a certificate check.
 * Someone already signed in goes straight to their own home, as before this page existed.
 */

export const metadata = {
  title: { absolute: BRAND.name },
  description: LANDING.heroBody,
};

const NEXT_CLASSES = 4;

const BTN = "inline-flex min-h-12 items-center justify-center gap-2.5 rounded-[10px] px-[22px] text-[15.5px] font-bold";

export default async function Landing() {
  const actor = await getCurrentActor();
  if (actor) redirect(landingPathFor(actor));

  const courses = await listPublicCourses();
  // Soonest dated class first; courses without a date are not "next classes".
  const next = courses
    .filter((course) => course.nextCohort !== null)
    .sort((a, b) => a.nextCohort!.startsAt.getTime() - b.nextCohort!.startsAt.getTime())
    .slice(0, NEXT_CLASSES);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SkipLink />
      <SiteHeader account={null} />
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex-1 focus:outline-none">
        <section className="grid items-end gap-[26px] px-5 pt-7 md:grid-cols-[1fr_400px] md:gap-14 md:px-14 md:pt-10">
          <div>
            <h1 className="ietc-display text-[clamp(42px,5.2vw,74px)]">
              {LANDING.heroLead} <span className="text-orange-text">{LANDING.heroHighlight}</span>
            </h1>
            <p className="mt-[18px] max-w-[58ch] text-[17px] text-ink-soft md:text-[18.5px]">{LANDING.heroBody}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/courses" className={`${BTN} bg-ink text-white hover:bg-ink-hover`}>
                Browse courses <ArrowRight aria-hidden className="size-[19px]" strokeWidth={2.3} />
              </Link>
              <Link href="/verify-certificate" className={`${BTN} text-ink shadow-[inset_0_0_0_2px_var(--ietc-ink)] hover:bg-ink/5`}>
                Verify a certificate
              </Link>
            </div>
          </div>
          <div className="grid grid-cols-[76px_1fr] items-center gap-4 rounded-[18px] bg-paper px-[22px] py-5">
            <Image
              src={BRAND.accreditation.seal.src}
              width={BRAND.accreditation.seal.width}
              height={BRAND.accreditation.seal.height}
              alt={BRAND.accreditation.seal.alt}
              className="w-[76px]"
            />
            <div>
              <b className="block font-bold">{BRAND.accreditation.title}</b>
              <span className="block text-sm text-ink-soft">{BRAND.accreditation.body}</span>
              <span className="mt-2 block text-sm text-ink-soft">{BRAND.accreditation.note}</span>
            </div>
          </div>
        </section>

        <section aria-labelledby="next-classes" className="px-5 pt-[34px] md:px-14">
          <div className="mb-3.5 flex items-baseline justify-between gap-4">
            <h2 id="next-classes" className="ietc-display text-[25px] leading-none md:text-[28px]">
              Next classes
            </h2>
            <Link href="/courses" className="font-bold underline underline-offset-4 hover:text-orange-text">
              All {courses.length} {courses.length === 1 ? "course" : "courses"}
            </Link>
          </div>
          {next.length > 0 ? (
            <div className="grid gap-[18px] sm:grid-cols-2 lg:grid-cols-4">
              {next.map((course) => (
                <CourseCard key={course.slug} course={course} />
              ))}
            </div>
          ) : (
            <p className="rounded-[18px] bg-paper px-[22px] py-5 text-ink-soft">
              New class dates are being set. <Link href="/courses" className="font-bold text-ink underline underline-offset-4">See every course</Link> and what it covers.
            </p>
          )}
        </section>

        <section aria-labelledby="how-it-works" className="px-5 pt-[72px] md:px-14">
          <h2 id="how-it-works" className="ietc-display text-[25px] leading-none md:text-[28px]">
            How a class works
          </h2>
          <ol className="mt-[18px] grid border-t-2 border-ink md:grid-cols-4">
            {LANDING.steps.map((step, i) => (
              <li
                key={step.title}
                className="grid grid-cols-[56px_1fr] gap-x-2 border-b border-rule py-[18px] md:mr-6 md:block md:border-r md:border-b-0 md:pt-5 md:pr-6 md:pb-0 md:last:mr-0 md:last:border-r-0"
              >
                <span aria-hidden className="ietc-display row-span-2 block text-[48px] leading-none text-orange md:text-[64px]">
                  {i + 1}
                </span>
                <b className="block text-[18px] font-bold md:mt-2.5 md:mb-1">{step.title}</b>
                <span className="text-ink-soft">{step.body}</span>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="verify" className="mt-[72px] bg-ink py-12 text-white">
          <div className="grid items-center gap-[22px] px-5 md:grid-cols-[1fr_520px] md:gap-14 md:px-14">
            <div>
              <h2 id="verify" className="ietc-display text-[clamp(34px,3.6vw,52px)]">
                {LANDING.verifyTitle}
              </h2>
              <p className="mt-3 max-w-[46ch] text-on-ink-soft">{LANDING.verifyBody}</p>
            </div>
            <VerifyStrip />
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
