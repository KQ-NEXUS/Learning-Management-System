/**
 * Prices are stored as whole minor units (kobo, cents) but people think in naira
 * and dollars. These two helpers translate a price field between the two, using
 * string arithmetic so no floating-point rounding can change an amount.
 */

/** 45000000 -> "450000", 45000050 -> "450000.50", null -> "". */
export function minorToMajorString(minor: number | null | undefined): string {
  if (minor == null || !Number.isFinite(minor)) return "";
  const whole = Math.trunc(minor / 100);
  const fraction = Math.abs(minor % 100);
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, "0")}`;
}

/**
 * "450000" -> "45000000", "450,000.5" -> "45000050", "" -> "".
 * Anything that is not an amount with at most two decimals is returned unchanged,
 * so the server's own validation still refuses it.
 */
export function majorToMinorString(text: string): string {
  const trimmed = text.trim();
  if (trimmed === "") return "";
  const match = /^(\d[\d,]*)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) return trimmed;
  const whole = Number(match[1].replaceAll(",", ""));
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const minor = whole * 100 + fraction;
  return Number.isSafeInteger(minor) ? String(minor) : trimmed;
}
