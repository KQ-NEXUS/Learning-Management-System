"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The confirming interstitial's backstop (D-05, UI-SPEC 6.1/7.3, section 8's
 * explicitly-flagged backstop row). After roughly two minutes of polling
 * with no `PAID`/`EXCEPTION` transition, stop calling `router.refresh()` and
 * show the fallback copy instead of spinning silently forever on a charge
 * the learner has already paid. Named and exported so a test can drive it
 * with fake timers rather than waiting two real minutes.
 */
export const CONFIRMING_TIMEOUT_MS = 120_000;

/** A couple of seconds — responsive enough to feel live, far below the
 *  fallback threshold above. */
const POLL_INTERVAL_MS = 2_500;

/**
 * Display-only polling. This component performs no fetch, no mutation, and
 * no navigation of its own — it only triggers `router.refresh()`, which
 * re-runs the wrapping server component's `getOwnOrder` read; THAT read
 * (never this component) decides when to redirect to the receipt. The
 * webhook is the only thing that ever changes the observed state.
 *
 * Renders the heading/body pair itself (not the wrapping page) because the
 * swap from "Confirming your payment" to the fallback copy is a CLIENT-side
 * decision (elapsed wall-clock time) — the server component has no way to
 * know that without a round trip, and the fallback must replace the
 * original copy in place, not stack a second message beneath it.
 *
 * The polite live region below is a separate, always-identical sr-only
 * string — never the visible heading itself — so it is announced
 * once on mount and never again: its own text never changes across a
 * `router.refresh()` re-render (unlike the visible heading, which swaps to
 * the fallback copy after the timeout), and this component's own identity
 * persists across `router.refresh()` calls (same position in the tree, no
 * remount), so the mount-triggered announcement never re-fires on a poll
 * tick (UI-SPEC 7.3).
 */
export function PollForPayment() {
  const router = useRouter();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (timedOut) return;
    const pollId = setInterval(() => router.refresh(), POLL_INTERVAL_MS);
    const timeoutId = setTimeout(() => {
      clearInterval(pollId);
      setTimedOut(true);
    }, CONFIRMING_TIMEOUT_MS);
    return () => {
      clearInterval(pollId);
      clearTimeout(timeoutId);
    };
  }, [router, timedOut]);

  return (
    <>
      <span aria-live="polite" className="sr-only">
        Confirming your payment
      </span>
      {timedOut ? (
        <>
          <h1 className="text-[16px] font-semibold leading-[1.3] text-foreground">
            This is taking longer than usual
          </h1>
          <p className="max-w-prose text-center text-sm text-muted-foreground">
            Your payment may still be processing. Refresh this page in a minute, or contact
            support below if it doesn&apos;t update.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-[16px] font-semibold leading-[1.3] text-foreground">
            Confirming your payment
          </h1>
          <p className="max-w-prose text-center text-sm text-muted-foreground">
            This usually takes a few seconds. Don&apos;t close this page.
          </p>
        </>
      )}
    </>
  );
}
