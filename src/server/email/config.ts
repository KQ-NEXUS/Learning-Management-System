/**
 * The one place deployment email identity is read (COM-04, D-14, D-15).
 *
 * Sender name and address, the brand shown in mail, the Reply-To, the public
 * base URL and the transport mode are all resolved here. Nothing falls back to
 * a made-up sender: an unconfigured deployment fails loudly (EmailConfigError)
 * rather than sending as an unapproved identity. Error messages name the
 * variable, never its value.
 *
 * Pure of Prisma and of any Next.js request API.
 */

import { requireSupportContactEmail } from "@/server/support-contact";

export class EmailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailConfigError";
  }
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const CONTROL_CHARS_GLOBAL = /[\u0000-\u001f\u007f]+/g;

/** Strips CR, LF and other control characters and collapses whitespace (T-13-05). */
export function sanitizeHeaderText(value: string): string {
  return value.replace(CONTROL_CHARS_GLOBAL, " ").replace(/\s+/g, " ").trim();
}

function requireEnv(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (!value) {
    throw new EmailConfigError(`${name} is not configured.`);
  }
  return value;
}

export function getSenderIdentity(): { name: string; email: string } {
  const name = requireEnv("EMAIL_SENDER_NAME");
  const email = requireEnv("EMAIL_SENDER_ADDRESS");
  if (!email.includes("@") || CONTROL_CHARS.test(email) || /\s/.test(email)) {
    throw new EmailConfigError("EMAIL_SENDER_ADDRESS is not a valid email address.");
  }
  if (CONTROL_CHARS.test(name)) {
    throw new EmailConfigError("EMAIL_SENDER_NAME contains control characters.");
  }
  return { name, email };
}

/** The brand in mail equals the approved sender name (one identity, COM-04). */
export function getBrandName(): string {
  return getSenderIdentity().name;
}

export function getReplyTo(): { email: string } {
  return { email: requireSupportContactEmail() };
}

export function getPublicBaseUrl(): string {
  const raw = (process.env.APP_BASE_URL ?? "").trim();
  if (!raw) {
    const env = process.env.NODE_ENV;
    if (env === "development" || env === "test") {
      return "http://localhost:3000";
    }
    throw new EmailConfigError("APP_BASE_URL is not configured.");
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new EmailConfigError("APP_BASE_URL is not an absolute http or https URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new EmailConfigError("APP_BASE_URL is not an absolute http or https URL.");
  }
  return raw.replace(/\/+$/, "");
}

/**
 * Builds an absolute link from an internal path only (D-15, T-13-10). A scheme,
 * host or protocol-relative value is rejected so an email button can never be
 * an open redirect.
 */
export function buildAbsoluteUrl(
  path: string,
  query?: Record<string, string>,
): string {
  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("://") ||
    path.includes("\\") ||
    CONTROL_CHARS.test(path) ||
    /^\/[^/?#]*:/.test(path)
  ) {
    throw new EmailConfigError("Email links must be internal paths.");
  }
  let url = `${getPublicBaseUrl()}${path}`;
  if (query && Object.keys(query).length > 0) {
    const search = Object.entries(query)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
    url += (path.includes("?") ? "&" : "?") + search;
  }
  return url;
}

export type EmailTransportMode = "brevo" | "stub";

export function getEmailTransportMode(): EmailTransportMode {
  const raw = (process.env.EMAIL_TRANSPORT ?? "").trim();
  if (raw === "" || raw === "brevo") return "brevo";
  if (raw === "stub") return "stub";
  throw new EmailConfigError("EMAIL_TRANSPORT has an unsupported value.");
}
