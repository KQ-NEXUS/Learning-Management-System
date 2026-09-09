"use client";

import Link from "next/link";
import { useEffect, useId, useRef, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Plus,
  Search,
  X,
} from "lucide-react";

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
  actions: {
    label: string;
    onClick: (ids: string[]) => void;
    disabled?: boolean;
    description?: string;
  }[];
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
  /**
   * Overrides the unfiltered-empty heading (default: "No {noun} yet"). Screens
   * with a UI-SPEC-mandated exact heading that does not read naturally off
   * `noun` (e.g. Sessions: "No sessions scheduled") pass this.
   */
  emptyHeading?: string;
};

const CELL = "px-4 py-2 align-middle";
const HEAD =
  "px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";
const BTN =
  "rounded-md border border-input-border bg-surface px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface-2";
const BTN_PRIMARY =
  "rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast shadow-[0_6px_18px_var(--accent-glow)] hover:opacity-90";

function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-xl border border-border bg-surface px-6 py-12 shadow-xs">
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

/**
 * Per-row leading tile — a visual anchor, not information (T-04.1-09). It
 * derives its tone and initials from a value the primary column already
 * renders in full, so it discloses nothing the row does not already show,
 * and is always rendered `aria-hidden`.
 */
const TILE_TONE_CLASSES = {
  blue: "bg-pill-blue-bg text-pill-blue-ink",
  green: "bg-pill-green-bg text-pill-green-ink",
  amber: "bg-pill-amber-bg text-pill-amber-ink",
  grey: "bg-pill-grey-bg text-pill-grey-ink",
} as const;
const TILE_TONE_KEYS = Object.keys(
  TILE_TONE_CLASSES,
) as (keyof typeof TILE_TONE_CLASSES)[];

/** Deterministic per-row tone so the same record always gets the same tile color. */
function tileToneFor(seed: string): keyof typeof TILE_TONE_CLASSES {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return TILE_TONE_KEYS[Math.abs(hash) % TILE_TONE_KEYS.length];
}

