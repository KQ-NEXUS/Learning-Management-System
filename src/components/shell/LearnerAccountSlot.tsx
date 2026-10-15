import type { ReactNode } from "react";

/**
 * The right-hand chrome slot shared by every signed-in learner shell (learner delivery,
 * account, checkout): the initials avatar plus a Sign out control, on the white top bar.
 *
 * `signOut` is the (auth)/signin sign-out Server Action; it is passed in rather than
 * imported so this component carries no route-group coupling.
 */
export function LearnerAccountSlot({
  display,
  signOut,
}: {
  display: { initials: string; label: string } | null;
  signOut: () => void | Promise<void>;
}): ReactNode {
  return (
    <>
      <span
        role="img"
        aria-label={display ? `Signed in as ${display.label}` : "Signed in"}
        title={display?.label ?? "Signed in"}
        className="flex size-[38px] shrink-0 items-center justify-center rounded-full bg-ink text-[13px] font-extrabold tracking-[0.02em] text-white max-sm:hidden"
      >
        {display?.initials ?? ""}
      </span>
      <form action={signOut} className="max-md:hidden">
        <button type="submit" className="min-h-10 font-semibold text-ink hover:underline hover:underline-offset-4">
          Sign out
        </button>
      </form>
    </>
  );
}

/** Sign out at the foot of the phone menu, where the header has no room for it. */
export function PhoneMenuSignOut({ signOut }: { signOut: () => void | Promise<void> }): ReactNode {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className="inline-flex min-h-12 w-full items-center justify-center rounded-[10px] font-bold text-ink shadow-[inset_0_0_0_2px_var(--ietc-ink)]"
      >
        Sign out
      </button>
    </form>
  );
}
