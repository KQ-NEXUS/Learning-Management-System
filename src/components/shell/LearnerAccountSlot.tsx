import type { ReactNode } from "react";

/**
 * The right-hand chrome slot shared by every signed-in learner shell (learner
 * delivery, account, checkout): the initials avatar plus a Sign out control.
 * Written for the navy header band, so the avatar is a flat translucent chip
 * and Sign out uses the soft-on-navy text tone.
 *
 * `signOut` is the (auth)/signin sign-out Server Action; it is passed in rather
 * than imported so this component carries no route-group coupling.
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
        className="flex size-[32px] shrink-0 items-center justify-center rounded-full bg-sidebar-line text-[12px] font-semibold text-white"
      >
        {display?.initials ?? ""}
      </span>
      <form action={signOut}>
        <button
          type="submit"
          className="rounded-md px-2 py-2 text-sm font-medium text-sidebar-soft hover:text-white"
        >
          Sign out
        </button>
      </form>
    </>
  );
}