/** First letter of up to two words. */
function initialsFor(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
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
  emptyHeading,
}: ResourceTableProps<T>) {
  const controlId = useId();
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
    <div className="flex flex-col gap-4">
      {(title || headerActions || shownCount !== undefined) && (
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            {title && (
              <h2 className="text-base font-semibold tracking-tight text-foreground">
                {title}
              </h2>
            )}
            {shownCount !== undefined && (
              <p className="text-sm text-muted-foreground">
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
        <div className="flex flex-wrap items-center gap-4 rounded-md border border-border bg-surface-2/60 px-4 py-2">
          {filters.map((filter, index) => {
            const filterId = `${controlId}-filter-${index}`;
            // A small option count lays out as the mockup's segmented
            // control; a filter with too many options to fit inline falls
            // back to the existing <select>. Either way this is a rendering
            // change only — both paths call the same onFilterChange prop,
            // so filters/sort keep reading from and writing to the URL.
            const isSegmented =
              filter.kind === "select" && filter.options.length <= 4;

            return (
              <div key={filter.name} className="flex items-center gap-2">
                <label htmlFor={isSegmented ? undefined : filterId} className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {filter.label}
                </label>
                {filter.kind === "search" ? (
                  <div className="relative flex items-center">
                    <Search
                      aria-hidden
                      className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground"
                    />
                    <input
                      id={filterId}
                      type="text"
                      value={filter.value}
                      placeholder={filter.placeholder}
                      onChange={(e) =>
                        onFilterChange?.(filter.name, e.target.value)
                      }
                      className="h-[38px] rounded-md border border-input-border bg-surface py-1 pr-2 pl-8 text-sm"
                    />
                  </div>
                ) : isSegmented ? (
                  <div
                    role="group"
                    aria-label={filter.label}
                    className="flex h-8 items-center gap-1 rounded-md border border-input-border bg-surface-2 p-1"
                  >
                    {filter.options.map((option) => {
                      const active = option.value === filter.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={active}
                          onClick={() =>
                            onFilterChange?.(filter.name, option.value)
                          }
                          className={`rounded-md px-2 py-1 text-sm font-semibold ${
                            active
                              ? "bg-surface text-foreground shadow-xs"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <select
                    id={filterId}
                    value={filter.value}
                    onChange={(e) =>
                      onFilterChange?.(filter.name, e.target.value)
                    }
                    className="h-[38px] rounded-md border border-input-border bg-surface px-2 py-1 text-sm"
                  >
                    {filter.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}

          {activeQuery && (
            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 font-mono text-[11px] text-muted-foreground">
              {activeQuery}
              <button
                type="button"
                onClick={onClearFilters}
                aria-label="Clear all filters"
                className="text-muted-foreground hover:text-foreground"
              >
                <X aria-hidden className="size-3" />
              </button>
            </span>
          )}

          {onClearFilters && (
            <button
              type="button"
              onClick={onClearFilters}
              className="ml-auto text-sm text-accent underline underline-offset-2"
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
      <div className="flex flex-col gap-4">
        {title && (
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        )}
        <Panel>
          <span className="font-mono text-[11px] tracking-wide text-muted-foreground">403</span>
          <p className="text-sm font-semibold text-foreground">
            You do not have access to {noun}
          </p>
          <p className="max-w-prose text-sm text-muted-foreground">
            Your role does not include{" "}
            {state.permission ? (
              <code className="rounded-sm bg-surface-2 px-1 font-mono text-[11px]">
                {state.permission}
              </code>
            ) : (
              "the required permission"
            )}{" "}
            at this scope. Ask a workspace administrator to grant it.
          </p>
          <p className="text-sm text-muted-foreground">
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
      <div className="flex flex-col gap-4">
        {header}
        <Panel>
          <p className="text-sm font-semibold text-foreground">
            Could not load {noun}
          </p>
          <p className="max-w-prose text-sm text-muted-foreground">
            {state.message ??
              "The request timed out. Your filters and sort are kept in the URL, so retrying returns to exactly this view."}
          </p>
          {onRetry && (
            <button type="button" onClick={onRetry} className={BTN}>
              Retry
            </button>
          )}
          {(state.trace || state.attempt) && (
            <p className="font-mono text-[11px] text-muted-foreground">
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
      <div className="flex flex-col gap-4">
        {header}
        <Panel>
          <p className="text-sm font-semibold text-foreground">
            {filtered ? `No ${noun} match these filters` : (emptyHeading ?? `No ${noun} yet`)}
          </p>
          <p className="max-w-prose text-sm text-muted-foreground">
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
              <button
                type="button"
                onClick={onCreate}
                className={`inline-flex items-center gap-1 ${BTN_PRIMARY}`}
              >
                <Plus aria-hidden className="size-3.5" />
                {createLabel ?? `New ${noun.replace(/s$/, "")}`}
              </button>
            )}
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {header}

      {validationError && (
        <div
          role="alert"
          className="border border-danger/30 bg-danger-surface px-4 py-2 text-sm text-danger"
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
        <div className="flex flex-wrap items-center gap-4 rounded-md border border-accent/30 bg-accent/5 px-4 py-2">
          <span className="text-sm font-semibold text-accent">
            {selectedCount} selected
          </span>
          {selection.actions.map((action, index) => (
            <div key={action.label} className="flex flex-col gap-1">
            <button
              type="button"
              disabled={action.disabled}
              aria-describedby={action.description ? `${controlId}-action-${index}` : undefined}
              onClick={() => action.onClick(selection.selectedIds)}
              className="text-sm font-semibold text-foreground underline underline-offset-2 hover:text-accent disabled:cursor-not-allowed disabled:no-underline disabled:opacity-60"
            >
              {action.label}
            </button>
            {action.description && (
              <p id={`${controlId}-action-${index}`} className="text-sm text-muted-foreground">
                {action.description}
              </p>
            )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => selection.onChange([])}
            className="ml-auto text-sm text-muted-foreground underline underline-offset-2"
          >
            Deselect
          </button>
        </div>
      )}

      {/* Table — hidden below 640px in favour of the card list. Container is a
          16px-radius card on the low (dense-surface) shadow; the table is clipped
          to that radius so the first/last rows don't square off the corners. */}
      <div className="hidden rounded-xl border border-border bg-surface shadow-xs sm:block">
        <table className="w-full border-collapse overflow-hidden rounded-xl text-sm">
          <caption className="sr-only">
            {loading ? `Loading ${noun}` : `${rows.length} ${noun}`}
          </caption>
          <colgroup>
            {selection && <col style={{ width: "2.5rem" }} />}
            {columns.map((c) => (
              <col key={c.key} style={c.width ? { width: c.width } : undefined} />
            ))}
          </colgroup>
          <thead className="bg-surface-2">
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
                        className="inline-flex items-center gap-1 uppercase hover:text-foreground"
                      >
                        {c.header}
                        <span aria-hidden className="text-muted-foreground">
                          {sorted ? (
                            sort.direction === "asc" ? (
                              <ArrowUp className="size-3" />
                            ) : (
                              <ArrowDown className="size-3" />
                            )
                          ) : (
                            <ArrowUpDown className="size-3" />
                          )}
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
                  <tr key={i} className="border-t border-border">
                    {selection && (
                      <td className={CELL}>
                        <span className="block size-3.5 animate-pulse rounded-sm bg-surface-2" />
                      </td>
                    )}
                    {columns.map((c) => (
                      <td key={c.key} className={CELL}>
                        <span className="block h-3 w-full max-w-[12rem] animate-pulse rounded-sm bg-surface-2" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row) => {
                  const id = getRowKey(row);
                  const href = getRowHref?.(row);
                  const checked = selection?.selectedIds.includes(id) ?? false;
                  const rowLabel = getRowLabel?.(row) ?? id;
                  const tileClasses = TILE_TONE_CLASSES[tileToneFor(id)];
                  const initials = initialsFor(rowLabel);
                  return (
                    <tr
                      key={id}
                      className="border-t border-border hover:bg-surface-2"
                    >
                      {selection && (
                        <td className={CELL}>
                          <input
                            type="checkbox"
                            checked={checked}
                            aria-label={`Select ${rowLabel}`}
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
                      {columns.map((c, i) =>
                        i === 0 ? (
                          <td
                            key={c.key}
                            className={`${CELL} ${c.mono ? "font-mono text-sm tabular-nums" : ""}`}
                          >
                            <span className="flex items-center gap-2">
                              <span
                                aria-hidden
                                className={`flex size-[34px] shrink-0 items-center justify-center rounded-md text-[11px] font-semibold ${tileClasses}`}
                              >
                                {initials}
                              </span>
                              <span className="flex flex-col gap-1">
                                {href ? (
                                  <Link
                                    href={href}
                                    className="font-semibold text-foreground underline-offset-2 hover:underline"
                                  >
                                    {c.render(row)}
                                  </Link>
                                ) : (
                                  c.render(row)
                                )}
                                {c.subtitle && (
                                  <span className="text-[11px] text-muted-foreground">
                                    {c.subtitle(row)}
                                  </span>
                                )}
                              </span>
                            </span>
                          </td>
                        ) : (
                          <td
                            key={c.key}
                            className={`${CELL} ${
                              c.align === "right" ? "text-right" : ""
                            } ${c.mono ? "font-mono text-sm tabular-nums" : ""}`}
                          >
                            <span className="flex flex-col gap-1">
                              {c.render(row)}
                              {c.subtitle && (
                                <span className="text-[11px] text-muted-foreground">
                                  {c.subtitle(row)}
                                </span>
                              )}
                            </span>
                          </td>
                        ),
                      )}
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
              <li
                key={i}
                className="rounded-xl border border-border bg-surface p-4 shadow-xs"
              >
                <span className="block h-3 w-32 animate-pulse rounded-sm bg-surface-2" />
              </li>
            ))
          : rows.map((row) => {
              const href = getRowHref?.(row);
              const primary =
                columns.find((c) => c.key === primaryColumnKey) ?? columns[0];
              const rest = columns.filter(
                (c) => c.key !== primary.key && !c.hideOnMobile,
              );
              const rowLabel = getRowLabel?.(row) ?? getRowKey(row);
              const tileClasses = TILE_TONE_CLASSES[tileToneFor(getRowKey(row))];
              const initials = initialsFor(rowLabel);
              return (
                <li
                  key={getRowKey(row)}
                  className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 shadow-xs"
                >
                  <div className="flex items-center gap-2">
                    {selection && (
                      <input
                        type="checkbox"
                        checked={selection.selectedIds.includes(getRowKey(row))}
                        aria-label={`Select ${rowLabel}`}
                        onChange={(e) =>
                          selection.onChange(
                            e.target.checked
                              ? [...selection.selectedIds, getRowKey(row)]
                              : selection.selectedIds.filter((id) => id !== getRowKey(row)),
                          )
                        }
                        className="size-3.5 accent-accent"
                      />
                    )}
                    <span
                      aria-hidden
                      className={`flex size-[34px] shrink-0 items-center justify-center rounded-md text-[11px] font-semibold ${tileClasses}`}
                    >
                      {initials}
                    </span>
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-semibold text-foreground">
                        {href ? (
                          <Link
                            href={href}
                            className="underline underline-offset-2"
                          >
                            {primary.render(row)}
                          </Link>
                        ) : (
                          primary.render(row)
                        )}
                      </span>
                      {primary.subtitle && (
                        <span className="text-[11px] text-muted-foreground">
                          {primary.subtitle(row)}
                        </span>
                      )}
                    </div>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    {rest.map((c) => (
                      <div key={c.key} className="flex flex-col">
                        <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
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

/**
 * Tinted pill — tint background, deep-ink label, mid-tone dot as pure visual
 * reinforcement. The label text (not the dot) carries the meaning: every
 * tone's ink-on-tint pair clears 4.5:1 (UI-SPEC 5.4), so no WCAG 1.4.11
 * exemption is claimed or needed here.
 */
export function StatusPill({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "accent";
}) {
  const classes = {
    neutral: "bg-pill-grey-bg text-pill-grey-ink",
    success: "bg-pill-green-bg text-pill-green-ink",
    warning: "bg-pill-amber-bg text-pill-amber-ink",
    danger: "bg-pill-red-bg text-pill-red-ink",
    accent: "bg-pill-blue-bg text-pill-blue-ink",
  }[tone];
  const dot = {
    neutral: "bg-pill-grey-dot",
    success: "bg-pill-green-dot",
    warning: "bg-pill-amber-dot",
    danger: "bg-pill-red-dot",
    accent: "bg-pill-blue-dot",
  }[tone];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold whitespace-nowrap ${classes}`}
    >
      <span aria-hidden className={`size-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
