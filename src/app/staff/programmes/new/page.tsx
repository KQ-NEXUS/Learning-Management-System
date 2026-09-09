import { notFound } from "next/navigation";
import { AuthenticationError, AuthorizationError, can } from "@/server/permissions";
import { ProgrammeForm } from "../ProgrammeForm";

export const metadata = { title: "New programme" };

export default async function NewProgrammePage() {
  // The action re-checks; this is the courtesy gate so the form is not offered
  // to someone who cannot submit it.
  let allowed: boolean;
  try {
    allowed = await can("programmes.manage", {});
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof AuthenticationError) notFound();
    throw error;
  }
  if (!allowed) notFound();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="font-mono text-[11px] text-muted-foreground">Staff · Programmes</p>
        <h1 className="text-lg font-semibold tracking-tight">New programme</h1>
      </div>
      <ProgrammeForm mode="create" />
    </div>
  );
}
