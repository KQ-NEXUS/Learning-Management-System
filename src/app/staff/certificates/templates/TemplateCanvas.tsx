"use client";

import { useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type PointerEvent } from "react";
import { X } from "lucide-react";
import type {
  CertificateElementV1,
  CertificateTemplateLayoutV1,
  CertificateTextField,
} from "@/server/services/certificate-template-layout";

/**
 * TemplateCanvas — the certificate-page preview: selection, pointer drag,
 * keyboard nudge, delete (UI-SPEC §7.3.4, plan 11-12 Task 1).
 *
 * A controlled component: `elements` and `selectedIndex` are owned by
 * `TemplateEditorShell`, this file never holds a second copy of the element
 * list. Every write goes back through `onChange` in PAGE UNITS (points),
 * never scaled screen pixels — positions/sizes render via CSS percentage
 * (relative to the page rectangle's own box, so no JS-computed scale factor
 * is needed there at all) and pointer-drag deltas are converted from pixels
 * back to page units using the container's measured width at drag start.
 *
 * `CertificateElementV1` has no id field (11-09's decision) — elements are
 * addressed by array index throughout, matching the shell's own state.
 *
 * No drag/canvas library is imported (UI-SPEC §0.4, T-11-SC) — pointer drag
 * is plain `onPointerDown`/`onPointerMove`/`onPointerUp` with
 * `setPointerCapture`, and `ArrangeBoard.tsx` is read only for its
 * "keyboard path is a first-class citizen, not a fallback" philosophy and its
 * `aria-live` announcement pattern, never imported.
 */

// Point dimensions for the two supported page sizes, in portrait
// orientation — mirrors `certificate-pdf-renderer.ts`'s own
// `A4_PORTRAIT_PT`/`LETTER_PORTRAIT_PT` constants exactly, so the canvas's
// aspect ratio matches the rendered PDF pixel-for-point. Duplicated rather
// than imported: that module pulls in `pdf-lib`, which has no place in a
// client bundle (the same reasoning `TemplateEditorShell.tsx` already
// documents for its own now-removed copy of this table).
const PAGE_SIZES_PT: Record<CertificateTemplateLayoutV1["pageSize"], { w: number; h: number }> = {
  A4: { w: 595.28, h: 841.89 },
  LETTER: { w: 612, h: 792 },
};

export function pageDimensions(
  pageSize: CertificateTemplateLayoutV1["pageSize"],
  orientation: CertificateTemplateLayoutV1["orientation"],
): { w: number; h: number } {
  const portrait = PAGE_SIZES_PT[pageSize];
  return orientation === "landscape" ? { w: portrait.h, h: portrait.w } : portrait;
}

// Mirrors `certificate-pdf-renderer.ts`'s exported `formatCertificateIssuedDate`
// exactly (same `Intl.DateTimeFormat` options) — duplicated for the identical
// "no pdf-lib in the client bundle" reason as the dimensions above, so the
// canvas's sample `issuedAt` value matches what actually prints.
function formatSampleIssuedDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

// A sample verification reference of the same shape/length real ones have —
// `certificate-reference.ts`'s `generateVerificationRef` produces
// `CERT-` + 32 uppercase hex characters (16 random bytes).
const SAMPLE_VERIFICATION_REF = "CERT-A1B2C3D4E5F60708A1B2C3D4E5F60708";

const FIELD_LABELS: Record<CertificateTextField, string> = {
  learnerName: "learner name",
  awardTitle: "award title",
  issuedAt: "issued date",
  verificationRef: "verification reference",
  literal: "custom text",
};

/** The placeholder `assetKey` a freshly-added image element carries until a
 * real asset is attached (11-09's decision) — never a real storage key. */
export const PENDING_UPLOAD_ASSET_KEY = "pending-upload";

function sampleTextValue(element: Extract<CertificateElementV1, { kind: "text" }>): string {
  switch (element.field) {
    case "literal":
      return element.literal || "Text";
    case "learnerName":
      return "Jordan Example";
    case "awardTitle":
      return "Sample Award Title";
    case "issuedAt":
      return formatSampleIssuedDate(new Date());
    case "verificationRef":
      return SAMPLE_VERIFICATION_REF;
    default:
      return "";
  }
}

