"use client";

import { summariseEffectiveAccess } from "@/lib/permission-groups";

/**
 * Plain markup, no primitive dependency (per 02-UI-SPEC.md) — a pure
 * client-side derivation from the current selection, no server round-trip.
 */
export function EffectiveAccessPreview({ selected }: { selected: ReadonlySet<string> }) {
  const lines = summariseEffectiveAccess(Array.from(selected));

  return (
    <div className="flex max-h-48 flex-col gap-1 overflow-y-auto border border-zinc-200 bg-zinc-50/60 px-3 py-2.5 text-sm text-zinc-700">
      {lines.length === 0 ? (
        <p>This role currently grants no access.</p>
      ) : (
        lines.map((line) => (
          <p key={line.group}>
            <span className="font-medium text-zinc-900">{line.group}:</span>{" "}
            {line.verbs.join(", ")}
          </p>
        ))
      )}
    </div>
  );
}
