"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * ResourceTable — the list primitive.
 *
 * Roughly forty screens are configured from this rather than written by hand,
 * so the six states and every affordance live here once.
 *
 * Behaviours taken from the design spec, each of which matters:
 *   - Filters and sort are read from the URL, and the active query is shown
 *     as a dismissible chip so the state is never hidden from the user.
 *   - Column widths are held from config while loading, so nothing reflows
 *     when rows arrive.
 *   - A filter validation error keeps the previous rows visible beneath it;
 *     bad params never wipe the last good result set.
 *   - Denied shows identical copy whether or not records exist — no counts,
 *     titles, or ids leak (PRD RBAC-06).
 *   - Empty distinguishes "nothing here" from "nothing matches your filters".
 *   - Below 640px rows become cards; the page body never scrolls sideways.
 *   - There is no delete affordance in any state. Archive replaces it
 *     throughout (PRD CAT-08).
 */

export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Second line beneath the cell, e.g. "Programme · Finance Practice". */
  subtitle?: (row: T) => ReactNode;
  /** CSS width held during loading so arrival causes no reflow. */
  width?: string;
  align?: "left" | "right";
  /** Tabular figures for ids, money, counts. */
  mono?: boolean;
  /** Hidden in the card layout — use for low-value columns. */
  hideOnMobile?: boolean;
  sortable?: boolean;
};

export type TableFilter =
  | { kind: "search"; name: string; label: string; value: string; placeholder?: string }
  | {
      kind: "select";
      name: string;
      label: string;
      value: string;
      options: { value: string; label: string }[];
    };

export type SortState = { key: string; direction: "asc" | "desc" };

export type BulkSelection = {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  actions: { label: string; onClick: (ids: string[]) => void }[];
};

export type ResourceTableState<T> =
  | { status: "loading" }
  | { status: "ready"; rows: T[] }
  | { status: "empty"; activeFilterCount?: number; totalWithoutFilters?: number }
  | { status: "denied"; permission?: string }
  | {
      status: "error";
      message?: string;
      trace?: string;
      attempt?: number;
      maxAttempts?: number;
    };

export type ResourceTableProps<T> = {
  /** Describes the collection, e.g. "cohorts". Used in status messages. */
  noun: string;
  title?: string;
  columns: Column<T>[];
  state: ResourceTableState<T>;
  getRowKey: (row: T) => string;
  getRowHref?: (row: T) => string;
  /** Used for the row checkbox's accessible name, e.g. "Select CH-2611-A". */
  getRowLabel?: (row: T) => string;

  /** Rendered as "5 of 128" beneath the title. */
  shownCount?: number;
  totalCount?: number;

  filters?: TableFilter[];
  onFilterChange?: (name: string, value: string) => void;
  /** The literal query string, shown as a dismissible chip. */
  activeQuery?: string;
  onClearFilters?: () => void;

  sort?: SortState;
  onSortChange?: (key: string) => void;

  selection?: BulkSelection;
  headerActions?: ReactNode;

  /** Rendered above the rows without replacing them (filter errors). */
  validationError?: { message: string; fieldHref?: string } | null;
  onRetry?: () => void;
  onCreate?: () => void;
  createLabel?: string;
  primaryColumnKey?: string;
  /**
   * Overrides the unfiltered-empty body copy ("Create one to get started.").
   * Screens with a UI-SPEC-mandated exact empty-state sentence (e.g. Cohorts:
   * "Create a cohort to schedule sessions and open enrolment.") pass this
   * rather than duplicating the empty-state panel per screen.
   */
  emptyBody?: string;
};

const CELL = "px-3 py-2 align-middle";
const HEAD =
  "px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500";
const BTN =
  "border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50";
const BTN_PRIMARY =
  "bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-contrast hover:opacity-90";

function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 border border-zinc-200 bg-white px-6 py-10">
      {children}
    </div>
  );
}

