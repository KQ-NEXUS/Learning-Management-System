import { notFound } from "next/navigation";
import { AuthenticationError, AuthorizationError } from "@/server/permissions";
import { certificateTemplateService } from "@/server/services/certificate-template-service";
import { parseCertificateTemplateLayout } from "@/server/services/certificate-template-layout";
import { TemplateEditorShell } from "../TemplateEditorShell";

/**
 * The template editor, editing an existing (or archived, read-only) template
 * (D-09, Pitfall 5).
 *
 * `readOnly` is derived from `archivedAt !== null` — an archived template
 * conceptually backs already-issued certificates, so its layout can never be
 * mutated again (T-11-37): the shell renders no palette, no save button and
 * no editable header inputs whenever this is true.
 */
export const metadata = { title: "Certificate template" };

export default async function CertificateTemplateEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let template;
  try {
    template = await certificateTemplateService.get(id);
  } catch (error) {
    if (error instanceof AuthenticationError || error instanceof AuthorizationError) {
      notFound();
    }
    throw error;
  }
  if (!template) notFound();

  return (
    <TemplateEditorShell
      initial={{
        id: template.id,
        name: template.name,
        layout: parseCertificateTemplateLayout(template.layout),
        readOnly: template.archivedAt !== null,
      }}
    />
  );
}
