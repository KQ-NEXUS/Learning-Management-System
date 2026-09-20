import { notFound } from "next/navigation";
import { can } from "@/server/permissions";
import { DesignUploadStart } from "../DesignUploadStart";

/**
 * Start a certificate template from the school's own artwork (D-09 follow-up): upload a design
 * image, then land in the editor with it as the full-page background.
 *
 * Only for staff who can manage templates — the same permission the upload and create actions
 * enforce — so nobody is offered a flow that would fail at its first step.
 */
export const metadata = { title: "Upload existing design" };

export default async function CertificateTemplateFromDesignPage() {
  if (!(await can("certificates.manage", {}))) notFound();
  return <DesignUploadStart />;
}
