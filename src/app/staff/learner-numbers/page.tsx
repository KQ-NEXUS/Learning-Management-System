import { PageHeader } from "@/components/shell/PageHeader";
import { SessionEnded } from "@/components/shell/SessionEnded";
import { ResourceForm } from "@/components/primitives";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { getLearnerNumberSettings, type LearnerNumberSettings } from "@/server/services/learner-number-service";
import { LearnerNumberForm } from "./LearnerNumberForm";

/**
 * `/staff/learner-numbers` — how learner numbers are formed (owner decisions, 2026-10-04).
 *
 * The read is `users.manage` at GLOBAL scope, enforced in the service. A denial renders the shared
 * 403 notice; nothing about the current pattern or the counts is shown to someone who lacks it.
 */

export const metadata = { title: "Learner numbers" };
export const dynamic = "force-dynamic";

export default async function LearnerNumbersPage() {
  let settings: LearnerNumberSettings;
  try {
    settings = await getLearnerNumberSettings();
  } catch (error) {
    if (error instanceof AuthenticationError) return <SessionEnded />;
    if (error instanceof AuthorizationError) {
      return (
        <ResourceForm title="Learner numbers" state={{ status: "denied", permission: "users.manage" }}>
          {null}
        </ResourceForm>
      );
    }
    throw error;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Learner numbers"
        subtitle="A readable reference for each learner, issued in order when they register."
        breadcrumbs={[{ label: "Administration" }, { label: "Learner numbers" }]}
      />
      <LearnerNumberForm initial={settings} todayIso={new Date().toISOString()} />
    </div>
  );
}
