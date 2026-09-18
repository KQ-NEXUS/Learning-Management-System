"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FormField, TextInput } from "@/components/primitives/ResourceForm";

/**
 * The reference-entry form (CRD-04's "public certificate verification"
 * reading, taken literally beyond a deep-link-only surface — an employer
 * reading a reference off a printed certificate has a string, not a URL).
 * Rendered above the result card on `/verify/[verificationRef]`, so a
 * visitor who mistyped can correct it without navigating back.
 *
 * A bare `/verify` landing page (no reference yet in the URL) was the
 * planner's originally-flagged discretionary addition, but `/verify` is
 * already a live, shipped route — `(auth)/verify/page.tsx` (IAM-02 email
 * verification via `?token=`), linked from already-dispatched transactional
 * emails (`verification-service.ts`, `registration-service.ts`). Next.js
 * refuses two pages resolving to the same path, and relocating a live,
 * previously-validated auth flow is outside this plan's authority. This
 * component is kept standalone (not inlined into the result page) so a
 * future plan can add a landing page at a non-colliding path without
 * duplicating the form markup — see 11-06-SUMMARY.md.
 *
 * Performs no lookup itself — it only builds a path to the one real lookup
 * route, `/verify/[verificationRef]`, and navigates there. The value is
 * URL-encoded before it becomes a path segment; it is never read back from
 * `searchParams` anywhere in this route group, so there is exactly one
 * lookup path to reason about.
 */

const BTN_PRIMARY =
  "h-[38px] rounded-md bg-accent px-4 text-sm font-semibold text-accent-contrast shadow-[0_6px_18px_var(--accent-glow)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

export function VerifyReferenceForm() {
  const router = useRouter();
  const [value, setValue] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = value.trim();
    // A blank submission is a no-op — the `required` attribute below already
    // blocks it natively; this guard covers a programmatic submit too, so
    // `/verify/` is never reached with an empty path segment.
    if (trimmed.length === 0) return;
    router.push(`/verify/${encodeURIComponent(trimmed)}`);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-border bg-surface p-6 shadow-card"
    >
      <FormField name="verificationRef" label="Verification reference" required>
        {(fieldProps) => (
          <TextInput
            {...fieldProps}
            mono
            required
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="CERT-…"
          />
        )}
      </FormField>
      <button type="submit" className={BTN_PRIMARY}>
        Verify
      </button>
    </form>
  );
}
