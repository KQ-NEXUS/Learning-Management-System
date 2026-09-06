"use client";

import { summariseEffectiveAccess } from "@/lib/permission-groups";

/**
 * Plain markup, no primitive dependency (per 02-UI-SPEC.md) — a pure
 * client-side derivation from the current selection, no server round-trip.
 */
export function EffectiveAccessPreview({ selected }: { selected: ReadonlySet<string> }) {
  const lines = summariseEffectiveAccess(Array.from(selected));

  return (
    <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm text-foreground">
      {lines.length === 0 ? (
        <p>This role currently grants no access.</p>
      ) : (
        lines.map((line) => (
          <p key={line.group}>
            <span className="font-semibold text-foreground">{line.group}:</span>{" "}
            {line.verbs.join(", ")}
          </p>
        ))
      )}
    </div>
  );
}
