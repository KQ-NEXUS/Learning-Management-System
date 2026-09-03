import Link from "next/link";

/**
 * The public-segment 404. Same properties as the root one — it reveals nothing
 * about why a slug did not resolve, so an unlisted, an archived and a
 * never-existed course are indistinguishable (T-04-68) — with the public
 * navigation instead of the bare shell.
 */
export default function PublicNotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-mono text-xs tracking-widest text-zinc-400">404</p>
      <h1 className="text-xl font-semibold tracking-tight">Page not found</h1>
      <p className="max-w-prose text-sm text-zinc-600">
        We could not find that page. It may have been removed, or it may never have existed.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Link
          href="/courses"
          className="border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-zinc-50"
        >
          Browse courses
        </Link>
        <Link
          href="/programmes"
          className="border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-zinc-50"
        >
          Browse programmes
        </Link>
      </div>
    </main>
  );
}
