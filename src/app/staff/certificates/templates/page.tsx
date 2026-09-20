import { notFound } from "next/navigation";
import { AuthenticationError, AuthorizationError, can } from "@/server/permissions";
import { certificateTemplateService } from "@/server/services/certificate-template-service";
import { TemplatesTable, type TemplateRow } from "./TemplatesTable";

/**
 * The certificate-template library list (D-09, D-10, CRD-03, UI-SPEC 7.3.1).
 *
 * Reads the factory's own unfiltered `list()` — not `listSelectableTemplates`
 * — so archived rows still render here, read-only, per Pitfall 5. Reached by
 * direct URL and by the "Certificate templates" link plan 11-14 adds to the
 * Certificates landing page; no `StaffShell` nav entry is added by this plan
 * (plan 11-14's job, per this plan's own scope note).
 */
export const metadata = { title: "Certificate templates" };

export default async function CertificateTemplatesPage() {
  let templates: TemplateRow[];
  try {
    templates = (await certificateTemplateService.list()) as unknown as TemplateRow[];
  } catch (error) {
    if (error instanceof AuthenticationError || error instanceof AuthorizationError) {
      notFound();
    }
    throw error;
  }

  // Only offer "create" to staff who can actually use it; the destination page 404s otherwise.
  const canCreate = await can("certificates.manage", {});
  return <TemplatesTable rows={templates} canCreate={canCreate} />;
}
