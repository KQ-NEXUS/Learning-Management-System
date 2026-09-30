"use client";

import { useEffect, useState } from "react";
import { LearnerPageHeader } from "@/components/shell/LearnerPageHeader";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { GetSupportLink } from "@/components/support/GetSupportLink";

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
export function PollForPayment({ orderId }: { orderId: string }) {
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
          <LearnerPageHeader title="This is taking longer than usual" />
          <p className="max-w-prose text-base text-muted-foreground">
            Your payment may still be processing, and you won&apos;t be charged twice. Refresh this
            page in a minute. If it still hasn&apos;t updated, contact support and we&apos;ll check
            the payment for you.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={() => router.refresh()}
              className="inline-flex min-h-11 items-center rounded-md bg-accent px-5 text-sm font-semibold text-accent-contrast hover:bg-accent-deep"
            >
              Refresh
            </button>
            <GetSupportLink kind="ORDER" id={orderId} label="Contact support about this payment" />
          </div>
        </>
      ) : (
        <>
          <LearnerPageHeader title="Confirming your payment" />
          <p className="max-w-prose text-base text-muted-foreground">
            This usually takes a few seconds. Don&apos;t close this page.
          </p>
          <Loader2 aria-hidden className="size-8 animate-spin text-accent" />
        </>
      )}
    </>
  );
}
