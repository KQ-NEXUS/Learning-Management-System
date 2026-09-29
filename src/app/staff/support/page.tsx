import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { getStaffQueue, listTicketAssignees, parseQueueParams } from "@/server/services/ticket-staff-queue-service";
import { SupportWorkspace } from "./SupportWorkspace";
import { SessionEnded } from "@/components/shell/SessionEnded";

export const metadata = { title: "Support" };

export default async function StaffSupportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = parseQueueParams(await searchParams);
  let data: [Awaited<ReturnType<typeof getStaffQueue>>, Awaited<ReturnType<typeof listTicketAssignees>>];
  try {
    data = await Promise.all([getStaffQueue(params), listTicketAssignees()]);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return <SessionEnded />;
    }
    if (error instanceof AuthorizationError) return <SupportWorkspace denied />;
    console.error("Support queue failed to load", error);
    return <SupportWorkspace error />;
  }
  return <SupportWorkspace view={data[0]} assignees={data[1]} />;
}
