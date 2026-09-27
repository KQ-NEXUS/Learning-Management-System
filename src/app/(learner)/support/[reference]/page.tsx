import { redirect } from "next/navigation";
import { LearnerPageHeader } from "@/components/shell/LearnerPageHeader";
import { NOTE_DANGER } from "@/components/primitives/controls";
import { getCurrentActor } from "@/server/auth/current-actor";
import { TicketNotFoundError, getOwnTicketByReference } from "@/server/services/ticket-service";
import { LearnerTicketDetail, type LearnerTicketView } from "./LearnerTicketDetail";

export const dynamic = "force-dynamic";

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function LearnerTicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ reference: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { reference } = await params;
  const query = await searchParams;

  const actor = await getCurrentActor();
  if (!actor) redirect("/signin");

  let view: LearnerTicketView | null = null;
  let denied = false;
  try {
    const ticket = await getOwnTicketByReference(decodeURIComponent(reference));
    // Explicit projection: only learner-facing fields cross into the client
    // component (no priority, queue, assignee or any staff-shaped data).
    view = {
      reference: ticket.reference,
      subject: ticket.subject,
      category: ticket.category,
      status: ticket.status,
      version: ticket.version,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      context: ticket.context ? { kind: ticket.context.kind, safeReference: ticket.context.safeReference } : null,
      canReply: ticket.canReply,
      canClose: ticket.canClose,
      canReopen: ticket.canReopen,
      autoCloseAt: ticket.autoCloseAt,
      messages: ticket.messages.map((m) => ({
        id: m.id,
        authorRole: m.authorRole,
        body: m.body,
        createdAt: m.createdAt,
        attachments: m.attachments.map((a) => ({
          id: a.id,
          filename: a.filename,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
        })),
      })),
    };
  } catch (error) {
    if (error instanceof TicketNotFoundError) denied = true;
  }

  if (!view) {
    return (
      <div className="flex flex-col gap-6">
        <LearnerPageHeader title="Support ticket" back={{ label: "Back to support", href: "/support" }} />
        <p role="alert" className={NOTE_DANGER}>
          {denied ? "You don’t have access to this ticket." : "We couldn’t load this ticket. Try again."}
        </p>
      </div>
    );
  }

  const failedCount = Number.parseInt(first(query.failed) ?? "0", 10) || 0;
  const banner =
    first(query.upload) === "partial" && failedCount > 0
      ? { kind: "partial" as const, failed: failedCount }
      : first(query.created) === "1"
        ? { kind: "created" as const, failed: 0 }
        : null;

  return (
    <div className="flex flex-col gap-6">
      <LearnerPageHeader
        title={view.subject}
        back={{ label: "Back to support", href: "/support" }}
      />
      <LearnerTicketDetail ticket={view} banner={banner} />
    </div>
  );
}
