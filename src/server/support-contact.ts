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
