import Link from "next/link";
import { notFound } from "next/navigation";
import { AuthenticationError, AuthorizationError, can } from "@/server/permissions";
import { programmeService, loadProgrammeComposition } from "@/server/services/programme-service";
import {
  loadProgrammeReadinessAggregate,
  getUnpublishedProgrammeChangeSummary,
} from "@/server/services/publish-service";
import { evaluateProgrammeReadiness } from "@/server/services/readiness-service";
import { blockingCohorts } from "@/server/services/catalogue-guards";
import { DetailLayout, DetailFacts, StatusPill } from "@/components/primitives";
import { ReadinessPanel } from "@/components/catalogue/ReadinessPanel";
import { ProgrammeDetailClient } from "./ProgrammeDetailClient";
import { ProgrammeForm } from "../ProgrammeForm";

type Programme = {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  outcomes: string | null;
  audience: string | null;
  sequential: boolean;
  status: string;
  contentVersion: number;
  publiclyListed: boolean;
  certificateEnabled: boolean;
};

const TONE: Record<string, "success" | "neutral" | "warning"> = {
  PUBLISHED: "success",
  DRAFT: "neutral",
  ARCHIVED: "warning",
};

export default async function ProgrammeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let programme: Programme | null;
  let composition: Awaited<ReturnType<typeof loadProgrammeComposition>>;
  let aggregate: Awaited<ReturnType<typeof loadProgrammeReadinessAggregate>>;
  let changeSummary: Awaited<ReturnType<typeof getUnpublishedProgrammeChangeSummary>>;
  try {
    programme = (await programmeService.get(id)) as unknown as Programme | null;
    if (!programme) notFound();
    composition = await loadProgrammeComposition(id);
    aggregate = await loadProgrammeReadinessAggregate(id);
    changeSummary = await getUnpublishedProgrammeChangeSummary(id);
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
      notFound();
    }
    throw error;
  }
  if (!composition) notFound();

  const readinessItems = evaluateProgrammeReadiness(aggregate);

  const [canPublish, canManage, affectedCohorts] = await Promise.all([
    can("programmes.publish", { programmeId: id }),
    can("programmes.manage", { programmeId: id }),
    blockingCohorts({ programmeId: id }),
  ]);

  const courseList =
    composition.members.length === 0 ? (
      <p className="text-sm text-foreground">
        No courses yet.{" "}
        <Link href={`/staff/programmes/${id}/arrange`} className="text-accent underline underline-offset-2">
          Add courses on the arrange screen.
        </Link>
      </p>
    ) : (
      <div className="flex flex-col gap-3">
        <Link
          href={`/staff/programmes/${id}/arrange`}
          className="self-start text-xs text-accent underline underline-offset-2"
        >
          Arrange courses
        </Link>
        <ol className="flex flex-col gap-1">
          {composition.members.map((member) => (
            <li key={member.membershipId} className="flex items-baseline gap-2 text-sm">
              <span className="font-mono text-xs text-muted-foreground">{member.position + 1}</span>
              <Link
                href={`/staff/courses/${member.courseId}`}
                className="text-accent underline underline-offset-2"
              >
                {member.title}
              </Link>
              {member.status !== "PUBLISHED" && (
                <span className="text-[11px] uppercase tracking-wide text-warning">{member.status}</span>
              )}
            </li>
          ))}
        </ol>
      </div>
    );

  return (
    <DetailLayout
      breadcrumbs={[
        { label: "Workspace", href: "/staff/programmes" },
        { label: "Programmes", href: "/staff/programmes" },
        { label: programme.title },
      ]}
      title={programme.title}
      identifier={programme.slug}
      subtitle={programme.summary}
      actions={
        <ProgrammeDetailClient
          programmeId={id}
          status={aggregate.status}
          publiclyListed={aggregate.publiclyListed}
          canPublish={canPublish}
          canManage={canManage}
          expectedUpdatedAt={aggregate.updatedAt.toISOString()}
          readinessItems={readinessItems}
          unpublishedChanges={changeSummary.changes}
          affectedCohorts={affectedCohorts}
        />
      }
      badges={
        <>
          <StatusPill label={programme.status} tone={TONE[programme.status] ?? "neutral"} />
          {programme.publiclyListed && <StatusPill label="Listed publicly" tone="accent" />}
          <StatusPill label={programme.sequential ? "Sequential" : "Any order"} tone="neutral" />
        </>
      }
      sections={[
        {
          id: "overview",
          label: "Overview",
          content: (
            <DetailFacts
              facts={[
                { label: "Slug", value: programme.slug, mono: true },
                { label: "Status", value: programme.status },
                { label: "Public listing", value: programme.publiclyListed ? "Listed" : "Not listed" },
                { label: "Version", value: programme.contentVersion, mono: true },
                { label: "Courses", value: composition.members.length, mono: true },
                { label: "Certificate", value: programme.certificateEnabled ? "Enabled" : "Disabled" },
              ]}
            />
          ),
        },
        {
          id: "readiness",
          label: "Readiness",
          content: (
            <div className="flex flex-col gap-4">
              {changeSummary.hasChanges && (
                <div role="status" className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5 shadow-xs">
                  <p className="text-sm font-semibold text-warning">
                    This programme has obligation changes that have not been published.
                  </p>
                  {changeSummary.changes.length > 0 && (
                    <ul className="mt-1 list-disc pl-5 text-xs text-foreground">
                      {changeSummary.changes.map((change) => (
                        <li key={change}>{change}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <ReadinessPanel items={readinessItems} />
            </div>
          ),
        },
        {
          id: "courses",
          label: "Courses",
          content: courseList,
        },
        {
          id: "settings",
          label: "Settings",
          content: (
            <ProgrammeForm
              mode="edit"
              programmeId={id}
              values={{
                title: programme.title,
                slug: programme.slug,
                summary: programme.summary,
                outcomes: programme.outcomes,
                audience: programme.audience,
                sequential: programme.sequential,
              }}
            />
          ),
        },
      ]}
    />
  );
}
