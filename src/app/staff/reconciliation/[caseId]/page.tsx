import { notFound } from "next/navigation";
import { DetailLayout } from "@/components/primitives";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { getReconciliationCaseDetail } from "@/server/services/reconciliation-case-service";
import { ReconciliationCaseDetailView } from "./ReconciliationCaseDetail";
import { SessionEnded } from "@/components/shell/SessionEnded";

export const metadata = { title: "Reconciliation case" };

export default async function ReconciliationCasePage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  let detail: Awaited<ReturnType<typeof getReconciliationCaseDetail>>;
  try {
    detail = await getReconciliationCaseDetail(caseId);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return <SessionEnded />;
    }
    if (error instanceof AuthorizationError) {
      return <DetailLayout title="Reconciliation case" sections={[]} state={{ status: "denied", permission: "payments.view" }} />;
    }
    throw error;
  }
  if (!detail) notFound();
  return <ReconciliationCaseDetailView detail={detail} />;
}
