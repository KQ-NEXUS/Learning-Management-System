import { redirect } from "next/navigation";
import { LearnerPageHeader } from "@/components/shell/LearnerPageHeader";
import { getCurrentActor } from "@/server/auth/current-actor";
import {
  parseLearnerContextHint,
  validateLearnerTicketContext,
} from "@/server/services/ticket-learner-context-service";
import { NewTicketForm } from "./NewTicketForm";

export const dynamic = "force-dynamic";

/**
 * `/support/new` — the query string is only a hint; the record is resolved and
 * ownership-checked here so an invalid or foreign hint is silently dropped.
 */
export default async function NewTicketPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await getCurrentActor();
  if (!actor) redirect("/signin");

  const params = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const validated = await validateLearnerTicketContext(
    actor.userId,
    parseLearnerContextHint(first(params.contextKind), first(params.contextId)),
  );

  return (
    <div className="flex flex-col gap-6">
      <LearnerPageHeader
        title="Tell us what you need help with"
        back={{ label: "Back to support", href: "/support" }}
      />
      <NewTicketForm
        context={
          validated
            ? {
                kind: validated.kind,
                id: Object.values(validated.input)[0] as string,
                safeReference: validated.safeReference,
              }
            : null
        }
      />
    </div>
  );
}
