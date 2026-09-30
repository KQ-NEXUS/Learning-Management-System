/**
 * Deterministic minor-unit currency formatting for email and notification
 * labels (money in minor units).
 *
 * The ONLY place a stored `amountMinor`/`currency` pair is turned into a
 * human-readable amount for a mail or notification param. Divides the integer
 * minor-unit value by 100 and formats it with `Intl.NumberFormat` under a
 * FIXED "en" locale and `currency` style — never the server's own default
 * locale (unspecified, and could differ by deployment/host), and no floating
 * arithmetic beyond that one division.
 */
export function formatMinorAmount(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
  }).format(amountMinor / 100);
}
