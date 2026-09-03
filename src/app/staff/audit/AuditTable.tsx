"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Fragment, useState, useTransition } from "react";
import type { AuditRow, AuditFilterOptions } from "@/server/services/audit-read-service";

/**
 * A sibling of ResourceTable, not a consumer of it — expand-in-place is the
 * one behaviour the primitive lacks. Skeleton, empty, denied, and error panel
 * markup are copied verbatim from ResourceTable so the visual language
 * matches exactly.
 */

const HEAD =
  "px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500";
const CELL = "px-3 py-2 align-middle";
const BTN =
  "border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50";

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 border border-zinc-200 bg-white px-6 py-10">
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
      <h2 className="text-base font-semibold tracking-tight text-zinc-900">Audit</h2>

      {filterOptions && filters && (
        <div className="flex flex-wrap items-center gap-3 border border-zinc-200 bg-zinc-50/60 px-3 py-2.5">
          <label className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              Actor
            </span>
            <select
              value={filters.actorId}
              onChange={(e) => setParam("actorId", e.target.value)}
              className="border border-zinc-300 bg-white px-2 py-1 text-xs"
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
            <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              Action
            </span>
            <select
              value={filters.action}
              onChange={(e) => setParam("action", e.target.value)}
              className="border border-zinc-300 bg-white px-2 py-1 text-xs"
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
            <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              From
            </span>
            <input
              type="date"
              value={filters.from}
              onChange={(e) => setParam("from", e.target.value)}
              className="border border-zinc-300 bg-white px-2 py-1 text-xs"
            />
          </label>

          <label className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              To
            </span>
            <input
              type="date"
              value={filters.to}
              onChange={(e) => setParam("to", e.target.value)}
              className="border border-zinc-300 bg-white px-2 py-1 text-xs"
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
          <span className="font-mono text-xs tracking-wide text-zinc-500">403</span>
          <p className="text-sm font-semibold text-zinc-900">You do not have access to audit events</p>
          <p className="max-w-prose text-sm text-zinc-600">
            Your role does not include{" "}
            <code className="bg-zinc-100 px-1 font-mono text-xs">{denied.permission}</code> at this
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
          <p className="text-sm font-semibold text-zinc-900">Could not load audit events</p>
          <p className="max-w-prose text-sm text-zinc-600">
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
        <div role="alert" className="border border-danger/30 bg-danger-surface px-3 py-2 text-sm text-danger">
          {validationError.message}
        </div>
      )}

      {!rows || rows.length === 0 ? (
        <Panel>
          <p className="text-sm font-semibold text-zinc-900">
            {activeFilterCount > 0 ? "No audit events match these filters" : "No audit events yet"}
          </p>
          {activeFilterCount > 0 && (
            <button type="button" onClick={clearFilters} className={BTN}>
              Clear filters
            </button>
          )}
        </Panel>
      ) : (
        <div className="border border-zinc-200">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-zinc-50">
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
                    <tr key={i} className="border-t border-zinc-200">
                      <td colSpan={4} className={CELL}>
                        <span className="block h-3 w-full max-w-[20rem] animate-pulse bg-zinc-200" />
                      </td>
                    </tr>
                  ))
                : rows.map((row) => {
                    const expanded = expandedId === row.id;
                    const diff = computeDiff(row.before, row.after);
                    return (
                      <Fragment key={row.id}>
                        <tr className="border-t border-zinc-200 hover:bg-zinc-50">
                          <td colSpan={4} className="p-0">
                            <button
                              type="button"
                              aria-expanded={expanded}
                              onClick={() => setExpandedId(expanded ? null : row.id)}
                              className="grid w-full grid-cols-4 gap-2 px-3 py-2 text-left"
                            >
                              <span className="flex flex-col gap-0.5">
                                <span className="font-medium text-zinc-900">
                                  {row.actorName ?? "System"}
                                </span>
                                <span className="text-[11px] text-zinc-500">{row.actorEmail ?? "—"}</span>
                              </span>
                              <span className="self-center font-mono text-xs text-zinc-700">
                                {row.action}
                              </span>
                              <span className="self-center text-xs text-zinc-700">
                                {row.targetType} <span className="font-mono">{shortenId(row.targetId)}</span>
                              </span>
                              <span className="self-center text-right font-mono text-xs tabular-nums text-zinc-500">
                                {row.createdAt.toLocaleString()}
                              </span>
                            </button>
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="border-t border-zinc-200 bg-zinc-50/60">
                            <td colSpan={4} className="px-3 py-3">
                              <div className="flex max-h-64 flex-col gap-3 overflow-y-auto">
                                <div className="flex flex-wrap gap-4 text-xs text-zinc-600">
                                  <span>
                                    <span className="font-semibold uppercase tracking-wide text-zinc-500">
                                      Scope:
                                    </span>{" "}
                                    {row.scopeType && row.scopeId
                                      ? `${row.scopeType} ${row.scopeId}`
                                      : row.scopeType
                                        ? row.scopeType
                                        : "—"}
                                  </span>
                                  <span>
                                    <span className="font-semibold uppercase tracking-wide text-zinc-500">
                                      Outcome:
                                    </span>{" "}
                                    {row.outcome}
                                  </span>
                                </div>

                                <p className="text-sm text-zinc-700">
                                  <span className="font-semibold uppercase tracking-wide text-[11px] text-zinc-500">
                                    Reason:
                                  </span>{" "}
                                  {row.reason ?? "—"}
                                </p>

                                {diff.length > 0 ? (
                                  <ul className="flex flex-col gap-1 font-mono text-xs text-zinc-700">
                                    {diff.map((d) => (
                                      <li key={d.key}>
                                        <span className="text-zinc-500">{d.key}:</span>{" "}
                                        {formatValue(d.oldValue)} → {formatValue(d.newValue)}
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="text-xs text-zinc-500">No field-level changes recorded.</p>
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
