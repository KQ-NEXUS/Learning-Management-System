/**
 * REG-05's required support contact address (D-19 — static contact info; a
 * future real ticket system does not exist yet, per `06-08-SUMMARY.md`).
 *
 * Sourced from configuration (`SUPPORT_CONTACT_EMAIL`, documented in
 * `.env.example`) rather than a literal baked into any one page, so every
 * learner-facing surface that needs a support contact — the receipt page
 * (`/orders/[reference]`) and the offer/cohort card's unavailable-rail
 * notice (07-09, D-19/D-05) — reads the exact same value. Never invent a
 * second placeholder string for the same purpose.
 */
export const SUPPORT_CONTACT_EMAIL = process.env.SUPPORT_CONTACT_EMAIL ?? "support@example.com";

/**
 * The support mailbox used as the email Reply-To and footer contact (COM-04).
 * Unlike the public-page constant above, this has no fallback: an
 * unconfigured deployment must fail loudly rather than send with a made-up
 * Reply-To. The message names the variable, never a value.
 */
export function requireSupportContactEmail(): string {
  const value = (process.env.SUPPORT_CONTACT_EMAIL ?? "").trim();
  if (!value) {
    throw new Error("SUPPORT_CONTACT_EMAIL is not configured.");
  }
  return value;
}
