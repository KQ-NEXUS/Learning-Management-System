"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import {
  DragDropContext,
  Draggable,
  Droppable,
  type DraggableProvided,
  type DroppableProvided,
  type DropResult,
} from "@hello-pangea/dnd";
import { useUnsavedOrder } from "./UnsavedOrderGuard";

/**
 * ArrangeBoard — the reusable course-structure board (D-19, D-20, D-21, D-34).
 *
 * Two entry points, ONE commit:
 *   - pointer / touch dragging via `@hello-pangea/dnd`
 *   - a keyboard path — "Move up" / "Move down" (and, across containers,
 *     "Move to previous / next module") buttons whose accessible names carry
 *     the item label
 * Both mutate the same proposed arrangement (`onArrangementChange`) and commit
 * through the same `onSave`. Nothing autosaves; "Save order" commits the whole
 * arrangement and is disabled until something changes (D-20).
 *
 * The `required` badge is READ-ONLY here — the toggle lives on the lesson form
 * (D-24). No rich-text-editor import belongs in this file; that bundle is the
 * lesson form's alone (plan 04-11).
 */

export type ArrangeItem = {
  id: string;
  label: string;
  sublabel?: string;
  /** Read-only, e.g. "Required" / "Optional". Rendered as a badge, never a control. */
  badge?: string;
};

export type ArrangeContainer = {
  id: string;
  label: string;
  items: ArrangeItem[];
};

export type WithdrawnEntry = {
  id: string;
  label: string;
  kind?: string;
};

export type ArrangeBoardProps = {
  containers: ArrangeContainer[];
  withdrawn?: WithdrawnEntry[];
  onArrangementChange: (next: ArrangeContainer[]) => void;
  onSave: () => void | Promise<void>;
  onRestore?: (id: string) => void | Promise<void>;
  saving?: boolean;
  /** True when `containers` differs from the last saved arrangement. */
  dirty?: boolean;
  error?: string | null;
  /** D-21: allow an item to be moved into a different container. */
  allowCrossContainer?: boolean;
  title?: string;
  /** Rendered next to a container's label — e.g. an "Add lesson" link. */
  renderContainerAction?: (containerId: string) => ReactNode;
  /**
   * Rendered after each item's Move controls — e.g. a "Remove from programme"
   * button (plan 04-13). Optional and backward-compatible: callers that do not
   * pass it get exactly today's board.
   */
  renderItemAction?: (item: ArrangeItem, containerId: string) => ReactNode;
  /** Shown when a container has no items. Defaults to the lesson-board copy. */
  emptyContainerLabel?: string;
};

type Loc = { droppableId: string; index: number };

/**
 * Pure: apply a source -> destination move and return a NEW containers array.
 * Returns the input array unchanged when the move is not applicable (unknown
 * container, out-of-range source). Both the drag handler and every keyboard
 * button route through this, so the two paths cannot diverge.
 */
export function moveItemInContainers(
  containers: ArrangeContainer[],
  source: Loc,
  destination: Loc,
): ArrangeContainer[] {
  const from = containers.find((c) => c.id === source.droppableId);
  const to = containers.find((c) => c.id === destination.droppableId);
  if (!from || !to) return containers;
  if (source.index < 0 || source.index >= from.items.length) return containers;

  const next = containers.map((c) => ({ ...c, items: [...c.items] }));
  const nextFrom = next.find((c) => c.id === source.droppableId)!;
  const nextTo = next.find((c) => c.id === destination.droppableId)!;
  const [moved] = nextFrom.items.splice(source.index, 1);
  const target = Math.max(0, Math.min(destination.index, nextTo.items.length));
  nextTo.items.splice(target, 0, moved);
  return next;
}

/**
 * The `onDragEnd`-equivalent handler, exposed so it can be exercised directly
 * with a `@hello-pangea/dnd` result object rather than synthesising pointer
 * physics. Returns `null` when the drop had no destination or landed exactly
 * where it started.
 */
export function arrangementFromDragResult(
  containers: ArrangeContainer[],
  result: DropResult,
): ArrangeContainer[] | null {
  if (!result.destination) return null;
  const { source, destination } = result;
  if (
    source.droppableId === destination.droppableId &&
    source.index === destination.index
  ) {
    return null;
  }
  return moveItemInContainers(containers, source, destination);
}

const ROW =
  "flex flex-wrap items-center gap-2 border border-zinc-200 bg-white px-2.5 py-1.5 text-sm";
const BTN =
  "border border-zinc-300 bg-white px-2 py-1 text-[11px] font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40";

