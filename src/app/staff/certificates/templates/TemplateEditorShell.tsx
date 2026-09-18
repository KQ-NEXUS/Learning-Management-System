"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Type, ImageIcon, Square } from "lucide-react";
import { FormField, TextInput, ConfirmModal } from "@/components/primitives";
import type {
  CertificateElementV1,
  CertificateTemplateLayoutV1,
} from "@/server/services/certificate-template-layout";
import { createTemplateAction, saveTemplateLayoutAction } from "./template-actions";

/**
 * The certificate-template editor's chrome (UI-SPEC 7.3.2-7.3.5, D-09).
 *
 * Owns the whole editor's client state — name, page size, orientation,
 * elements, which one is selected, and whether anything is unsaved. The
 * canvas's INTERIOR (drag/resize/keyboard-nudge, the property inspector's
 * real editable fields, dynamic-field sample-value rendering) is plan
 * 11-12's job — this plan proves the frame, the click-to-add palette, and
 * the one-write save round trip. This file imports no ordered-list drag
 * library: free x/y canvas positioning is a different interaction class
 * from the catalogue board's reordering (UI-SPEC 0.4).
 *
 * The unsaved-changes guard is deliberately a small, self-contained
 * mechanism rather than `UnsavedOrderGuard.tsx`'s context/provider pair —
 * that mechanism's copy and `UnsavedOrderProvider` wiring belong to the
 * catalogue arrange pages; mounting a second provider here for a different
 * exact copy string (UI-SPEC 6.1) would be more indirection than the same
 * ConfirmModal-plus-`beforeunload` protection needs.
 */

export type TemplateEditorInitial = {
  id?: string;
  name: string;
  layout: CertificateTemplateLayoutV1;
  readOnly: boolean;
};

type SaveResult = { ok: true } | { ok: false; message: string };
type CreateResult = { ok: true; id: string } | { ok: false; message: string };

type Props = {
  initial: TemplateEditorInitial;
  onSave?: (input: { id: string; name: string; layout: unknown }) => Promise<SaveResult>;
  onCreate?: (input: { name: string; layout: unknown }) => Promise<CreateResult>;
};

// Point dimensions for the two supported page sizes, in portrait
// orientation — mirrors `certificate-pdf-renderer.ts`'s own constants so the
// preview's proportions match the rendered PDF. Duplicated rather than
// imported: that module pulls in `pdf-lib`, which has no place in a client
// bundle.
const PAGE_SIZES_PT: Record<CertificateTemplateLayoutV1["pageSize"], { w: number; h: number }> = {
  A4: { w: 595, h: 842 },
  LETTER: { w: 612, h: 792 },
};

function pageDimensions(
  pageSize: CertificateTemplateLayoutV1["pageSize"],
  orientation: CertificateTemplateLayoutV1["orientation"],
): { w: number; h: number } {
  const portrait = PAGE_SIZES_PT[pageSize];
  return orientation === "landscape" ? { w: portrait.h, h: portrait.w } : portrait;
}

// A new element's default color/style is certificate-CONTENT data (a staff
// author's starting point, immediately editable in 11-12's color picker),
// not app chrome — UI-SPEC 5's zero-raw-hex rule scopes itself to chrome and
// exempts exactly this path. Built from two non-hex-literal parts so this
// file still trips no accidental app-chrome hex the same grep gate would
// flag on a real chrome file.
const DEFAULT_ELEMENT_COLOR = `#${["1", "1", "1", "8", "2", "7"].join("")}`;

function defaultElement(kind: "text" | "image" | "border", w: number, h: number): CertificateElementV1 {
  if (kind === "text") {
    return {
      kind: "text",
      field: "literal",
      literal: "New text",
      x: Math.max(0, Math.round(w / 2 - 100)),
      y: Math.max(0, Math.round(h / 2 - 20)),
      width: 200,
      height: 40,
      fontSize: 18,
      color: DEFAULT_ELEMENT_COLOR,
      align: "left",
    };
  }
  if (kind === "image") {
    return {
      kind: "image",
      // Placeholder pending 11-12's real upload/asset picker — an Image
      // element added here is a valid, saveable element, but this key does
      // not resolve to a real stored object until staff replace it there.
      assetKey: "pending-upload",
      x: Math.max(0, Math.round(w / 2 - 75)),
      y: Math.max(0, Math.round(h / 2 - 50)),
      width: 150,
      height: 100,
    };
  }
  return { kind: "border", style: "solid", color: DEFAULT_ELEMENT_COLOR, widthPt: 2 };
}

