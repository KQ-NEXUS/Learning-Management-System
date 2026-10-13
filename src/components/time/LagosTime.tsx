import {
  formatLagosOrDash,
  MISSING_TIMESTAMP,
  toIsoOrNull,
  type LagosVariant,
  type TimestampInput,
} from "@/lib/format-timestamp";

/**
 * One rendered timestamp in Lagos time (D-17, UI-SPEC S6).
 *
 * Renders `<time dateTime="{ISO 8601 UTC}">5 Oct 2026, 14:30 WAT</time>`, or a
 * plain "—" (no time element) when the value is missing or unparseable. No
 * "use client": the formatter is a pure module, so this works in server and
 * client components and renders byte-identically on both.
 */
export function LagosTime({
  value,
  variant = "dateTime",
  className,
}: {
  value: TimestampInput | null | undefined;
  variant?: LagosVariant;
  className?: string;
}) {
  const iso = toIsoOrNull(value);
  if (!iso) return <>{MISSING_TIMESTAMP}</>;
  return (
    <time dateTime={iso} className={className}>
      {formatLagosOrDash(value, variant)}
    </time>
  );
}
