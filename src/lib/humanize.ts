/**
 * UX batch C — one place that turns stored codes into words for people.
 * Staff screens used to print enum codes (PARTIALLY_REFUNDED), audit actions
 * (enrolment.withdrawn), camelCase keys and full database ids. Label maps
 * stay the first choice; these are the fallbacks, so a new status added
 * later still reads as words rather than SCREAMING_CASE.
 */

const INITIALISMS = new Set(["id", "url", "ngn", "usd", "kq", "csv"]);

/** "PARTIALLY_REFUNDED" -> "Partially refunded"; "enrolment.withdrawn" -> "Enrolment withdrawn". */
export function humanizeCode(value: string | null | undefined): string {
  if (!value) return "—";
  const words = value.replace(/[._]+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "paymentAttemptId" -> "Payment attempt ID". */
export function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (INITIALISMS.has(w) ? w.toUpperCase() : w));
  const sentence = words.join(" ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** A database id short enough to glance at; the full id stays available elsewhere. */
export function shortId(id: string | null | undefined): string {
  if (!id) return "—";
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

const PROVIDERS: Record<string, string> = { PAYSTACK: "Paystack", STRIPE: "Stripe", MANUAL: "Manual" };

export function providerLabel(provider: string | null | undefined): string {
  if (!provider) return "—";
  return PROVIDERS[provider] ?? humanizeCode(provider);
}
