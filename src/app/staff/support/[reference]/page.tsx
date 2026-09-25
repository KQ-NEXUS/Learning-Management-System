import { notFound } from "next/navigation";
import { DetailLayout } from "@/components/primitives";
import { AuthenticationError, AuthorizationError, can } from "@/server/permissions";
import { TicketNotFoundError } from "@/server/services/ticket-service";
import { getStaffTicketWorkspace, listTicketAssignees } from "@/server/services/ticket-staff-queue-service";
import { StaffTicketDetail } from "./StaffTicketDetail";

export const metadata = { title: "Support ticket" };

export default async function StaffTicketPage({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  let workspace: Awaited<ReturnType<typeof getStaffTicketWorkspace>>;
  try {
    workspace = await getStaffTicketWorkspace(reference);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return <p className="text-sm text-foreground">Your session has ended. Sign in again.</p>;
    }
    if (error instanceof AuthorizationError) {
      return <DetailLayout title="Support ticket" sections={[]} state={{ status: "denied", permission: "tickets.view" }} />;
    }
    if (error instanceof TicketNotFoundError) notFound();
    console.error("Support ticket failed to load", error);
    return <DetailLayout title="Support ticket" sections={[]} state={{ status: "error", message: "We couldn’t load this ticket. Try again." }} />;
  }
  const canManage = await can("tickets.manage", {});
  const assignees = canManage ? await listTicketAssignees().catch(() => []) : [];
  return <StaffTicketDetail workspace={workspace} canManage={canManage} assignees={assignees} />;
}