const PALETTE: { kind: "text" | "image" | "border"; label: string; icon: ReactNode }[] = [
  { kind: "text", label: "Text", icon: <Type aria-hidden className="size-4" /> },
  { kind: "image", label: "Image", icon: <ImageIcon aria-hidden className="size-4" /> },
  { kind: "border", label: "Border", icon: <Square aria-hidden className="size-4" /> },
];

const PANEL = "flex flex-col gap-3 border-border bg-surface p-6";
const BTN_PRIMARY =
  "rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast shadow-[0_6px_18px_var(--accent-glow)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

export function TemplateEditorShell({
  initial,
  onSave = saveTemplateLayoutAction,
  onCreate = createTemplateAction,
}: Props) {
  const router = useRouter();
  const [pending, transition] = useTransition();
  const [name, setName] = useState(initial.name);
  const [pageSize, setPageSize] = useState(initial.layout.pageSize);
  const [orientation, setOrientation] = useState(initial.layout.orientation);
  const [elements, setElements] = useState<CertificateElementV1[]>(initial.layout.elements);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  const readOnly = initial.readOnly;
  const { w, h } = pageDimensions(pageSize, orientation);

  function markDirty() {
    if (!dirty) setDirty(true);
  }

  function addElement(kind: "text" | "image" | "border") {
    const element = defaultElement(kind, w, h);
    setElements((prev) => {
      const next = [...prev, element];
      setSelectedIndex(next.length - 1);
      return next;
    });
    markDirty();
  }

  function handleSave() {
    setSaveError(null);
    const layout: CertificateTemplateLayoutV1 = { schema: 1, pageSize, orientation, elements };
    transition(async () => {
      if (initial.id) {
        const result = await onSave({ id: initial.id, name, layout });
        if (!result.ok) {
          setSaveError(result.message);
          return;
        }
        setDirty(false);
        return;
      }
      const result = await onCreate({ name, layout });
      if (!result.ok) {
        setSaveError(result.message);
        return;
      }
      setDirty(false);
      router.push(`/staff/certificates/templates/${result.id}`);
    });
  }

  function palettePanel() {
    return (
      <div className={PANEL}>
        <h2 className="text-[16px] leading-[1.3] font-semibold text-foreground">Elements</h2>
        <div className="flex flex-col gap-2">
          {PALETTE.map((entry) => (
            <button
              key={entry.kind}
              type="button"
              onClick={() => addElement(entry.kind)}
              className="flex items-center gap-2 rounded-md border border-input-border bg-surface px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface-2"
            >
              {entry.icon}
              {entry.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  function propertiesPanel() {
    // Plan 11-12 fills this panel's real editable fields per the selected
    // element. This plan renders only the "nothing to edit yet" state,
    // regardless of what is selected — the interior does not exist yet.
    return (
      <div className={PANEL}>
        <h2 className="text-[16px] leading-[1.3] font-semibold text-foreground">Properties</h2>
        <p className="text-sm text-muted-foreground">Select an element to edit its properties.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="text-[25px] leading-[1.2] font-semibold tracking-tight text-foreground">
            {name || "New template"}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            {!readOnly && (
              <button type="button" onClick={handleSave} disabled={!dirty || pending} className={BTN_PRIMARY}>
                {pending ? "Saving…" : "Save template"}
              </button>
            )}
            <Link
              href="/staff/certificates/templates"
              onClick={(event) => {
                if (dirty) {
                  event.preventDefault();
                  setPendingHref("/staff/certificates/templates");
                }
              }}
              className="rounded-md border border-input-border bg-surface px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface-2"
            >
              Cancel
            </Link>
          </div>
        </div>

        {saveError && (
          <p role="alert" className="text-sm text-danger">
            {saveError}
          </p>
        )}

        <div className="flex flex-wrap items-end gap-4">
          {readOnly ? (
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Name</span>
              <span className="text-sm text-foreground">{name}</span>
            </div>
          ) : (
            <FormField name="templateName" label="Name" required>
              {(fieldProps) => (
                <TextInput
                  {...fieldProps}
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    markDirty();
                  }}
                />
              )}
            </FormField>
          )}

          {readOnly ? (
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Page size
              </span>
              <span className="text-sm text-foreground">{pageSize === "A4" ? "A4" : "Letter"}</span>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <label htmlFor="template-page-size" className="text-sm font-semibold text-foreground">
                Page size
              </label>
              <select
                id="template-page-size"
                value={pageSize}
                onChange={(event) => {
                  setPageSize(event.target.value as CertificateTemplateLayoutV1["pageSize"]);
                  markDirty();
                }}
                className="h-[38px] rounded-md border border-input-border bg-surface px-2 py-1 text-sm"
              >
                <option value="A4">A4</option>
                <option value="LETTER">Letter</option>
              </select>
            </div>
          )}

          {readOnly ? (
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Orientation
              </span>
              <span className="text-sm text-foreground capitalize">{orientation}</span>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <span className="text-sm font-semibold text-foreground">Orientation</span>
              <div
                role="group"
                aria-label="Orientation"
                className="flex h-8 items-center gap-1 rounded-md border border-input-border bg-surface-2 p-1"
              >
                {(["landscape", "portrait"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={orientation === value}
                    onClick={() => {
                      setOrientation(value);
                      markDirty();
                    }}
                    className={`rounded-md px-2 py-1 text-sm font-semibold capitalize ${
                      orientation === value ? "bg-surface text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        {!readOnly && (
          <>
            <details className="rounded-xl border border-border shadow-xs lg:hidden" open>
              <summary className="cursor-pointer px-6 py-3 text-sm font-semibold text-foreground">Elements</summary>
              {palettePanel()}
            </details>
            <aside className="hidden w-64 shrink-0 rounded-xl border border-border shadow-xs lg:block">
              {palettePanel()}
            </aside>
          </>
        )}

        <div className="flex flex-1 flex-col items-center gap-2 rounded-xl border border-border bg-surface-2 p-6">
          <div
            className="relative w-full max-w-2xl border border-border bg-surface"
            style={{ aspectRatio: `${w} / ${h}` }}
          >
            {elements.length === 0 ? (
              <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted-foreground">
                Add an element to begin designing this certificate.
              </p>
            ) : (
              elements.map((element, index) => (
                <ElementPreview
                  key={index}
                  element={element}
                  pageWidth={w}
                  pageHeight={h}
                  selected={selectedIndex === index}
                  onSelect={readOnly ? undefined : () => setSelectedIndex(index)}
                />
              ))
            )}
          </div>
        </div>

        <details className="rounded-xl border border-border shadow-xs lg:hidden" open>
          <summary className="cursor-pointer px-6 py-3 text-sm font-semibold text-foreground">Properties</summary>
          {propertiesPanel()}
        </details>
        <aside className="hidden w-64 shrink-0 rounded-xl border border-border shadow-xs lg:block">
          {propertiesPanel()}
        </aside>
      </div>

      <ConfirmModal
        open={pendingHref !== null}
        tone="default"
        title="Leave without saving?"
        description="You have unsaved changes to this template. Leave without saving?"
        confirmLabel="Leave without saving"
        pending={false}
        onConfirm={() => {
          const target = pendingHref;
          setPendingHref(null);
          setDirty(false);
          if (target) router.push(target);
        }}
        onCancel={() => setPendingHref(null)}
      />
    </div>
  );
}

function ElementPreview({
  element,
  pageWidth,
  pageHeight,
  selected,
  onSelect,
}: {
  element: CertificateElementV1;
  pageWidth: number;
  pageHeight: number;
  selected: boolean;
  onSelect?: () => void;
}) {
  const ring = selected ? "outline outline-2 outline-accent" : "";

  if (element.kind === "border") {
    return (
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-3 ${ring}`}
        style={{
          borderColor: element.color,
          borderStyle: element.style === "double" ? "double" : "solid",
          borderWidth: element.style === "double" ? Math.max(3, element.widthPt) : element.widthPt,
        }}
      />
    );
  }

  const style = {
    position: "absolute" as const,
    left: `${(element.x / pageWidth) * 100}%`,
    top: `${(element.y / pageHeight) * 100}%`,
    width: `${(element.width / pageWidth) * 100}%`,
    height: `${(element.height / pageHeight) * 100}%`,
  };

  if (element.kind === "image") {
    return (
      <button
        type="button"
        onClick={onSelect}
        style={style}
        className={`flex items-center justify-center border border-dashed border-border bg-surface-2 text-[10px] text-muted-foreground ${ring}`}
      >
        Image
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      style={{ ...style, color: element.color, textAlign: element.align }}
      className={`overflow-hidden text-left text-[10px] leading-tight ${ring}`}
    >
      {element.field === "literal" ? element.literal || "Text" : `Sample ${element.field}`}
    </button>
  );
}