/** Tri-state select-all: none, some, all. */
function SelectAll({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: (next: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label="Select all rows"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="size-3.5 accent-accent"
    />
  );
}

export function ResourceTable<T>({
  noun,
  title,
  columns,
  state,
  getRowKey,
  getRowHref,
  getRowLabel,
  shownCount,
  totalCount,
  filters,
  onFilterChange,
  activeQuery,
  onClearFilters,
  sort,
  onSortChange,
  selection,
  headerActions,
  validationError = null,
  onRetry,
  onCreate,
  createLabel,
  primaryColumnKey,
  emptyBody,
}: ResourceTableProps<T>) {
  const rows = state.status === "ready" ? state.rows : [];
  const loading = state.status === "loading";

  const allIds = rows.map(getRowKey);
  const selectedCount = selection?.selectedIds.length ?? 0;

  // Compared against the rows actually on screen, not a raw count: a
  // selection made before filtering can include rows that are no longer
  // visible, and comparing counts would wrongly show "all selected".
  const selectedVisible = selection
    ? allIds.filter((id) => selection.selectedIds.includes(id))
    : [];
  const allSelected =
    allIds.length > 0 && selectedVisible.length === allIds.length;

  const header = (
    <div className="flex flex-col gap-3">
      {(title || headerActions || shownCount !== undefined) && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            {title && (
              <h2 className="text-base font-semibold tracking-tight text-zinc-900">
                {title}
              </h2>
            )}
            {shownCount !== undefined && (
              <p className="text-xs text-zinc-500">
                {totalCount !== undefined
                  ? `${shownCount} of ${totalCount}`
                  : `${shownCount} ${noun}`}
                {" · sort and filters are read from the URL"}
              </p>
            )}
          </div>
          {headerActions && (
            <div className="flex flex-wrap gap-2">{headerActions}</div>
          )}
        </div>
      )}

      {filters && filters.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border border-zinc-200 bg-zinc-50/60 px-3 py-2.5">
          {filters.map((filter) => (
            <label key={filter.name} className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                {filter.label}
              </span>
              {filter.kind === "search" ? (
                <input
                  type="text"
                  value={filter.value}
                  placeholder={filter.placeholder}
                  onChange={(e) => onFilterChange?.(filter.name, e.target.value)}
                  className="border border-zinc-300 bg-white px-2 py-1 text-xs"
                />
              ) : (
                <select
                  value={filter.value}
                  onChange={(e) => onFilterChange?.(filter.name, e.target.value)}
                  className="border border-zinc-300 bg-white px-2 py-1 text-xs"
                >
                  {filter.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              )}
            </label>
          ))}

          {activeQuery && (
            <span className="inline-flex items-center gap-1.5 border border-zinc-300 bg-white px-2 py-1 font-mono text-[11px] text-zinc-600">
              {activeQuery}
              <button
                type="button"
                onClick={onClearFilters}
                aria-label="Clear all filters"
                className="text-zinc-400 hover:text-zinc-800"
              >
                ×
              </button>
            </span>
          )}

          {onClearFilters && (
            <button
              type="button"
              onClick={onClearFilters}
              className="ml-auto text-xs text-accent underline underline-offset-2"
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );

  // ---- denied ------------------------------------------------------------
  // Deliberately identical whether or not any record exists.
  if (state.status === "denied") {
    return (
      <div className="flex flex-col gap-3">
        {title && (
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        )}
        <Panel>
          <span className="font-mono text-xs tracking-wide text-zinc-500">403</span>
          <p className="text-sm font-semibold text-zinc-900">
            You do not have access to {noun}
          </p>
          <p className="max-w-prose text-sm text-zinc-600">
            Your role does not include{" "}
            {state.permission ? (
              <code className="bg-zinc-100 px-1 font-mono text-xs">
                {state.permission}
              </code>
            ) : (
              "the required permission"
            )}{" "}
            at this scope. Ask a workspace administrator to grant it.
          </p>
          <p className="text-xs text-zinc-500">
            Same copy whether or not the record exists. No counts, titles or IDs
            leak.
          </p>
        </Panel>
      </div>
    );
  }

  // ---- recoverable failure ----------------------------------------------
  if (state.status === "error") {
    return (
      <div className="flex flex-col gap-3">
        {header}
        <Panel>
          <p className="text-sm font-semibold text-zinc-900">
            Could not load {noun}
          </p>
          <p className="max-w-prose text-sm text-zinc-600">
            {state.message ??
              "The request timed out. Your filters and sort are kept in the URL, so retrying returns to exactly this view."}
          </p>
          {onRetry && (
            <button type="button" onClick={onRetry} className={BTN}>
              Retry
            </button>
          )}
          {(state.trace || state.attempt) && (
            <p className="font-mono text-[11px] text-zinc-500">
              {state.trace && `trace ${state.trace}`}
              {state.trace && state.attempt ? " · " : ""}
              {state.attempt &&
                `attempt ${state.attempt}${
                  state.maxAttempts ? ` of ${state.maxAttempts}` : ""
                }`}
            </p>
          )}
        </Panel>
      </div>
    );
  }

  // ---- empty -------------------------------------------------------------
  if (state.status === "empty") {
    const filtered = (state.activeFilterCount ?? 0) > 0;
    return (
      <div className="flex flex-col gap-3">
        {header}
        <Panel>
          <p className="text-sm font-semibold text-zinc-900">
            {filtered ? `No ${noun} match these filters` : `No ${noun} yet`}
          </p>
          <p className="max-w-prose text-sm text-zinc-600">
            {filtered
              ? `${state.activeFilterCount} ${
                  state.activeFilterCount === 1 ? "filter is" : "filters are"
                } active.${
                  state.totalWithoutFilters
                    ? ` Clearing them shows all ${state.totalWithoutFilters} ${noun}.`
                    : ""
                }`
              : (emptyBody ?? "Create one to get started.")}
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {filtered && onClearFilters && (
              <button type="button" onClick={onClearFilters} className={BTN}>
                Clear filters
              </button>
            )}
            {onCreate && (
              <button type="button" onClick={onCreate} className={BTN_PRIMARY}>
                {createLabel ?? `New ${noun.replace(/s$/, "")}`}
              </button>
            )}
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {header}

      {validationError && (
        <div
          role="alert"
          className="border border-danger/30 bg-danger-surface px-3 py-2 text-sm text-danger"
        >
          {validationError.message}{" "}
          {validationError.fieldHref && (
            <a href={validationError.fieldHref} className="underline">
              Fix the filters
            </a>
          )}
        </div>
      )}

      {selection && selectedCount > 0 && (
        <div className="flex flex-wrap items-center gap-3 border border-accent/30 bg-accent/5 px-3 py-2">
          <span className="text-xs font-medium text-accent">
            {selectedCount} selected
          </span>
          {selection.actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => action.onClick(selection.selectedIds)}
              className="text-xs font-medium text-zinc-700 underline underline-offset-2 hover:text-zinc-900"
            >
              {action.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => selection.onChange([])}
            className="ml-auto text-xs text-zinc-500 underline underline-offset-2"
          >
            Deselect
          </button>
        </div>
      )}

      {/* Table — hidden below 640px in favour of the card list. */}
      <div className="hidden overflow-x-auto border border-zinc-200 sm:block">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            {loading ? `Loading ${noun}` : `${rows.length} ${noun}`}
          </caption>
          <colgroup>
            {selection && <col style={{ width: "2.5rem" }} />}
            {columns.map((c) => (
              <col key={c.key} style={c.width ? { width: c.width } : undefined} />
            ))}
          </colgroup>
          <thead className="bg-zinc-50">
            <tr>
              {selection && (
                <th scope="col" className={HEAD}>
                  <SelectAll
                    checked={allSelected}
                    indeterminate={selectedVisible.length > 0 && !allSelected}
                    onChange={(next) =>
                      selection.onChange(
                        next
                          ? // Add the visible rows, keeping any selection
                            // made under a different filter.
                            Array.from(
                              new Set([...selection.selectedIds, ...allIds]),
                            )
                          : selection.selectedIds.filter(
                              (id) => !allIds.includes(id),
                            ),
                      )
                    }
                  />
                </th>
              )}
              {columns.map((c) => {
                const sorted = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={
                      sorted
                        ? sort.direction === "asc"
                          ? "ascending"
                          : "descending"
                        : c.sortable
                          ? "none"
                          : undefined
                    }
                    className={`${HEAD} ${
                      c.align === "right" ? "text-right" : "text-left"
                    }`}
                  >
                    {c.sortable && onSortChange ? (
                      <button
                        type="button"
                        onClick={() => onSortChange(c.key)}
                        className="inline-flex items-center gap-1 uppercase hover:text-zinc-800"
                      >
                        {c.header}
                        <span aria-hidden className="text-zinc-400">
                          {sorted ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}
                        </span>
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody aria-busy={loading || undefined}>
            {loading
              ? Array.from({ length: 5 }, (_, i) => (
                  <tr key={i} className="border-t border-zinc-200">
                    {selection && (
                      <td className={CELL}>
                        <span className="block size-3.5 animate-pulse bg-zinc-200" />
                      </td>
                    )}
                    {columns.map((c) => (
                      <td key={c.key} className={CELL}>
                        <span className="block h-3 w-full max-w-[12rem] animate-pulse bg-zinc-200" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row) => {
                  const id = getRowKey(row);
                  const href = getRowHref?.(row);
                  const checked = selection?.selectedIds.includes(id) ?? false;
                  return (
                    <tr
                      key={id}
                      className="border-t border-zinc-200 hover:bg-zinc-50"
                    >
                      {selection && (
                        <td className={CELL}>
                          <input
                            type="checkbox"
                            checked={checked}
                            aria-label={`Select ${getRowLabel?.(row) ?? id}`}
                            onChange={(e) =>
                              selection.onChange(
                                e.target.checked
                                  ? [...selection.selectedIds, id]
                                  : selection.selectedIds.filter((x) => x !== id),
                              )
                            }
                            className="size-3.5 accent-accent"
                          />
                        </td>
                      )}
                      {columns.map((c, i) => (
                        <td
                          key={c.key}
                          className={`${CELL} ${
                            c.align === "right" ? "text-right" : ""
                          } ${c.mono ? "font-mono text-xs tabular-nums" : ""}`}
                        >
                          <span className="flex flex-col gap-0.5">
                            {i === 0 && href ? (
                              <Link
                                href={href}
                                className="font-medium text-zinc-900 underline-offset-2 hover:underline"
                              >
                                {c.render(row)}
                              </Link>
                            ) : (
                              c.render(row)
                            )}
                            {c.subtitle && (
                              <span className="text-[11px] text-zinc-500">
                                {c.subtitle(row)}
                              </span>
                            )}
                          </span>
                        </td>
                      ))}
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>

      {/* Cards — the same data below 640px, so nothing scrolls sideways. */}
      <ul className="flex flex-col gap-2 sm:hidden">
        {loading
          ? Array.from({ length: 3 }, (_, i) => (
              <li key={i} className="border border-zinc-200 px-3 py-3">
                <span className="block h-3 w-32 animate-pulse bg-zinc-200" />
              </li>
            ))
          : rows.map((row) => {
              const href = getRowHref?.(row);
              const primary =
                columns.find((c) => c.key === primaryColumnKey) ?? columns[0];
              const rest = columns.filter(
                (c) => c.key !== primary.key && !c.hideOnMobile,
              );
              return (
                <li
                  key={getRowKey(row)}
                  className="flex flex-col gap-2 border border-zinc-200 px-3 py-3"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">
                      {href ? (
                        <Link href={href} className="underline underline-offset-2">
                          {primary.render(row)}
                        </Link>
                      ) : (
                        primary.render(row)
                      )}
                    </span>
                    {primary.subtitle && (
                      <span className="text-[11px] text-zinc-500">
                        {primary.subtitle(row)}
                      </span>
                    )}
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    {rest.map((c) => (
                      <div key={c.key} className="flex flex-col">
                        <dt className="text-[10px] uppercase tracking-wide text-zinc-500">
                          {c.header}
                        </dt>
                        <dd className={c.mono ? "font-mono tabular-nums" : ""}>
                          {c.render(row)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </li>
              );
            })}
      </ul>

      <p aria-live="polite" className="sr-only">
        {loading ? `Loading ${noun}` : `${rows.length} ${noun} loaded`}
      </p>
    </div>
  );
}

/** Neutral pill with a colour dot — colour never carries meaning alone. */
export function StatusPill({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "accent";
}) {
  const dot = {
    neutral: "bg-zinc-400",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
    accent: "bg-accent",
  }[tone];

  return (
    <span className="inline-flex items-center gap-1.5 border border-zinc-300 px-1.5 py-0.5 text-[11px] whitespace-nowrap text-zinc-700">
      <span aria-hidden className={`size-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
