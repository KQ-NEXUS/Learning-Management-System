import Link from "next/link";
import { listPublicProgrammes } from "@/server/services/public-catalogue-service";

export const revalidate = 300;
export const metadata = { title: "Programmes" };

export default async function PublicProgrammesPage() {
  const programmes = await listPublicProgrammes();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Programmes</h1>
      {programmes.length === 0 ? (
        <p className="text-sm text-zinc-600">No programmes are listed right now.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {programmes.map((programme) => (
            <li key={programme.slug} className="border border-zinc-200 p-4">
              <Link
                href={`/programmes/${programme.slug}`}
                className="text-lg font-medium text-accent underline underline-offset-2"
              >
                {programme.title}
              </Link>
              {programme.summary && (
                <p className="mt-1 max-w-prose text-sm text-zinc-600">{programme.summary}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