export function ArrangeBoard({
  containers,
  withdrawn = [],
  onArrangementChange,
  onSave,
  onRestore,
  saving = false,
  dirty = false,
  error = null,
  allowCrossContainer = false,
  title,
  renderContainerAction,
  renderItemAction,
  emptyContainerLabel = "No lessons in this module yet.",
}: ArrangeBoardProps) {
  const { setDirty } = useUnsavedOrder();
  const boardKey = useId();
  const [announcement, setAnnouncement] = useState("");

  // D-22: push this board's dirty state into the shared guard, and clear it
  // when the board unmounts (navigating away, or a successful save).
  useEffect(() => {
    setDirty(dirty, boardKey);
    return () => setDirty(false, boardKey);
  }, [dirty, boardKey, setDirty]);

  function commit(next: ArrangeContainer[], movedId: string) {
    onArrangementChange(next);
    const container = next.find((c) => c.items.some((i) => i.id === movedId));
    if (!container) return;
    const index = container.items.findIndex((i) => i.id === movedId);
    const item = container.items[index];
    setAnnouncement(
      `${item.label} moved to position ${index + 1} of ${container.items.length} in ${container.label}`,
    );
  }

  function handleDragEnd(result: DropResult) {
    const next = arrangementFromDragResult(containers, result);
    if (next) commit(next, result.draggableId);
  }

  function move(
    containerId: string,
    index: number,
    destContainerId: string,
    destIndex: number,
  ) {
    const source = containers.find((c) => c.id === containerId);
    const item = source?.items[index];
    if (!item) return;
    const next = moveItemInContainers(
      containers,
      { droppableId: containerId, index },
      { droppableId: destContainerId, index: destIndex },
    );
    if (next === containers) return;
    commit(next, item.id);
  }

  return (
    <div className="flex flex-col gap-4">
      {title && (
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      )}

      {error && (
        <div
          role="alert"
          className="border border-danger/30 bg-danger-surface px-3 py-2 text-sm text-danger"
        >
          {error}
        </div>
      )}

      {/* Every keyboard and pointer move is announced here (D-19). */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <DragDropContext onDragEnd={handleDragEnd}>
        {containers.map((container, ci) => (
          <section key={container.id} className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-600">
                {container.label}
              </h3>
              {renderContainerAction?.(container.id)}
            </div>

            <Droppable droppableId={container.id}>
              {(dp: DroppableProvided) => (
                <ul
                  ref={dp.innerRef}
                  {...dp.droppableProps}
                  className="flex flex-col gap-1.5"
                >
                  {container.items.length === 0 && (
                    <li className="border border-dashed border-zinc-300 px-2.5 py-2 text-xs text-zinc-500">
                      {emptyContainerLabel}
                    </li>
                  )}
                  {container.items.map((item, index) => (
                    <Draggable key={item.id} draggableId={item.id} index={index}>
                      {(drag: DraggableProvided) => (
                        <li
                          ref={drag.innerRef}
                          {...drag.draggableProps}
                          className={ROW}
                        >
                          <span
                            {...drag.dragHandleProps}
                            aria-hidden
                            className="cursor-grab select-none text-zinc-400"
                          >
                            ⠿
                          </span>
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate font-medium">
                              {item.label}
                            </span>
                            {item.sublabel && (
                              <span className="truncate text-xs text-zinc-500">
                                {item.sublabel}
                              </span>
                            )}
                          </span>
                          {item.badge && (
                            <span className="border border-zinc-300 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
                              {item.badge}
                            </span>
                          )}
                          <span className="flex flex-wrap gap-1">
                            <button
                              type="button"
                              className={BTN}
                              disabled={index === 0}
                              aria-label={`Move ${item.label} up`}
                              onClick={() =>
                                move(container.id, index, container.id, index - 1)
                              }
                            >
                              Move up
                            </button>
                            <button
                              type="button"
                              className={BTN}
                              disabled={index === container.items.length - 1}
                              aria-label={`Move ${item.label} down`}
                              onClick={() =>
                                move(container.id, index, container.id, index + 1)
                              }
                            >
                              Move down
                            </button>
                            {allowCrossContainer && (
                              <>
                                <button
                                  type="button"
                                  className={BTN}
                                  disabled={ci === 0}
                                  aria-label={`Move ${item.label} to previous module`}
                                  onClick={() =>
                                    move(
                                      container.id,
                                      index,
                                      containers[ci - 1].id,
                                      containers[ci - 1].items.length,
                                    )
                                  }
                                >
                                  Move to previous module
                                </button>
                                <button
                                  type="button"
                                  className={BTN}
                                  disabled={ci === containers.length - 1}
                                  aria-label={`Move ${item.label} to next module`}
                                  onClick={() =>
                                    move(
                                      container.id,
                                      index,
                                      containers[ci + 1].id,
                                      containers[ci + 1].items.length,
                                    )
                                  }
                                >
                                  Move to next module
                                </button>
                              </>
                            )}
                            {renderItemAction?.(item, container.id)}
                          </span>
                        </li>
                      )}
                    </Draggable>
                  ))}
                  {dp.placeholder}
                </ul>
              )}
            </Droppable>
          </section>
        ))}
      </DragDropContext>

      <div>
        <button
          type="button"
          onClick={() => onSave()}
          disabled={!dirty || saving}
          className="bg-accent px-3 py-1.5 text-xs font-medium text-accent-contrast hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save order"}
        </button>
      </div>

      {withdrawn.length > 0 && (
        <details className="border border-zinc-200 bg-zinc-50/60 px-3 py-2">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-zinc-600">
            Withdrawn ({withdrawn.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {withdrawn.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center gap-2 text-sm"
              >
                <span className="flex-1 truncate">{entry.label}</span>
                {entry.kind && (
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                    {entry.kind}
                  </span>
                )}
                {onRestore && (
                  <button
                    type="button"
                    className={BTN}
                    onClick={() => onRestore(entry.id)}
                  >
                    Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
