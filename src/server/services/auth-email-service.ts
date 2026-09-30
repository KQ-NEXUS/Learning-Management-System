/**
 * The one send path every auth mail (verification, password reset, email
 * change) goes through (D-10, D-15). Builds the absolute link from an
 * internal path and the raw token, renders through the shared template
 * registry, derives a stable token-hash correlation key, and dispatches
 * best-effort so a render error (including a missing configuration) or a
 * send error never escapes to the caller — every account-recovery flow's
 * frozen result must be identical whether the mail actually sent or not
 * (D-08, IAM-06, T-13-23).
 *
 * The raw token exists only in the memory of this function's single call —
 * it is never written to `EmailDispatch.correlationId` (only its SHA-256
 * hash is), never to `templateParams` (dispatch always leaves that `null`
 * for these three templates), and never logged.
 */

import { buildAbsoluteUrl } from "@/server/email/config";
import { renderEmail } from "@/server/email/templates/registry";
import type { TemplateParamsMap } from "@/server/email/templates/registry";
import { buildAuthCorrelationId, dispatchBestEffort, type DispatchParams } from "@/server/services/email-dispatch-service";

export type AuthTemplateId = keyof Pick<
  TemplateParamsMap,
  "email-verification" | "password-reset" | "email-change-confirmation"
>;

export type SendAuthEmailInput = {
  template: AuthTemplateId;
  toEmail: string;
  userId: string;
  /** Internal path only — see `buildAbsoluteUrl` (D-15, T-13-10). */
  path: string;
  /** The raw, single-use token. Held only in this function's stack frame. */
  token: string;
  ttlMs: number;
};

/** Renders a millisecond duration as the auth templates' expiry copy
 * ("24 hours", "1 hour", "30 minutes"). Whole hours render as hours;
 * anything else renders as (rounded) minutes. */
export function formatTtlLabel(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes > 0 && totalMinutes % 60 === 0) {
    const hours = totalMinutes / 60;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `${totalMinutes} ${totalMinutes === 1 ? "minute" : "minutes"}`;
}

/**
 * `dispatch` is passed in (not imported as the singleton) so callers keep
 * injecting their own dependency, matching every other service in this
 * phase. A render failure — including `buildAbsoluteUrl`/`renderEmail`
 * throwing on an unconfigured or misconfigured deployment — and a dispatch
 * failure both resolve to `{ sent: false }`; neither ever rejects.
 */
export async function sendAuthEmail(
  dispatch: (params: DispatchParams) => Promise<unknown>,
  input: SendAuthEmailInput,
): Promise<{ sent: boolean }> {
  try {
    const url = buildAbsoluteUrl(input.path, { token: input.token });
    const expiresInLabel = formatTtlLabel(input.ttlMs);
    const rendered = renderEmail(input.template, { url, expiresInLabel });
    const correlationId = buildAuthCorrelationId(input.token);

    return await dispatchBestEffort(dispatch, {
      template: input.template,
      toEmail: input.toEmail,
      userId: input.userId,
      subject: rendered.subject,
      textContent: rendered.text,
      htmlContent: rendered.html,
      correlationId,
    });
  } catch {
    return { sent: false };
  }
}
