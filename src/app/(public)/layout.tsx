import { getCurrentActor } from "@/server/auth/current-actor";
import { landingPathFor } from "@/server/auth/landing";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { MAIN_CONTENT_ID, SkipLink } from "@/components/shell/SkipLink";

/**
 * The public catalogue shell in the IETC look: the white site header, the page, and the
 * black site footer (design/mockups/public-courses.html). Deliberately guard-free — no
 * redirect anywhere in this file — the catalogue must stay reachable without a session. It
 * does look up the actor, but only to choose the header's right side: a visitor sees Sign in
 * and Register; someone already signed in sees one link to their own home instead.
 */
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const actor = await getCurrentActor();
  const account = actor
    ? { href: landingPathFor(actor), label: actor.isStaff ? "Open workspace" : "My dashboard" }
    : null;

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-ground">
      <SkipLink />
      <SiteHeader account={account} />
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="w-full flex-1 px-5 pb-[72px] focus:outline-none md:px-14">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
