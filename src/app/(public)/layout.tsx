import Link from "next/link";

/**
 * The public catalogue shell (plan 04-15). Read-only navigation only — D-10
 * scopes this phase to an index and a detail page; discovery and checkout hang
 * off these routes in Phase 6.
 */
export default function PublicLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-zinc-200">
        <div className="mx-auto flex max-w-4xl items-center gap-6 px-6 py-3">
          <Link href="/courses" className="text-sm font-semibold tracking-tight">
            Training catalogue
          </Link>
          <nav className="flex gap-4 text-sm">
            <Link href="/courses" className="text-zinc-600 hover:text-zinc-900">
              Courses
            </Link>
            <Link href="/programmes" className="text-zinc-600 hover:text-zinc-900">
              Programmes
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
