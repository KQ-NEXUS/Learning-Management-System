import type { ReactNode } from "react";
import { BrandMark } from "@/components/shell/BrandMark";

/**
 * The standalone `/verify` shell (CRD-04, UI-SPEC §0.1/§7.5).
 *
 * Deliberately NOT nested under `(public)`: that route group renders the
 * shared learner chrome with a catalogue nav and a "Sign in" CTA — the wrong
 * tone for a third party (an employer, a credential checker) landing
 * directly on a verification link with no interest in browsing the
 * catalogue.
 *
 * Minimal, guard-free chrome only: a brand mark for continuity with the rest
 * of the app, and nothing else — no nav, no "Sign in" link, no footer.
 * `--surface-2` ground + `--foreground` ink match UI-SPEC §5's "Dominant"
 * color role for this route, kept identical to `StaffShell`'s ground even
 * though this route renders outside every shell.
 */
export default function VerifyLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-surface-2">
      <header className="flex items-center gap-2 px-8 py-6">
        <BrandMark className="size-7" />
        <span className="text-sm font-semibold tracking-[-0.01em] text-foreground">
          KQ Nexus
        </span>
      </header>
      <main className="flex flex-1 flex-col items-center gap-8 px-4 pb-16">
        {children}
      </main>
    </div>
  );
}
