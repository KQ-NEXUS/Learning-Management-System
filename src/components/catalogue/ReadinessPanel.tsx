import { useId } from "react";
import type {
  ReadinessCategory,
  ReadinessItem,
  ReadinessState,
} from "@/server/services/readiness-service";

/**
 * The shared readiness rendering (D-27).
 *
 * This component NEVER evaluates. It takes an already-evaluated
 * `ReadinessItem[]` — produced by the readiness-service on the server — and
 * only draws it. That is what makes "one shared component, one shared
 * evaluator" true rather than aspirational: the panel on the course detail
 * page and the summary inside the publish dialog render from the exact list
 * the server-side listing refusal checks against. Do not import or call the
 * evaluator here — pass its output in as `items`.
 */

/** The fixed PXR checklist order. Every heading renders even when empty — a
 * missing heading reads as "not applicable" when the truth is "not yet
 * checked" (D-26). */
const CATEGORY_ORDER: readonly ReadinessCategory[] = [
  "Content",
  "Schedule",
  "Price",
  "Capacity",
  "Instructors",
  "Completion",
];

type StatePresentation = {
  /** Shown as text, so no state is discoverable by colour alone (NFR-09). */
  label: string;
  glyph: string;
  className: string;
};

function statePresentation(item: ReadinessItem): StatePresentation {
  const state: ReadinessState = item.state;
  if (state === "PASS") {
    return { label: "Ready", glyph: "✓", className: "text-success" };
  }
  if (state === "FAIL") {
    return { label: "Not ready", glyph: "✗", className: "text-danger" };
  }
  if (state === "WARN") {
    return { label: "Warning", glyph: "!", className: "text-warning" };
  }
  // NOT_YET_CHECKED — a genuine third state: neither a grey tick nor a grey
  // cross. It carries a dot, never ✓ or ✗.
  return {
    label: `Not yet checked — ${item.deferredTo ?? "a later phase"}`,
    glyph: "•",
    className: "text-zinc-500",
  };
}

function itemsByCategory(items: ReadinessItem[], category: ReadinessCategory): ReadinessItem[] {
  return items.filter((entry) => entry.category === category);
}

function ReadinessRow({ item }: { item: ReadinessItem }) {
  const presentation = statePresentation(item);
  const blocking = item.blocking && item.state === "FAIL";

  return (
    <li
      data-testid={`readiness-item-${item.id}`}
      data-state={item.state}
      className="flex flex-col gap-0.5 border-b border-zinc-100 py-2 last:border-b-0"
    >
      <div className="flex items-baseline gap-2 text-sm">
        <span aria-hidden className={`font-mono ${presentation.className}`}>
          {presentation.glyph}
        </span>
        <span className="font-medium">
          {item.label}
          {blocking && (
            <span className="font-normal text-danger"> — blocks public listing</span>
          )}
        </span>
        <span className={`ml-auto text-xs font-medium ${presentation.className}`}>
          {presentation.label}
        </span>
      </div>
      {item.detail && <p className="pl-6 text-xs text-zinc-600">{item.detail}</p>}
    </li>
  );
}

export function ReadinessPanel({ items }: { items: ReadinessItem[] }) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 border border-zinc-200 bg-white p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="text-sm font-semibold tracking-tight">
          Publication readiness
        </h2>
        <ReadinessSummary items={items} />
      </div>

      <div className="flex flex-col gap-4">
        {CATEGORY_ORDER.map((category) => {
          const categoryItems = itemsByCategory(items, category);
          return (
            <div key={category} className="flex flex-col gap-1">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-600">
                {category}
              </h3>
              {categoryItems.length === 0 ? (
                <p className="text-xs text-zinc-400">Not yet checked — a later phase.</p>
              ) : (
                <ul className="flex flex-col">
                  {categoryItems.map((item) => (
                    <ReadinessRow key={item.id} item={item} />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function ReadinessSummary({ items }: { items: ReadinessItem[] }) {
  const blocking = items.filter((item) => item.blocking && item.state === "FAIL").length;
  const warnings = items.filter((item) => item.state === "WARN").length;
  const notYetChecked = items.filter((item) => item.state === "NOT_YET_CHECKED").length;

  return (
    <p className="text-xs text-zinc-600">
      {blocking} blocking, {warnings} {warnings === 1 ? "warning" : "warnings"}, {notYetChecked} not yet
      checked
    </p>
  );
}
