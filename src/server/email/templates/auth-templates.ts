/**
 * The three auth templates (D-10). They are the only templates whose link
 * carries a token. The calling service builds `url` with `buildAbsoluteUrl`
 * and the raw token; the template re-asserts the origin equals the configured
 * public base URL and throws otherwise (T-13-10), so a stored or hand-built
 * foreign URL can never reach a recipient.
 */

import { getPublicBaseUrl } from "@/server/email/config";
import type { EmailContent } from "@/server/email/templates/layout";

export type AuthParamsMap = {
  "email-verification": { url: string; expiresInLabel: string };
  "password-reset": { url: string; expiresInLabel: string };
  "email-change-confirmation": { url: string; expiresInLabel: string };
};

type Definition<P> = (params: P) => EmailContent;

function assertOnPublicOrigin(url: string): string {
  let parsed: URL;
  let base: URL;
  try {
    parsed = new URL(url);
    base = new URL(getPublicBaseUrl());
  } catch {
    throw new Error("Auth email link must be an absolute URL on the public origin.");
  }
  if (parsed.origin !== base.origin) {
    throw new Error("Auth email link must be on the configured public origin.");
  }
  return parsed.toString();
}

function authTemplate(
  subject: string,
  heading: string,
  intro: string,
  label: string,
): Definition<{ url: string; expiresInLabel: string }> {
  return (p) => ({
    subject,
    heading,
    paragraphs: [
      intro,
      `This link expires in ${p.expiresInLabel}. If you did not request it, you can ignore this email.`,
    ],
    button: { label, href: assertOnPublicOrigin(p.url) },
  });
}

export const AUTH_TEMPLATES: { [K in keyof AuthParamsMap]: Definition<AuthParamsMap[K]> } = {
  "email-verification": authTemplate(
    "Verify your account",
    "Verify your email address",
    "Confirm your email address to finish setting up your account.",
    "Verify your email",
  ),
  "password-reset": authTemplate(
    "Reset your password",
    "Reset your password",
    "We received a request to reset your password.",
    "Reset password",
  ),
  "email-change-confirmation": authTemplate(
    "Confirm your new email address",
    "Confirm your new email address",
    "Confirm this address to make it the email on your account.",
    "Confirm email address",
  ),
};

// Clearly fake tokens: never a real credential.
export const AUTH_SAMPLES: AuthParamsMap = {
  "email-verification": {
    url: "https://lms.acme.test/verify?token=SAMPLE-NOT-A-REAL-TOKEN",
    expiresInLabel: "24 hours",
  },
  "password-reset": {
    url: "https://lms.acme.test/reset-password?token=SAMPLE-NOT-A-REAL-TOKEN",
    expiresInLabel: "1 hour",
  },
  "email-change-confirmation": {
    url: "https://lms.acme.test/account/confirm-email?token=SAMPLE-NOT-A-REAL-TOKEN",
    expiresInLabel: "24 hours",
  },
};
