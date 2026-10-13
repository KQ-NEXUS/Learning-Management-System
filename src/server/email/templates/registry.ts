/**
 * The typed template registry every transactional email renders through
 * (COM-01, D-13). Callers use `renderEmail(template, params)` and never build
 * html, subjects or links by hand. TEMPLATE_REGISTRY is a total Record over
 * TEMPLATE_IDS, so a missing template is a compile error.
 */

import type { TemplateId } from "@/server/communications/contracts";
import { getBrandName, sanitizeHeaderText } from "@/server/email/config";
import { requireSupportContactEmail } from "@/server/support-contact";
import { renderEmailLayout, type EmailContent } from "@/server/email/templates/layout";
import {
  AUTH_SAMPLES,
  AUTH_TEMPLATES,
  type AuthParamsMap,
} from "@/server/email/templates/auth-templates";
import {
  LEARNER_SAMPLES,
  LEARNER_TEMPLATES,
  type LearnerParamsMap,
} from "@/server/email/templates/learner-templates";
import {
  STAFF_SAMPLES,
  STAFF_TEMPLATES,
  type StaffParamsMap,
} from "@/server/email/templates/staff-templates";

export type TemplateParamsMap = AuthParamsMap & LearnerParamsMap & StaffParamsMap;

type TemplateDefinition<P> = (params: P) => EmailContent;

export const TEMPLATE_REGISTRY: {
  [K in TemplateId]: TemplateDefinition<TemplateParamsMap[K]>;
} = {
  ...AUTH_TEMPLATES,
  ...LEARNER_TEMPLATES,
  ...STAFF_TEMPLATES,
};

export const TEMPLATE_SAMPLES: TemplateParamsMap = {
  ...AUTH_SAMPLES,
  ...LEARNER_SAMPLES,
  ...STAFF_SAMPLES,
};

export function renderEmail<K extends TemplateId>(
  template: K,
  params: TemplateParamsMap[K],
): { subject: string; html: string; text: string } {
  const definition = TEMPLATE_REGISTRY[template] as TemplateDefinition<TemplateParamsMap[K]> | undefined;
  if (!definition) {
    throw new Error(`Unknown email template: ${String(template)}`);
  }
  const content = definition(params);
  const { html, text } = renderEmailLayout(content, {
    brandName: getBrandName(),
    supportEmail: requireSupportContactEmail(),
  });
  return { subject: sanitizeHeaderText(content.subject), html, text };
}
