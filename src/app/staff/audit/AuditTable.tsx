"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Fragment, useState, useTransition } from "react";
import type { AuditRow, AuditFilterOptions } from "@/server/services/audit-read-service";
import { formatTimestamp } from "@/lib/format-timestamp";

/**
 * A sibling of ResourceTable, not a consumer of it — expand-in-place is the
 * one behaviour the primitive lacks. Skeleton, empty, denied, and error panel
 * markup are copied verbatim from ResourceTable so the visual language
 * matches exactly.
 */

const HEAD =
  "px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";
const CELL = "px-3 py-2 align-middle";
const BTN =
  "rounded-md border border-input-border bg-surface px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-surface-2";

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-xl border border-border bg-surface px-6 py-10 shadow-xs">
      {children}
    </div>
  );
}

function shortenId(id: string | null): string {
  if (!id) return "—";
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function computeDiff(
  before: unknown,
  after: unknown,
): { key: string; oldValue: unknown; newValue: unknown }[] {
  const beforeObj =
    before && typeof before === "object" ? (before as Record<string, unknown>) : {};
  const afterObj = after && typeof after === "object" ? (after as Record<string, unknown>) : {};
  const keys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]);

  const diffs: { key: string; oldValue: unknown; newValue: unknown }[] = [];
  for (const key of keys) {
    const oldValue = beforeObj[key];
    const newValue = afterObj[key];
    if (JSON.stringify(oldValue) === JSON.stringify(newValue)) continue;
    diffs.push({ key, oldValue, newValue });
  }
  return diffs;
}

export type AuditTableFilters = {
  actorId: string;
  action: string;
  from: string;
  to: string;
};