function accessibleNameFor(element: CertificateElementV1): string {
  if (element.kind === "text") return `Text element: ${FIELD_LABELS[element.field]}`;
  if (element.kind === "image") return "Image element";
  return "Border";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/** Keeps a box's x/y fully within [0, pageWidth] x [0, pageHeight] — never
 * even partially off the page, which trivially satisfies "cannot be dragged
 * fully outside" while also never producing a negative value the parser's
 * `nonNegativeFinite` check would reject. */
function clampPosition(
  box: { x: number; y: number; width: number; height: number },
  pageWidth: number,
  pageHeight: number,
): { x: number; y: number } {
  const maxX = Math.max(0, pageWidth - box.width);
  const maxY = Math.max(0, pageHeight - box.height);
  return { x: clamp(box.x, 0, maxX), y: clamp(box.y, 0, maxY) };
}

type DragState = {
  pointerId: number;
  index: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  /** Pixels-per-page-unit, measured from the container's rendered width at
   * drag start. Only pointer drag needs this — keyboard nudge always moves
   * by a fixed number of PAGE units regardless of the container's on-screen
   * size, so it produces the identical emitted delta no matter how wide the
   * container is rendered. */
  scale: number;
};

export type TemplateCanvasProps = {
  elements: CertificateElementV1[];
  selectedIndex: number | null;
  pageSize: CertificateTemplateLayoutV1["pageSize"];
  orientation: CertificateTemplateLayoutV1["orientation"];
  readOnly: boolean;
  onChange: (elements: CertificateElementV1[]) => void;
  onSelect: (index: number | null) => void;
  /** Transient, client-only preview URLs keyed by `assetKey` (e.g. a
   * `URL.createObjectURL` result from a just-uploaded file). Never part of
   * the persisted layout — `CertificateElementV1` has no such field. */
  assetPreviewUrls?: Record<string, string>;
};

export function TemplateCanvas({
  elements,
  selectedIndex,
  pageSize,
  orientation,
  readOnly,
  onChange,
  onSelect,
  assetPreviewUrls,
}: TemplateCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const { w: pageWidth, h: pageHeight } = pageDimensions(pageSize, orientation);

  function applyPatch(index: number, patch: Record<string, unknown>) {
    const next = elements.map((element, i) =>
      i === index ? ({ ...element, ...patch } as CertificateElementV1) : element,
    );
    onChange(next);
  }

  function deleteElement(index: number) {
    onChange(elements.filter((_, i) => i !== index));
    if (selectedIndex === index) onSelect(null);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>, index: number) {
    if (readOnly) return;
    onSelect(index);
    const element = elements[index];
    if (element.kind === "border") return;
    const rect = containerRef.current?.getBoundingClientRect();
    const scale = rect && rect.width > 0 ? rect.width / pageWidth : 1;
    // Feature-detected, not assumed — jsdom (component tests) has no Pointer
    // Events capture implementation at all.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      index,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: element.x,
      startY: element.y,
      scale,
    };
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>, index: number) {
    const drag = dragRef.current;
    if (readOnly || !drag || drag.index !== index || drag.pointerId !== event.pointerId) return;
    const element = elements[index];
    if (element.kind === "border") return;
    const dxPt = (event.clientX - drag.startClientX) / drag.scale;
    const dyPt = (event.clientY - drag.startClientY) / drag.scale;
    const next = clampPosition(
      { x: drag.startX + dxPt, y: drag.startY + dyPt, width: element.width, height: element.height },
      pageWidth,
      pageHeight,
    );
    applyPatch(index, next);
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>, index: number) {
    const drag = dragRef.current;
    if (!drag || drag.index !== index || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>, index: number) {
    if (readOnly) return;
    const element = elements[index];

    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteElement(index);
      return;
    }

    // A border element has no x/y of its own (it draws inset from the page
    // edge) — nothing to nudge.
    if (element.kind === "border") return;

    const step = event.shiftKey ? 10 : 1;
    let dx = 0;
    let dy = 0;
    if (event.key === "ArrowLeft") dx = -step;
    else if (event.key === "ArrowRight") dx = step;
    else if (event.key === "ArrowUp") dy = -step;
    else if (event.key === "ArrowDown") dy = step;
    else return;

    event.preventDefault();
    const next = clampPosition(
      { x: element.x + dx, y: element.y + dy, width: element.width, height: element.height },
      pageWidth,
      pageHeight,
    );
    applyPatch(index, next);
    setAnnouncement(`${accessibleNameFor(element)} moved to ${Math.round(next.x)}, ${Math.round(next.y)}`);
  }

  function renderHandlesAndDelete(index: number, name: string) {
    // Corner resize-handle AFFORDANCES (UI-SPEC §7.3.4) — the actual resize
    // mechanism is the property inspector's Width/Height numeric inputs
    // (Task 2), which write through the same `onChange` these handles would;
    // these are a visual cue that the box is resizable, not a second
    // drag-resize implementation.
    const corners = ["-top-1 -left-1", "-top-1 -right-1", "-bottom-1 -left-1", "-bottom-1 -right-1"];
    return (
      <>
        {corners.map((position) => (
          <span
            key={position}
            aria-hidden
            className={`pointer-events-none absolute ${position} size-2 rounded-full border border-surface bg-accent`}
          />
        ))}
        <button
          type="button"
          aria-label={`Delete ${name}`}
          onClick={(event) => {
            event.stopPropagation();
            deleteElement(index);
          }}
          className="absolute -top-3 -right-3 flex size-6 items-center justify-center rounded-full border border-input-border bg-surface text-foreground hover:border-danger hover:text-danger focus:border-danger focus:text-danger focus:outline-none"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      </>
    );
  }

  function interactiveProps(index: number) {
    if (readOnly) return {};
    return {
      // `role="group"`, not `"button"` — the selected element's box contains
      // an actual nested `<button>` (the delete control), and a real button
      // nested inside a `role="button"` ancestor is an invalid/confusing
      // interactive-in-interactive pattern for assistive tech. `group` stays
      // focusable/keydown-able via `tabIndex` without that conflict, while
      // still giving every element a queryable role + accessible name.
      role: "group" as const,
      tabIndex: 0,
      onClick: () => onSelect(index),
      onFocus: () => onSelect(index),
      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => handleKeyDown(event, index),
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => handlePointerDown(event, index),
      onPointerMove: (event: PointerEvent<HTMLDivElement>) => handlePointerMove(event, index),
      onPointerUp: (event: PointerEvent<HTMLDivElement>) => handlePointerUp(event, index),
      onPointerCancel: (event: PointerEvent<HTMLDivElement>) => handlePointerUp(event, index),
      // Never let the browser start a native drag (ghost image / text drag):
      // it cancels the pointer-event drag above (UAT test 4).
      onDragStart: (event: DragEvent<HTMLDivElement>) => event.preventDefault(),
    };
  }

  /** Extra box classes for the interactive (non-readOnly) canvas: no text
   * selection and no browser touch panning stealing the pointer drag. */
  const dragSafe = readOnly ? "" : "select-none touch-none";

  function renderElement(element: CertificateElementV1, index: number) {
    const selected = selectedIndex === index;
    const name = accessibleNameFor(element);
    const ring = selected && !readOnly ? "outline outline-2 outline-accent" : "";

    if (element.kind === "border") {
      return (
        <div
          key={index}
          aria-label={name}
          {...interactiveProps(index)}
          className={`absolute inset-3 ${dragSafe} ${ring}`}
          style={{
            // See the UI-SPEC §5 exception comment on the text-element style
            // below — a border's own `color` is the same staff-authored
            // certificate CONTENT, exempted the same way.
            borderColor: element.color,
            borderStyle: element.style === "double" ? "double" : "solid",
            borderWidth: element.style === "double" ? Math.max(3, element.widthPt) : element.widthPt,
          }}
        >
          {selected && !readOnly && renderHandlesAndDelete(index, name)}
        </div>
      );
    }

    const boxStyle: CSSProperties = {
      position: "absolute",
      left: `${(element.x / pageWidth) * 100}%`,
      top: `${(element.y / pageHeight) * 100}%`,
      width: `${(element.width / pageWidth) * 100}%`,
      height: `${(element.height / pageHeight) * 100}%`,
    };

    if (element.kind === "image") {
      const previewUrl =
        element.assetKey !== PENDING_UPLOAD_ASSET_KEY ? assetPreviewUrls?.[element.assetKey] : undefined;
      return (
        <div
          key={index}
          aria-label={name}
          {...interactiveProps(index)}
          style={boxStyle}
          className={`flex items-center justify-center overflow-hidden border border-dashed border-border bg-surface-2 ${dragSafe} ${ring}`}
        >
          {previewUrl ? (
            // A client-only `URL.createObjectURL` blob preview, never a remote/staff-controlled URL worth routing through next/image.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt=""
              draggable={false}
              onDragStart={(event) => event.preventDefault()}
              className="pointer-events-none h-full w-full object-contain select-none"
            />
          ) : (
            <span className="px-2 text-center text-[10px] text-muted-foreground">No image attached</span>
          )}
          {selected && !readOnly && renderHandlesAndDelete(index, name)}
        </div>
      );
    }

    return (
      <div
        key={index}
        aria-label={name}
        {...interactiveProps(index)}
        style={{
          ...boxStyle,
          // The ONE place in this file `CertificateElementV1.color` reaches
          // an inline style — it is staff-authored certificate CONTENT, not
          // app chrome, and UI-SPEC §5 (carved out at §7.3.4) scopes the
          // zero-raw-hex rule to exclude exactly this value. A future
          // zero-raw-hex sweep must not "fix" this.
          color: element.color,
          textAlign: element.align,
          // Page-unit font size converted to container-query width units so
          // it scales with the page rectangle's own rendered size, matching
          // the element's actual `fontSize` proportionally rather than a
          // fixed screen-pixel guess.
          fontSize: `${(element.fontSize / pageWidth) * 100}cqw`,
        }}
        className={`overflow-hidden text-left leading-tight whitespace-pre ${dragSafe} ${ring}`}
      >
        {sampleTextValue(element)}
        {selected && !readOnly && renderHandlesAndDelete(index, name)}
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2">
      {/* Every keyboard and pointer position change is announced here,
          matching `ArrangeBoard.tsx`'s own announcement pattern. */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <div
        ref={containerRef}
        className="relative w-full max-w-2xl border border-border bg-surface [container-type:inline-size]"
        style={{ aspectRatio: `${pageWidth} / ${pageHeight}` }}
      >
        {elements.length === 0 ? (
          <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted-foreground">
            Add an element to begin designing this certificate.
          </p>
        ) : (
          elements.map((element, index) => renderElement(element, index))
        )}
      </div>
    </div>
  );
}
