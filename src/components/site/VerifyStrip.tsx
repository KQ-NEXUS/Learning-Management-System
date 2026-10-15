"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

/**
 * The certificate check on the black landing strip. Like VerifyReferenceForm it performs
 * no lookup: it only navigates to the one lookup route, /verify/[verificationRef], with the
 * reference URL-encoded as the path segment.
 */
export function VerifyStrip() {
  const router = useRouter();
  const [value, setValue] = useState("");

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reference = value.trim();
    if (reference.length === 0) return;
    router.push(`/verify/${encodeURIComponent(reference)}`);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2.5 sm:flex-row">
      <label htmlFor="landing-verify-ref" className="sr-only">
        Certificate reference
      </label>
      <input
        id="landing-verify-ref"
        name="verificationRef"
        required
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Certificate reference"
        autoComplete="off"
        className="min-h-[52px] min-w-0 flex-1 rounded-[10px] border-2 border-white bg-transparent px-4 text-base font-semibold text-white placeholder:text-on-ink-soft"
      />
      <button type="submit" className="inline-flex min-h-[52px] items-center justify-center rounded-[10px] bg-orange px-[22px] font-bold text-ink hover:brightness-95">
        Verify
      </button>
    </form>
  );
}