export function AuditTable({
  rows,
  denied,
  error,
  filterOptions,
  filters,
  validationError,
}: {
  rows?: AuditRow[];
  denied?: { permission: string };
  error?: { message?: string };
  filterOptions?: AuditFilterOptions;
  filters?: AuditTableFilters;
  validationError?: { message: string } | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function setParam(name: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(name, value);
    } else {
      params.delete(name);
    }
    startTransition(() => {
      router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
    });
  }

  const activeFilterCount = filters
    ? [filters.actorId, filters.action, filters.from, filters.to].filter(Boolean).length
    : 0;

  function clearFilters() {
    startTransition(() => router.push(pathname));
  }

  const header = (
    <div className="flex flex-col gap-3">
      <h2 className="text-base font-semibold tracking-tight text-foreground">Audit</h2>

      {filterOptions && filters && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-2 px-3 py-2.5 shadow-xs">
          <label className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Actor
            </span>
            <select
              value={filters.actorId}
              onChange={(e) => setParam("actorId", e.target.value)}
              className="h-[38px] rounded-md border border-input-border bg-surface px-2 py-1 text-xs"
            >
              <option value="">Any</option>
              {filterOptions.actors.map((actor) => (
                <option key={actor.id} value={actor.id}>
                  {actor.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Action
            </span>
            <select
              value={filters.action}
              onChange={(e) => setParam("action", e.target.value)}
              className="h-[38px] rounded-md border border-input-border bg-surface px-2 py-1 text-xs"
            >
              <option value="">Any</option>
              {filterOptions.actions.map((action) => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              From
            </span>
            <input
              type="date"
              value={filters.from}
              onChange={(e) => setParam("from", e.target.value)}
              className="h-[38px] rounded-md border border-input-border bg-surface px-2 py-1 text-xs"
            />
          </label>

          <label className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              To
            </span>
            <input
              type="date"
              value={filters.to}
              onChange={(e) => setParam("to", e.target.value)}
              className="h-[38px] rounded-md border border-input-border bg-surface px-2 py-1 text-xs"
            />
          </label>

          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="ml-auto text-xs text-accent underline underline-offset-2"
            >
              Clear filters
            </button>
          )}
        </div>
      )}
    </div>
  );

  if (denied) {
    return (
      <div className="flex flex-col gap-3">
        {header}
        <Panel>
          <span className="font-mono text-xs tracking-wide text-muted-foreground">403</span>
          <p className="text-sm font-semibold text-foreground">You do not have access to audit events</p>
          <p className="max-w-prose text-sm text-muted-foreground">
            Your role does not include{" "}
            <code className="rounded-sm bg-surface-2 px-1 font-mono text-xs">{denied.permission}</code> at this
            scope. Ask a workspace administrator to grant it.
          </p>
        </Panel>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-3">
        {header}
        <Panel>
          <p className="text-sm font-semibold text-foreground">Could not load audit events</p>
          <p className="max-w-prose text-sm text-muted-foreground">
            {error.message ?? "The request failed. Your filters are kept, so retrying returns to exactly this view."}
          </p>
        </Panel>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {header}

      {validationError && (
        <div role="alert" className="rounded-md border border-danger/30 bg-danger-surface px-3 py-2 text-sm text-danger">
          {validationError.message}
        </div>
      )}

      {!rows || rows.length === 0 ? (
        <Panel>
          <p className="text-sm font-semibold text-foreground">
            {activeFilterCount > 0 ? "No audit events match these filters" : "No audit events yet"}
          </p>
          {activeFilterCount > 0 && (
            <button type="button" onClick={clearFilters} className={BTN}>
              Clear filters
            </button>
          )}
        </Panel>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-xs">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-surface-2">
              <tr>
                <th scope="col" className={HEAD}>Actor</th>
                <th scope="col" className={HEAD}>Action</th>
                <th scope="col" className={HEAD}>Target</th>
                <th scope="col" className={`${HEAD} text-right`}>Time</th>
              </tr>
            </thead>
            <tbody aria-busy={isPending || undefined}>
              {isPending
                ? Array.from({ length: 5 }, (_, i) => (
                    <tr key={i} className="border-t border-border">
                      <td colSpan={4} className={CELL}>
                        <span className="block h-3 w-full max-w-[20rem] animate-pulse rounded-sm bg-surface-2" />
                      </td>
                    </tr>
                  ))
                : rows.map((row) => {
                    const expanded = expandedId === row.id;
                    const diff = computeDiff(row.before, row.after);
                    return (
                      <Fragment key={row.id}>
                        <tr className="border-t border-border hover:bg-surface-2">
                          <td colSpan={4} className="p-0">
                            <button
                              type="button"
                              aria-expanded={expanded}
                              onClick={() => setExpandedId(expanded ? null : row.id)}
                              className="grid w-full grid-cols-4 gap-2 px-3 py-2 text-left"
                            >
                              <span className="flex flex-col gap-0.5">
                                <span className="font-semibold text-foreground">
                                  {row.actorName ?? "System"}
                                </span>
                                <span className="text-[11px] text-muted-foreground">{row.actorEmail ?? "—"}</span>
                              </span>
                              <span className="self-center font-mono text-xs text-foreground">
                                {row.action}
                              </span>
                              <span className="self-center text-xs text-foreground">
                                {row.targetType} <span className="font-mono">{shortenId(row.targetId)}</span>
                              </span>
                              <span className="self-center text-right font-mono text-xs tabular-nums text-muted-foreground">
                                {formatTimestamp(row.createdAt)}
                              </span>
                            </button>
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="bg-surface-2">
                            <td colSpan={4} className="px-3 py-3">
                              <div className="flex max-h-64 flex-col gap-3 overflow-y-auto">
                                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                                  <span>
                                    <span className="font-semibold uppercase tracking-wide text-muted-foreground">
                                      Scope:
                                    </span>{" "}
                                    {row.scopeType && row.scopeId
                                      ? `${row.scopeType} ${row.scopeId}`
                                      : row.scopeType
                                        ? row.scopeType
                                        : "—"}
                                  </span>
                                  <span>
                                    <span className="font-semibold uppercase tracking-wide text-muted-foreground">
                                      Outcome:
                                    </span>{" "}
                                    {row.outcome}
                                  </span>
                                </div>

                                <p className="text-sm text-foreground">
                                  <span className="font-semibold uppercase tracking-wide text-[11px] text-muted-foreground">
                                    Reason:
                                  </span>{" "}
                                  {row.reason ?? "—"}
                                </p>

                                {diff.length > 0 ? (
                                  <ul className="flex flex-col gap-1 font-mono text-xs text-foreground">
                                    {diff.map((d) => (
                                      <li key={d.key}>
                                        <span className="text-muted-foreground">{d.key}:</span>{" "}
                                        {formatValue(d.oldValue)} → {formatValue(d.newValue)}
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="text-xs text-muted-foreground">No field-level changes recorded.</p>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
