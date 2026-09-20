import { EMPTY_LAYOUT_V1 } from "@/server/services/certificate-template-layout";
import { TemplateEditorShell } from "../TemplateEditorShell";

/**
 * The template editor, empty canvas (D-09, UI-SPEC 7.3.2).
 *
 * Renders the shell seeded from `EMPTY_LAYOUT_V1` with no `id` — the shell's
 * first "Save template" click calls `createTemplateAction` and navigates to
 * `/staff/certificates/templates/[id]` on success, per 11-DECISIONS.md's
 * "no draft/publish lifecycle" (UI-SPEC 7.3.6): a saved template is
 * immediately a real, selectable record, not a draft.
 */
export const metadata = { title: "New certificate template" };

export default function NewCertificateTemplatePage() {
  return <TemplateEditorShell initial={{ name: "", layout: EMPTY_LAYOUT_V1, readOnly: false }} />;
}
