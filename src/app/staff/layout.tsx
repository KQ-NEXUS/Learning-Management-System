import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current-actor";
import { signOutAction } from "@/app/(auth)/signin/actions";
import { LEARNER_LANDING_PATH } from "@/server/auth/landing";

/**
 * The admin workspace shell.
 *
 * Sketched, not designed — the design spec labels it "not part of the
 * primitives". It exists so the primitives are judged at their real width,
 * with a sidebar taking 224px, rather than floating on a bare canvas.
 *
 * Nav items without a route yet are rendered as plain text rather than dead
 * links, so nothing promises a page that does not exist.
 */

const NAV = [
  { label: "Cohorts", href: "/staff/cohorts" },
  { label: "Courses", href: "/staff/courses" },
  { label: "Programmes", href: "/staff/programmes" },
  { label: "Roles", href: "/staff/roles" },
  { label: "Users", href: "/staff/users" },
  { label: "Audit", href: "/staff/audit" },
  { label: "Enrolments", href: "/staff/enrolments" },
  { label: "Assessment", href: null },
  { label: "Certificates", href: null },
  { label: "Support", href: null },
] as const;

export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Convenience only. The server action's own check is the security —
  // a layout guard protects rendering, not data (RBAC-06). The staffness
  // check below is the same kind of defence in depth: it only stops a
  // Learner from rendering a shell whose child components would throw
  // (D-18) — the root cause is the branched sign-in redirect (D-15).
  // G-03-7: the non-staff branch sends an already-authenticated actor to
  // their own landing path rather than /signin — the actor is signed in,
  // so sending them to sign-in reads as an unexpected sign-out, and they
  // would only re-authenticate into the same destination this branch can
  // send them to directly, never learning why they were bounced.
  const actor = await getCurrentActor();
  if (!actor) redirect("/signin");
  if (!actor.isStaff) redirect(LEARNER_LANDING_PATH);

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex flex-1 flex-col sm:flex-row">
        <aside className="shrink-0 border-b border-zinc-200 bg-zinc-50/60 sm:w-56 sm:border-r sm:border-b-0">
          <div className="px-4 py-3.5 text-sm font-semibold tracking-tight">
            Admin workspace
          </div>
          <nav aria-label="Workspace" className="flex flex-row gap-0 overflow-x-auto sm:flex-col">
            {NAV.map((item) =>
              item.href ? (
                <Link
                  key={item.label}
                  href={item.href}
                  className="border-l-2 border-transparent px-4 py-2 text-xs font-medium whitespace-nowrap text-zinc-700 hover:bg-zinc-100"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  key={item.label}
                  aria-disabled
                  title="Not built yet"
                  className="border-l-2 border-transparent px-4 py-2 text-xs whitespace-nowrap text-zinc-400"
                >
                  {item.label}
                </span>
              ),
            )}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between gap-4 border-b border-zinc-200 px-5 py-2.5">
            <span className="font-mono text-[11px] text-zinc-500">
              Africa/Lagos
            </span>
            <form action={signOutAction}>
              <button
                type="submit"
                className="text-xs text-zinc-600 underline underline-offset-2 hover:text-zinc-900"
              >
                Sign out
              </button>
            </form>
          </header>
          <main className="min-w-0 flex-1 px-5 py-5">{children}</main>
        </div>
      </div>
    </div>
  );
}
