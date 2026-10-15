import { notFound } from "next/navigation";
import { DetailFacts, StatusPill } from "@/components/primitives";
import { PageHeader } from "@/components/shell/PageHeader";
import { SessionEnded } from "@/components/shell/SessionEnded";
import { LagosTime } from "@/components/time/LagosTime";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { ANONYMISE_POLICY } from "@/server/services/privacy-anonymise-service";
import { AnonymiseSection } from "./AnonymiseSection";
import { ExportSection } from "./ExportSection";
import {
  privacyReadService,
  type PrivacyAccountStatus,
  type PrivacyRecord,
} from "@/server/services/privacy-read-service";

/**
 * `/staff/privacy/[userId]` — one learner's privacy record (plan 15-22; D-12, NFR-11).
 *
 * The facts, the data export and the anonymise danger zone for one learner. An
 * unknown id, a staff account and a caller without `privacy.manage` all get the
 * standard 404, so a denial never confirms that an account exists. The record
 * and every action behind it are re-checked by the services on each request;
 * nothing here is a security control.
 */

export const metadata = { title: "Learner privacy" };
export const dynamic = "force-dynamic";

const STATUS: Record<PrivacyAccountStatus, { label: string; tone: "success" | "neutral" | "warning" }> = {
  ACTIVE: { label: "Active", tone: "success" },
  PENDING_VERIFICATION: { label: "Pending verification", tone: "neutral" },
  DEACTIVATED: { label: "Deactivated", tone: "warning" },
  ANONYMISED: { label: "Anonymised", tone: "neutral" },
};

const DASH = "—";

export default async function LearnerPrivacyRecordPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;

  let record: PrivacyRecord | null;
  try {
    record = await privacyReadService.getPrivacyRecord({ userId });
  } catch (error) {
    if (error instanceof AuthenticationError) return <SessionEnded />;
    // Same response as an unknown id (RBAC-06): a denial must not confirm the account exists.
    if (error instanceof AuthorizationError) notFound();
    throw error;
  }
  if (!record) notFound();

  const anonymised = record.accountStatus === "ANONYMISED";
  const title = anonymised ? "Anonymised learner" : record.name;
  const status = STATUS[record.accountStatus];

  return (
    <div className="flex flex-col">
      <PageHeader
        breadcrumbs={[{ label: "Learner privacy", href: "/staff/privacy" }, { label: title }]}
        title={title}
        identifier={record.learnerNumber ?? undefined}
        meta={<StatusPill label={status.label} tone={status.tone} />}
      />
      <div className="mt-4 flex max-w-[760px] flex-col gap-8 lg:gap-12">
        <section aria-labelledby="learner-details-heading" className="flex flex-col gap-4">
          <h2
            id="learner-details-heading"
            className="ietc-display text-[22px] leading-[1.05]"
          >
            Learner details
          </h2>
          <DetailFacts
            facts={[
              { label: "Name", value: <span className="break-words">{record.name || DASH}</span> },
              { label: "Email address", value: <span className="break-all">{record.email || DASH}</span> },
              { label: "Learner number", value: record.learnerNumber ?? DASH, mono: Boolean(record.learnerNumber) },
              { label: "Account status", value: status.label },
              { label: "Registered", value: <LagosTime value={record.registeredAt} /> },
              { label: "Enrolments", value: String(record.enrolmentCount) },
            ]}
          />
        </section>
        {!anonymised && (
          <ExportSection
            userId={record.userId}
            learnerName={record.name}
            exportStatus={{
              state: record.exportStatus.state,
              expiresAt: record.exportStatus.expiresAt ? record.exportStatus.expiresAt.toISOString() : null,
              canDownload: record.exportStatus.canDownload,
              downloadPath: record.exportStatus.downloadPath,
              inFlight: record.exportStatus.inFlight,
            }}
          />
        )}
        {/* Stays mounted across the post-anonymise refresh so its success note and focus survive; it draws the server's after-state itself. */}
        <AnonymiseSection
          userId={record.userId}
          learnerName={record.name}
          learnerEmail={record.email}
          policy={ANONYMISE_POLICY}
          anonymised={anonymised}
          anonymisedAt={record.anonymisedAt ? record.anonymisedAt.toISOString() : null}
          anonymisedByName={record.anonymisedByName}
        />
      </div>
    </div>
  );
}
