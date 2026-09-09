import { notFound } from "next/navigation";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import {
  loadProgrammeComposition,
  listAddableCourses,
} from "@/server/services/programme-service";
import { serialiseOrderToken } from "@/server/services/reorder-service";
import { UnsavedOrderProvider, GuardedLink } from "@/components/catalogue";
import { ProgrammeArrangeClient } from "./ProgrammeArrangeClient";

export const metadata = { title: "Arrange programme courses" };

export default async function ProgrammeArrangePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let composition: Awaited<ReturnType<typeof loadProgrammeComposition>>;
  let addable: Awaited<ReturnType<typeof listAddableCourses>>;
  try {
    composition = await loadProgrammeComposition(id);
    if (!composition) notFound();
    addable = await listAddableCourses(id);
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
      notFound();
    }
    throw error;
  }

  return (
    <UnsavedOrderProvider>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <p className="font-mono text-[11px] text-muted-foreground">{composition.slug}</p>
          <h1 className="text-lg font-semibold tracking-tight">
            {composition.title} — courses
          </h1>
          <GuardedLink
            href={`/staff/programmes/${id}`}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Back to programme
          </GuardedLink>
        </div>

        <ProgrammeArrangeClient
          key={JSON.stringify(composition.members.map((m) => m.membershipId))}
          programmeId={id}
          token={serialiseOrderToken(composition.updatedAt)}
          members={composition.members}
          addableCourses={addable}
        />
      </div>
    </UnsavedOrderProvider>
  );
}
