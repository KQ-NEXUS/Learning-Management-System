/**
 * ProgressMeter — the teal progress/grade role's first real render (09-08
 * Task 2, UI-SPEC section 5 "new this phase — teal is now drawn").
 *
 * Server Component, no client JS. `--teal-fill` never renders freestanding:
 * it is always inside a bordered track (`border-border`, `rounded-full`,
 * `bg-surface-2`) with `captionText` shown as adjacent text in
 * `--teal-text` — the mitigation UI-SPEC section 5 records for the token's
 * 3.07:1 standalone-swatch contrast shortfall. Every caller (the dashboard's
 * "Your progress" card, the attendance bar, the lesson-list page's
 * course-level bar) must render both pieces together; there is no prop that
 * lets a caller draw the fill alone.
 */

export type ProgressMeterProps = {
  /** Accessible name for the progressbar — not necessarily shown as text. */
  label: string;
  /** 0-100. Clamped defensively so a bad upstream value can never overflow
   *  or invert the track. */
  valuePct: number;
  /** The adjacent text label, e.g. "3 of 5 required lessons complete". */
  captionText: string;
};

export function ProgressMeter({ label, valuePct, captionText }: ProgressMeterProps) {
  const clamped = Math.min(100, Math.max(0, Math.round(valuePct)));

  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2.5 w-full overflow-hidden rounded-full border border-border bg-surface-2"
      >
        <div
          className="h-full rounded-full bg-teal-fill"
          style={{ width: `${clamped}%` }}
        />
      </div>
      <p className="text-sm font-semibold text-teal-text">{captionText}</p>
    </div>
  );
}
