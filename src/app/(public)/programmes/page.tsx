import Link from "next/link";
import { listPublicProgrammes } from "@/server/services/public-catalogue-service";

// Rendered per request, never prerendered — the Docker builder has no
// DATABASE_URL (04-15 planner fallback; 04-10 `docker build` requirement).
export const dynamic = "force-dynamic";
export const metadata = { title: "Programmes" };

export default async function PublicProgrammesPage() {
  const programmes = await listPublicProgrammes();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[28px] font-semibold leading-tight">Programmes</h1>
      {programmes.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface px-6 py-10 text-sm text-muted-foreground shadow-card">
          No programmes are listed right now.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {programmes.map((programme) => (
            <li
              key={programme.slug}
              className="flex min-h-32 min-w-0 flex-col rounded-xl border border-border bg-surface p-5 shadow-card"
            >
              <Link
                href={`/programmes/${programme.slug}`}
                className="break-words text-sm font-semibold text-accent underline underline-offset-2"
              >
                {programme.title}
              </Link>
              {programme.summary && (
                <p className="mt-2 max-w-prose break-words text-sm text-muted-foreground">
                  {programme.summary}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
