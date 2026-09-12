import { notFound, redirect } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current-actor";
import { startCheckout, getCohortOfferPath } from "@/server/services/checkout-service";
import {
  CapacityExceededError,
  CohortClosedError,
  CohortNotFoundError,
} from "@/server/services/seat-accounting";

/**
 * The D-14 post-auth resumption target: the ONLY page an intent-cookie
 * redirect (`checkoutReturnPathFor`, plan 06-04 Task 1) ever points at. A
 * visitor who clicked Enroll while signed out lands back here, at this
 * cohort's id, the instant sign-in completes — register/verify/sign-in may
 * have spanned hours and a different tab, but the cohort selection itself
 * never left this URL's keeping.
 *
 * THIS IS THE ONE PAGE IN THE APPLICATION WHOSE GET HAS A SIDE EFFECT
 * (it takes a seat hold and creates an Order, exactly like `enrollAction`).
 * That is acceptable here, and only here, for three reasons — each one is
 * an invariant this file depends on, not an incidental fact:
 *
 *   1. It is reachable only via a server-issued `redirect()` — either from
 *      `enrollAction`/`signInAction`'s own redirects or from this page's own
 *      typed-refusal branches — never from anything a browser or crawler
 *      discovers on its own. Next.js only prefetches `<Link>` targets and
 *      same-origin navigations it can see in rendered HTML; a path that
 *      never appears in a `<Link href>` cannot be prefetched.
 *   2. NO RENDERED LINK MAY EVER TARGET THIS PATH. That is not a style
 *      preference, it is the property invariant (1) depends on — a grep
 *      gate (`tests/checkout-intent.integration.test.ts` companion check,
 *      and this plan's own acceptance criteria) asserts no `href` anywhere
 *      in `src/` contains `/enrol/`.
 *   3. The seat-hold service's supersede rule (plan 06-03) means a repeat
 *      visit — a reload, a second click of "Continue to sign in" from an old
 *      tab — releases the previous live hold and takes the new one inside
 *      the SAME transaction, net seat delta zero. Even a manual reload
 *      cannot oversell the cohort (T-06-23).
 */
export const dynamic = "force-dynamic";

export default async function EnrolResumptionPage({
  params,
}: {
  params: Promise<{ cohortId: string }>;
}) {
  const { cohortId } = await params;

  // The `(checkout)` layout already redirects an unauthenticated visitor to
  // /signin before this component ever renders — this is belt-and-braces,
  // not the security boundary (matching every other page/action in this
  // route group's own documented convention).
  const actor = await getCurrentActor();
  if (!actor) redirect("/signin");

  let orderId: string;
  try {
    ({ orderId } = await startCheckout(actor, cohortId));
  } catch (err) {
    // A guessed/stale id that never existed: the 404 page, not an error
    // boundary and not a redirect that would imply the id once meant
    // something.
    if (err instanceof CohortNotFoundError) notFound();
    // Filled up or no longer accepting enrolments since the visitor first
    // clicked Enroll: send them back to the cohort's own public offer page
    // (or the catalogue index if that page can't be resolved), never an
    // error boundary that would confirm anything about why.
    if (err instanceof CapacityExceededError || err instanceof CohortClosedError) {
      redirect(await getCohortOfferPath(cohortId));
    }
    throw err;
  }

  redirect(`/checkout/${orderId}`);
}
