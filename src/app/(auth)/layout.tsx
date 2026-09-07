import type { ReactNode } from "react";
import { BrandMark } from "@/components/shell/BrandMark";

/**
 * The split-panel auth shell shared by all six `(auth)` routes (D-21, D-22).
 *
 * Deliberately guard-free: every screen this wraps exists to be reached by
 * someone who is not signed in (sign-in, register, password recovery, email
 * verification), so — unlike `staff/layout.tsx` and `account/layout.tsx` —
 * this file must perform no actor lookup and no redirect. That asymmetry
 * mirrors `(public)/layout.tsx`'s guard-free shape and is load-bearing: a
 * guard here would lock a locked-out user out of the recovery flow
 * (RESEARCH.md Pitfall 5).
 *
 * All six page files used to repeat the same duplicated centred-column
 * wrapper class string verbatim; that wrapper is retired entirely in favour
 * of the split panel below, whose `<main>` landmark now owns the right
 * column's centred content in every one of the six routes.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <div className="flex w-full shrink-0 flex-col justify-between gap-8 bg-sidebar-bg p-12 md:w-[44%]">
        <div className="flex items-center gap-2">
          <BrandMark className="size-7" />
          <span className="text-sm font-semibold tracking-[-0.01em] text-sidebar-fg">
            KQ Nexus
          </span>
        </div>

        <div className="flex flex-col gap-4">
          <h2 className="max-w-[18ch] text-[28px] leading-[1.2] font-semibold tracking-[-0.03em] text-sidebar-fg">
            Professional training that an employer can verify.
          </h2>
          <p className="max-w-[38ch] text-sm leading-relaxed text-sidebar-muted">
            Every certificate carries a public verification link. No phone call, no letterhead.
          </p>
        </div>

        <span className="font-mono text-[11px] tracking-wide text-sidebar-muted">
          AFRICA/LAGOS
        </span>
      </div>

      <main className="flex flex-1 items-center justify-center bg-background p-8">
        <div className="flex w-full max-w-[378px] flex-col gap-5">{children}</div>
      </main>
    </div>
  );
}
