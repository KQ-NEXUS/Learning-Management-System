"use client";

import Link from "next/link";
import { PageHeader } from "@/components/shell/PageHeader";
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
      /** Force the plain dropdown even when there are few enough options for a segmented control. */
      variant?: "select";
    }
  | {
      /** A tab strip above the table (e.g. status with counts). One value is active at a time. */
      kind: "tabs";
      name: string;
      label: string;
      value: string;
      options: { value: string; label: string; count?: number }[];
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
  /**
   * True on a top-level list page: the title is drawn as the page's h1 in the navy band
   * (PageHeader) instead of an in-flow h2. Leave false for tables embedded in a tab or card.
   */
  asPage?: boolean;
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

const CELL = "px-3 py-4 align-middle first:pl-0 last:pr-0 lg:px-4";
const HEAD =
  "px-3 py-3 text-left text-[13px] font-medium text-muted-foreground first:pl-0 last:pr-0 lg:px-4";
const BTN =
  "rounded-md border border-input-border bg-surface px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface-2";
const BTN_PRIMARY =
  "rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast hover:bg-accent-deep";

function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="flex max-w-[640px] flex-col items-start gap-3 border-t border-foreground pt-12 pb-3">
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
  asPage = false,
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
      {asPage && title ? (
        <PageHeader
          title={title}
          subtitle={
            // The count only earns its place once a filter narrows the list.
            shownCount !== undefined && totalCount !== undefined && shownCount !== totalCount
              ? `${shownCount} of ${totalCount}`
              : undefined
          }
          actions={headerActions}
        />
      ) : (
        (title || headerActions || shownCount !== undefined) && (
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
                </p>
              )}
            </div>
            {headerActions && (
              <div className="flex flex-wrap gap-2">{headerActions}</div>
            )}
          </div>
        )
      )}

      {filters?.map((filter) =>
        filter.kind === "tabs" ? (
          <div
            key={filter.name}
            role="group"
            aria-label={filter.label}
            className="flex gap-8 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {filter.options.map((option) => {
              const active = option.value === filter.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onFilterChange?.(filter.name, option.value)}
                  className={`-mb-px shrink-0 border-b-2 pb-3 font-medium whitespace-nowrap ${
                    active
                      ? "border-accent font-semibold text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {option.label}
                  {option.count !== undefined && (
                    <span className="ml-2 font-normal tabular-nums">{option.count}</span>
                  )}
                </button>
              );
            })}
          </div>
        ) : null,
      )}

      {filters && filters.some((f) => f.kind !== "tabs") && (
        <div className="flex flex-wrap items-center gap-4 pb-2">
          {filters.filter((f) => f.kind !== "tabs").map((filter, index) => {
            const filterId = `${controlId}-filter-${index}`;
            // A small option count lays out as the mockup's segmented
            // control; a filter with too many options to fit inline falls
            // back to the existing <select>. Either way this is a rendering
            // change only — both paths call the same onFilterChange prop,
            // so filters/sort keep reading from and writing to the URL.
            const isSegmented =
              filter.kind === "select" && filter.variant !== "select" && filter.options.length <= 4;

            return (
              <div key={filter.name} className="flex items-center gap-2">
                <label
                  htmlFor={isSegmented ? undefined : filterId}
                  className={filter.kind === "search" ? "sr-only" : "text-[13px] text-muted-foreground"}
                >
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
                      className="h-11 w-[340px] max-w-full rounded-md border border-input-border bg-surface py-1 pr-2 pl-8 text-sm"
                    />
                  </div>
                ) : isSegmented ? (
                  <div
                    role="group"
                    aria-label={filter.label}
                    className="flex h-8 max-w-full items-center gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden rounded-md border border-input-border bg-surface-2 p-1"
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
                          className={`shrink-0 rounded-md px-2 py-1 text-sm font-semibold whitespace-nowrap ${
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
            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs text-muted-foreground">
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
          <span className="font-mono text-sm text-muted-foreground">403</span>
          <h2 className="text-[36px] leading-[1.1] font-bold tracking-[-0.035em] text-foreground">
            You do not have access to {noun}
          </h2>
          <p className="max-w-prose text-base text-foreground-soft">
            Your role does not include{" "}
            {state.permission ? (
              <code className="rounded-sm bg-accent-wash px-2 font-mono text-sm">
                {state.permission}
              </code>
            ) : (
              "the required permission"
            )}{" "}
            at this scope. Ask a workspace administrator to grant it.
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
            <p className="font-mono text-xs text-muted-foreground">
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
          <h2 className="text-[36px] leading-[1.1] font-bold tracking-[-0.035em] text-foreground">
            {filtered ? `No ${noun} match these filters` : (emptyHeading ?? `No ${noun} yet`)}
          </h2>
          <p className="max-w-[480px] text-base text-muted-foreground">
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
          {/* The board repeats the page's main action inside the empty panel, so a first-time
              visitor sees what to do next right where the list would be. */}
          {!filtered && headerActions && <div className="flex flex-wrap gap-3 pt-3">{headerActions}</div>}
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

      {/* Table — hidden below 640px in favour of the stacked row list; scrolls
          sideways inside its own box rather than the page if it ever overflows. */}
      <div className="hidden overflow-x-auto sm:block">
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
          <thead className="border-b border-foreground">
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
                        className="inline-flex items-center gap-1 hover:text-foreground"
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
                            className={`${CELL} ${c.mono ? "font-mono text-sm whitespace-nowrap tabular-nums" : ""}`}
                          >
                            <span className="flex items-center gap-2">
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
                                  <span className="text-xs text-muted-foreground">
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
                            } ${c.mono ? "font-mono text-sm whitespace-nowrap tabular-nums" : ""}`}
                          >
                            <span className="flex flex-col gap-1">
                              {c.render(row)}
                              {c.subtitle && (
                                <span className="text-xs text-muted-foreground">
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
      <ul className="flex flex-col sm:hidden">
        {loading
          ? Array.from({ length: 3 }, (_, i) => (
              <li key={i} className="border-b border-border py-4">
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
              return (
                <li
                  key={getRowKey(row)}
                  className="flex flex-col gap-2 border-b border-border py-4"
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
                        <span className="text-xs text-muted-foreground">
                          {primary.subtitle(row)}
                        </span>
                      )}
                    </div>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    {rest.map((c) => (
                      <div key={c.key} className="flex flex-col">
                        <dt className="text-xs text-muted-foreground">
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
 * Status — coloured text with a leading dot, no tinted background. The label
 * carries the meaning; the dot only reinforces it (and inherits the text
 * colour via `currentColor`). Every tone's ink clears 4.5:1 on white. The
 * component keeps its old name and props so its 30+ call sites need no change.
 */
export function StatusPill({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "accent";
}) {
  const ink = {
    neutral: "text-pill-grey-ink",
    success: "text-pill-green-ink",
    warning: "text-pill-amber-ink",
    danger: "text-pill-red-ink",
    accent: "text-pill-blue-ink",
  }[tone];

  return (
    <span
      data-tone={tone}
      className={`inline-flex items-center text-sm font-medium whitespace-nowrap ${ink}`}
    >
      <span aria-hidden className="mr-2 size-[7px] shrink-0 rounded-full bg-current" />
      {label}
    </span>
  );
}
