/**
 * Shared class strings for the finance and reporting screens (reports, exports, reconciliation and
 * the audit export dialog). They match the buttons, fields and table cells `ResourceTable` and
 * `ResourceForm` draw, so screens that can't be built from those primitives still read as one system.
 */

/** A secondary (outlined) button, 46px tall. */
export const BTN =
  "inline-flex min-h-[46px] items-center justify-center rounded-md border border-input-border bg-surface px-[18px] text-sm font-semibold text-foreground hover:bg-surface-2 disabled:opacity-50";

/** The primary (blue) button, 46px tall. */
export const BTN_PRIMARY =
  "inline-flex min-h-[46px] items-center justify-center rounded-md bg-accent px-[18px] text-sm font-semibold text-accent-contrast hover:bg-accent-deep disabled:opacity-50";

/** An outlined button that sits on the navy header band. */
export const BTN_ON_NAVY =
  "inline-flex min-h-10 items-center justify-center rounded-md border border-sidebar-line px-4 text-sm font-semibold text-white hover:bg-sidebar-hover disabled:opacity-50";

/** A primary button that sits on the navy header band. */
export const BTN_PRIMARY_ON_NAVY =
  "inline-flex min-h-10 items-center justify-center rounded-md bg-accent px-4 text-sm font-semibold text-accent-contrast hover:bg-accent-deep disabled:opacity-50";

/** Select / date input. */
export const CONTROL =
  "h-12 min-w-0 rounded-md border border-input-border bg-surface px-3 text-sm font-normal text-foreground";

export const TEXTAREA =
  "min-h-24 rounded-md border border-input-border bg-surface px-3 py-2 text-sm font-normal text-foreground";

/** A label wrapping a control: the caption sits above it. */
export const FIELD = "flex min-w-0 flex-col gap-2 text-sm font-semibold text-foreground";

/** Section heading, drawn over an ink rule by the caller. */
export const SECTION_TITLE = "text-[22px] leading-[1.2] font-semibold tracking-[-0.015em] text-foreground";

/** Table header and cell, matching ResourceTable. */
export const TH = "px-3 py-3 text-left text-[13px] font-medium whitespace-nowrap text-muted-foreground first:pl-0 last:pr-0";
export const TD = "px-3 py-4 align-top first:pl-0 last:pr-0";

/** A short message on a coloured left rule (success / danger / plain). */
export const NOTE = "border-l-2 border-foreground py-1 pl-4 text-sm text-foreground";
export const NOTE_SUCCESS = "border-l-2 border-success py-1 pl-4 text-sm text-foreground";
export const NOTE_DANGER = "border-l-2 border-danger py-1 pl-4 text-sm text-danger";
export const NOTE_WARNING = "border-l-2 border-warning py-1 pl-4 text-sm text-foreground";

/** Modal scrim and panel. */
export const DIALOG_SCRIM = "fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4";
export const DIALOG_PANEL = "flex w-full max-w-lg flex-col gap-5 rounded-lg bg-surface p-8 shadow-card";

/**
 * Size class for a row of big headline figures. If any value in the row is long (a money amount
 * such as "NGN 370,000.00"), the whole row drops a step so the figures stay level and none of them
 * wraps mid-number.
 */
export function figureSize(values: readonly string[]): string {
  return values.some((value) => value.length > 9) ? "text-[18px] sm:text-[22px]" : "text-[28px]";
}
