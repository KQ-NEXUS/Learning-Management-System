/**
 * Helpers for the "framework control flow passes through" cases (WR-02,
 * 04.1-REVIEW-2, folded into plan 15-08).
 *
 * Next.js implements `redirect()` / `notFound()` by throwing an error with a
 * special `digest`. A client handler that catches an awaited Server Action's
 * rejection must hand that error back with `unstable_rethrow` instead of
 * turning it into a generic "try again" message.
 *
 * When a handler rethrows from a React event handler, nothing awaits it, so the
 * error surfaces as an unhandled promise rejection — that IS the observable
 * "it propagated" outcome. `captureUnhandledRejection` swaps Vitest's own
 * listener out for the duration of one trigger, resolves with the rejection's
 * reason, and always restores Vitest's listener.
 */

import { vi } from "vitest";

/** A genuine Next.js redirect error, built by the real `redirect()`. */
export async function nextRedirectError(url = "/sign-in"): Promise<Error> {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  try {
    actual.redirect(url);
  } catch (error) {
    return error as Error;
  }
  throw new Error("redirect() did not throw");
}

/** A genuine Next.js not-found error, built by the real `notFound()`. */
export async function nextNotFoundError(): Promise<Error> {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  try {
    actual.notFound();
  } catch (error) {
    return error as Error;
  }
  throw new Error("notFound() did not throw");
}

type RejectionListener = (reason: unknown, promise: Promise<unknown>) => void;

/**
 * Runs `trigger` and resolves with the reason of the first unhandled promise
 * rejection it causes. Rejects if none arrives within `timeoutMs`.
 */
export async function captureUnhandledRejection(
  trigger: () => void,
  timeoutMs = 2000,
): Promise<unknown> {
  const saved = process.listeners("unhandledRejection") as RejectionListener[];
  process.removeAllListeners("unhandledRejection");
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("expected the handler to rethrow, but nothing propagated")),
        timeoutMs,
      );
      process.once("unhandledRejection", (reason) => {
        clearTimeout(timer);
        resolve(reason);
      });
      trigger();
    });
  } finally {
    process.removeAllListeners("unhandledRejection");
    for (const listener of saved) process.on("unhandledRejection", listener);
  }
}
