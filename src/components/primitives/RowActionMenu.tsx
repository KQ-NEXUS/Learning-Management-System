"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { EllipsisVertical } from "lucide-react";

/**
 * RowActionMenu: one three-dots button per table row that opens a menu of that
 * row's actions. It replaces a run of tiny text links, which were under 24px tall.
 *
 * Behaviour: the button opens the menu (Enter, Space, ArrowDown, or ArrowUp to land
 * on the last item); ArrowUp/ArrowDown/Home/End move between items; Escape and Tab
 * close it and return focus to the button; a click outside closes it. Choosing an
 * item closes the menu, puts focus back on the button, then runs the item, so a
 * dialog the item opens returns focus to the button when it closes.
 *
 * Items with `destructive` sort after a separator and read in the danger colour.
 * The menu is drawn in a portal with fixed positioning so a table's scroll box
 * cannot clip it.
 */

export type RowActionItem = {
  key: string;
  label: string;
  onSelect: () => void;
  destructive?: boolean;
};

type RowActionMenuProps = {
  /** Accessible name of the button, naming the row: "Actions for Ada Obi". */
  label: string;
  items: RowActionItem[];
  /** Also show the word "Actions" next to the icon (used on phones, where an icon alone is easy to miss). */
  showWordOnPhone?: boolean;
};

const MENU_WIDTH = 208;
const ITEM_HEIGHT = 44;

type Placement = { top?: number; bottom?: number; left: number; focus: "first" | "last" };

export function RowActionMenu({ label, items, showWordOnPhone = true }: RowActionMenuProps) {
  const [placement, setPlacement] = useState<Placement | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const ordered = [...items.filter((i) => !i.destructive), ...items.filter((i) => i.destructive)];
  const firstDestructive = ordered.findIndex((i) => i.destructive);
  const open = placement !== null;

  function openMenu(focus: "first" | "last") {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const estimated = ordered.length * ITEM_HEIGHT + 24;
    const below = window.innerHeight - rect.bottom;
    const left = Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
    setPlacement(
      below >= estimated || rect.top < estimated
        ? { top: rect.bottom + 4, left, focus }
        : { bottom: window.innerHeight - rect.top + 4, left, focus },
    );
  }

  function close(returnFocus: boolean) {
    setPlacement(null);
    if (returnFocus) buttonRef.current?.focus();
  }

  // Focus the first or last item as the menu appears.
  useEffect(() => {
    if (!placement) return;
    const nodes = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    if (!nodes?.length) return;
    (placement.focus === "last" ? nodes[nodes.length - 1] : nodes[0]).focus();
  }, [placement]);

  // Close on an outside press, and when the page scrolls or resizes (the menu is fixed to the screen).
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setPlacement(null);
    }
    const dismiss = () => setPlacement(null);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [open]);

  function onButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openMenu("first");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openMenu("last");
    }
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const nodes = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const index = nodes.indexOf(document.activeElement as HTMLElement);
    const move = (next: number) => {
      event.preventDefault();
      nodes[(next + nodes.length) % nodes.length]?.focus();
    };
    if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(nodes.length - 1);
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") {
      event.preventDefault();
      close(true);
    }
  }

  function choose(item: RowActionItem) {
    close(true);
    item.onSelect();
  }

  if (ordered.length === 0) return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={() => (open ? close(false) : openMenu("first"))}
        onKeyDown={onButtonKeyDown}
        className="inline-flex min-h-11 min-w-11 w-fit items-center justify-center gap-2 rounded-md border border-input-border bg-surface px-2 text-sm font-semibold text-foreground hover:bg-surface-2"
      >
        <EllipsisVertical aria-hidden className="size-5" />
        {showWordOnPhone && (
          <span aria-hidden className="sm:hidden">
            Actions
          </span>
        )}
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={label}
            onKeyDown={onMenuKeyDown}
            style={{ position: "fixed", top: placement.top, bottom: placement.bottom, left: placement.left, width: MENU_WIDTH }}
            className="z-[70] flex flex-col rounded-md border border-border bg-surface p-1 shadow-lg"
          >
            {ordered.map((item, index) => (
              <div key={item.key} role="none">
                {index === firstDestructive && index > 0 && (
                  <div role="separator" className="my-1 border-t border-border" />
                )}
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  onClick={() => choose(item)}
                  className={`flex min-h-11 w-full items-center rounded-md px-3 text-left text-sm font-medium hover:bg-surface-2 focus-visible:bg-surface-2 ${
                    item.destructive ? "text-danger" : "text-foreground"
                  }`}
                >
                  {item.label}
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
