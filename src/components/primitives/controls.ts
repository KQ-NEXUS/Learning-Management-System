/**
 * Shared class strings for screens that can't be built from `ResourceTable` and `ResourceForm`
 * alone (reports, exports, reconciliation, the audit export dialog, page-head actions). They
 * match what those primitives draw, so every screen reads as one system (IETC redesign,
 * design/mockups/system.css: `.btn`, `.btn.line`, `.input`, `.note`, `.tbl`).
 */

/** A secondary button: an ink outline, 48px tall. */
export const BTN =
  "inline-flex min-h-12 items-center justify-center gap-2.5 rounded-[10px] bg-transparent px-[22px] text-[15.5px] font-bold text-ink shadow-[inset_0_0_0_2px_var(--ietc-ink)] hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-55";

/** The primary button: solid ink, 48px tall. */
export const BTN_PRIMARY =
  "inline-flex min-h-12 items-center justify-center gap-2.5 rounded-[10px] bg-ink px-[22px] text-[15.5px] font-bold text-white hover:bg-ink-hover disabled:cursor-not-allowed disabled:opacity-55";

/**
 * Page-head buttons. The head used to be a navy band; in the IETC look it sits on the page
 * ground, so these are the ordinary outline and solid buttons at the smaller 40px height.
 */
export const BTN_ON_NAVY =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-[10px] bg-transparent px-4 text-[14.5px] font-bold text-ink shadow-[inset_0_0_0_2px_var(--ietc-ink)] hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-55";

/** The primary page-head button. */
export const BTN_PRIMARY_ON_NAVY =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-[10px] bg-ink px-4 text-[14.5px] font-bold text-white hover:bg-ink-hover disabled:cursor-not-allowed disabled:opacity-55";

/** Select / date input. */
export const CONTROL =
  "min-h-[52px] min-w-0 rounded-[10px] border-[1.5px] border-field bg-paper px-4 text-base font-medium text-ink hover:border-ink";

export const TEXTAREA =
  "min-h-[140px] rounded-[10px] border-[1.5px] border-field bg-paper px-4 py-3.5 text-base leading-normal font-medium text-ink hover:border-ink";

/** A label wrapping a control: the caption sits above it. */
export const FIELD = "flex min-w-0 flex-col gap-1.5 text-[15px] font-bold text-ink";

/** Section heading, drawn over an ink rule by the caller. */
export const SECTION_TITLE = "ietc-display text-[25px] leading-none md:text-[28px] text-ink";

/** Table header and cell, matching ResourceTable. */
export const TH = "py-2.5 pr-4 text-left text-[13.5px] font-bold whitespace-nowrap text-ink-soft last:pr-0";
export const TD = "py-3.5 pr-4 align-middle last:pr-0";

/** A short message: a tinted block, never a side stripe (plain / success / danger / warning). */
export const NOTE = "rounded-xl bg-ground px-4 py-3.5 text-[15px] text-ink";
export const NOTE_SUCCESS = "rounded-xl bg-pill-green-bg px-4 py-3.5 text-[15px] text-pill-green-ink";
export const NOTE_DANGER = "rounded-xl bg-danger-surface px-4 py-3.5 text-[15px] text-pill-red-ink";
export const NOTE_WARNING = "rounded-xl bg-warning-surface px-4 py-3.5 text-[15px] text-pill-amber-ink";

/** Modal scrim and panel. */
export const DIALOG_SCRIM = "fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-4";
export const DIALOG_PANEL = "flex w-full max-w-lg flex-col gap-5 rounded-[18px] bg-paper p-8 shadow-card";

/**
 * Size class for a row of big headline figures. If any value in the row is long (a money amount
 * such as "NGN 370,000.00"), the whole row drops a step so the figures stay level and none of them
 * wraps mid-number.
 */
export function figureSize(values: readonly string[]): string {
  return values.some((value) => value.length > 9) ? "ietc-display text-[24px] sm:text-[30px]" : "ietc-display text-[40px] sm:text-[52px]";
}
