/**
 * DeferredSlot — the dashboard's four named-gap cards (09-08 Task 2, UI-SPEC
 * section 6.2 "named-gap convention").
 *
 * Mirrors `RosterTab`'s `DeferredCell` treatment
 * (`src/app/staff/cohorts/[id]/RosterTab.tsx`): muted foreground text, a
 * plain glyph (never an icon suggesting interactivity), no link, no button.
 * Server Component, no client JS — this card is never interactive by
 * definition (T-09-32: a gap must never be clickable into a non-existent
 * future-phase surface).
 */

export type DeferredSlotProps = {
  title: string;
  copy: string;
};

export function DeferredSlot({ title, copy }: DeferredSlotProps) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface px-4 py-3 shadow-xs">
      <p className="text-sm font-semibold text-muted-foreground">{title}</p>
      <p className="inline-flex items-center gap-2 text-[11px] text-muted-foreground">
        <span aria-hidden className="font-mono">
          •
        </span>
        {copy}
      </p>
    </div>
  );
}
