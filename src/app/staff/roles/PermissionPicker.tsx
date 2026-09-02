"use client";

import { PERMISSION_GROUPS } from "@/lib/permission-groups";
import { isGlobalOnly, type Permission } from "@/server/permissions/catalogue";
import type { ScopeType } from "@/server/permissions/scope";

const BTN =
  "border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50";

export type PermissionPickerProps = {
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  /** Global-only identifiers (licence.*) disable at any non-GLOBAL scope (D-03). */
  scopeType?: ScopeType;
};

export function PermissionPicker({
  selected,
  onChange,
  scopeType = "GLOBAL",
}: PermissionPickerProps) {
  function toggle(permission: string) {
    const next = new Set(selected);
    if (next.has(permission)) {
      next.delete(permission);
    } else {
      next.add(permission);
    }
    onChange(next);
  }

  function selectAllInGroup(permissions: readonly Permission[]) {
    const next = new Set(selected);
    for (const permission of permissions) {
      if (scopeType !== "GLOBAL" && isGlobalOnly(permission)) continue;
      next.add(permission);
    }
    onChange(next);
  }

  function clearGroup(permissions: readonly Permission[]) {
    const next = new Set(selected);
    for (const permission of permissions) next.delete(permission);
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-2">
      {PERMISSION_GROUPS.map((group) => {
        const selectedCount = group.permissions.filter((p) => selected.has(p)).length;

        return (
          <details key={group.id} className="border border-zinc-200">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-600">
                {group.label}
              </span>
              <span className="font-mono text-xs tabular-nums text-zinc-400">
                {selectedCount}/{group.permissions.length}
              </span>
            </summary>

            <div className="flex flex-col gap-2 border-t border-zinc-200 px-3 py-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => selectAllInGroup(group.permissions)}
                  className={BTN}
                >
                  Select all in group
                </button>
                <button type="button" onClick={() => clearGroup(group.permissions)} className={BTN}>
                  Clear group
                </button>
              </div>

              <div className="flex flex-col gap-1.5">
                {group.permissions.map((permission) => {
                  const disabled = scopeType !== "GLOBAL" && isGlobalOnly(permission);
                  return (
                    <label
                      key={permission}
                      className="flex items-center gap-2 text-sm text-zinc-800"
                      title={disabled ? "Global scope only" : undefined}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(permission)}
                        disabled={disabled}
                        onChange={() => toggle(permission)}
                        className="accent-accent"
                      />
                      <span className="font-mono text-xs">{permission}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </details>
        );
      })}
    </div>
  );
}
