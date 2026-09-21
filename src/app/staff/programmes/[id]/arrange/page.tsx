import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/PageHeader";
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
        <PageHeader
          title={`${composition.title} — courses`}
          identifier={composition.slug}
          actions={
            <GuardedLink
              href={`/staff/programmes/${id}`}
              className="inline-flex min-h-10 items-center rounded-md border border-sidebar-line px-4 text-sm font-semibold text-white hover:bg-sidebar-hover"
            >
              Back to programme
            </GuardedLink>
          }
        />

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
