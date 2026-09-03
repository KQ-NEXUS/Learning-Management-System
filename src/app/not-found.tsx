import Link from "next/link";

/**
 * The repository's root 404 (a carried gap in STATE.md until now).
 *
 * It reveals nothing about WHY: the same page serves "no such page", "no such
 * course", "that course is not publicly listed" and "that course is archived"
 * (T-04-68). Next renders this with an HTTP 404 status.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-mono text-xs tracking-widest text-zinc-400">404</p>
      <h1 className="text-xl font-semibold tracking-tight">Page not found</h1>
      <p className="max-w-prose text-sm text-zinc-600">
        The page you asked for does not exist, or is not available.
      </p>
      <Link
        href="/"
        className="border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-zinc-50"
      >
        Go to the home page
      </Link>
    </main>
  );
}
