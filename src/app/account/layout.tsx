import { redirect } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current-actor";
import { signOutAction } from "@/app/(auth)/signin/actions";

/**
 * The Learner account shell — not `staff/layout.tsx`'s sidebar workspace.
 * A Learner has no `Assignment`-based grants to check, just "is this their
 * own record" (profile-service.ts's ownership model), so this guard checks
 * only that a session exists, with no `isStaff` requirement.
 *
 * Convenience only. The server action's own actor resolution is the
 * security boundary — a layout guard protects rendering, not data.
 */
export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const actor = await getCurrentActor();
  if (!actor) redirect("/signin");

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div className="flex justify-end">
        <form action={signOutAction}>
          <button
            type="submit"
            className="text-xs text-zinc-600 underline underline-offset-2 hover:text-zinc-900"
          >
            Sign out
          </button>
        </form>
      </div>
      {children}
    </main>
  );
}
