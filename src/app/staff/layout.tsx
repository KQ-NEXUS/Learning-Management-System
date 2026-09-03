import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/server/auth/current-actor";
import { signOutAction } from "@/app/(auth)/signin/actions";

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
  { label: "Cohorts", href: null },
  { label: "Courses", href: "/staff/courses" },
  { label: "Programmes", href: "/staff/programmes" },
  { label: "Enrolments", href: null },
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
  // a layout guard protects rendering, not data (RBAC-06).
  const actor = await getCurrentActor();
  if (!actor) redirect("/signin");

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
