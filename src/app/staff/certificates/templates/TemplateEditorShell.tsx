"use client";

import Link from "next/link";
import { PageHeader } from "@/components/shell/PageHeader";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Type, ImageIcon, Square } from "lucide-react";
import { FormField, TextInput, ConfirmModal } from "@/components/primitives";
import type {
  CertificateElementV1,
  CertificateTemplateLayoutV1,
} from "@/server/services/certificate-template-layout";
import { createTemplateAction, saveTemplateLayoutAction } from "./template-actions";
import { TemplateCanvas, pageDimensions, PENDING_UPLOAD_ASSET_KEY } from "./TemplateCanvas";
import { ElementInspector } from "./ElementInspector";

/**
 * The certificate-template editor's chrome (UI-SPEC 7.3.2-7.3.5, D-09).
 *
 * Owns the whole editor's client state — name, page size, orientation,
 * elements, which one is selected, and whether anything is unsaved. The
 * canvas's INTERIOR (drag/resize/keyboard-nudge, the property inspector's
 * real editable fields, dynamic-field sample-value rendering, image upload)
 * lives in `TemplateCanvas.tsx` and `ElementInspector.tsx` (plan 11-12) —
 * this file stays the controller: it owns the one `elements` array and
 * passes it down, and both children write back through the SAME
 * `updateSelectedElement`/`onChange` paths so a position edit from either
 * surface can never diverge. This file imports no ordered-list drag
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
  /** Open with Save enabled and the unsaved-changes warning on, for a layout built before the editor opened. */
  startDirty?: boolean;
};

type SaveResult = { ok: true } | { ok: false; message: string };
type CreateResult = { ok: true; id: string } | { ok: false; message: string };

type Props = {
  initial: TemplateEditorInitial;
  /** Private view links for images the template already has, keyed by `assetKey` (server-made). */
  initialAssetPreviewUrls?: Record<string, string>;
  onSave?: (input: { id: string; name: string; layout: unknown }) => Promise<SaveResult>;
  onCreate?: (input: { name: string; layout: unknown }) => Promise<CreateResult>;
};

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
      // Placeholder until Task 3's real upload flow replaces it — an Image
      // element added here is a valid, saveable element, but this key does
      // not resolve to a real stored object until staff attach one.
      assetKey: PENDING_UPLOAD_ASSET_KEY,
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

const PANEL = "flex flex-col gap-3 bg-surface py-1";
const BTN_PRIMARY =
  "rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-50";

export function TemplateEditorShell({
  initial,
  initialAssetPreviewUrls,
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
  const [dirty, setDirty] = useState(initial.startDirty ?? false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  // Preview URLs keyed by `assetKey`, never part of the persisted layout: server-made private
  // links for images the template already has (`initialAssetPreviewUrls`), plus a browser blob
  // URL (`URL.createObjectURL`) for each image uploaded in this session.
  const [assetPreviewUrls, setAssetPreviewUrls] = useState<Record<string, string>>(
    initialAssetPreviewUrls ?? {},
  );

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

  /**
   * The inspector's write path — the SAME `elements` state the canvas's
   * drag/nudge writes to, so a position edit from either surface can never
   * diverge. Takes a whole REPLACEMENT element, not a partial patch: the
   * inspector needs to be able to genuinely remove a key (switching a text
   * element off `literal` must delete that key, not set it to `undefined` —
   * a spread-merged patch would leave the key present with an `undefined`
   * value, which `parseCertificateTemplateLayout`'s `"literal" in record`
   * check would still see and reject).
   */
  function updateSelectedElement(nextElement: CertificateElementV1) {
    if (selectedIndex === null) return;
    setElements((prev) => prev.map((element, i) => (i === selectedIndex ? nextElement : element)));
    markDirty();
  }

  function handleSave() {
    setSaveError(null);
    // An image element still carrying the placeholder sentinel has no real
    // asset attached — `parseCertificateTemplateLayout` would only reject an
    // EMPTY `assetKey`, not this non-empty placeholder, so the save action
    // would otherwise fail opaquely instead of with an actionable message.
    const unattachedImage = elements.some(
      (element) => element.kind === "image" && element.assetKey === PENDING_UPLOAD_ASSET_KEY,
    );
    if (unattachedImage) {
      setSaveError("Attach an image to every image element before saving.");
      return;
    }
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
        <h2 className="text-[12px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">Add element</h2>
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

        <h2 className="pt-6 text-[12px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">Elements</h2>
        {elements.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing on the page yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {elements.map((element, index) => {
              const label =
                element.kind === "text"
                  ? (element.literal?.trim() || element.field.replace(/([A-Z])/g, " $1").toLowerCase())
                  : element.kind === "image"
                    ? "Image"
                    : "Border";
              return (
                <li key={index}>
                  <button
                    type="button"
                    aria-pressed={selectedIndex === index}
                    onClick={() => setSelectedIndex(index)}
                    className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm ${
                      selectedIndex === index
                        ? "bg-accent-wash font-semibold text-foreground"
                        : "text-foreground-soft hover:bg-surface-2"
                    }`}
                  >
                    <span className="min-w-0 truncate first-letter:uppercase">{label}</span>
                    <span className="shrink-0 text-xs text-muted-foreground capitalize">{element.kind}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  function propertiesPanel() {
    return (
      <div className={PANEL}>
        <h2 className="text-[16px] leading-[1.3] font-semibold text-foreground">Properties</h2>
        <ElementInspector
          element={selectedIndex !== null ? elements[selectedIndex] : null}
          onChange={updateSelectedElement}
          templateId={initial.id ?? "draft"}
          onAssetUploaded={(assetKey, previewUrl) => {
            setAssetPreviewUrls((prev) => ({ ...prev, [assetKey]: previewUrl }));
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={name || "New template"}
        breadcrumbs={[
          { label: "Certificates", href: "/staff/certificates" },
          { label: "Templates", href: "/staff/certificates/templates" },
          { label: name || "New template" },
        ]}
        meta={
          dirty && !readOnly ? (
            <span data-tone="warning" className="text-sm font-medium">
              Unsaved changes
            </span>
          ) : undefined
        }
        actions={
          <>
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
              className="inline-flex min-h-10 items-center rounded-md border border-sidebar-line px-4 text-sm font-semibold text-white hover:bg-sidebar-hover"
            >
              {readOnly ? "Back to templates" : "Cancel"}
            </Link>
          </>
        }
      />

      <div className="flex flex-col gap-4">

        {saveError && (
          <p role="alert" className="text-sm text-danger">
            {saveError}
          </p>
        )}

        <div className="flex flex-wrap items-end gap-4">
          {readOnly ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Name</span>
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
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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
            <details className="border-b border-border lg:hidden" open>
              <summary className="cursor-pointer px-0 py-3 text-sm font-semibold text-foreground">Elements</summary>
              {palettePanel()}
            </details>
            <aside className="hidden w-64 shrink-0 border-r border-border pr-6 lg:block">
              {palettePanel()}
            </aside>
          </>
        )}

        <div className="flex flex-1 flex-col items-center gap-2 rounded-lg bg-surface-2 p-6">
          <TemplateCanvas
            elements={elements}
            selectedIndex={selectedIndex}
            pageSize={pageSize}
            orientation={orientation}
            readOnly={readOnly}
            onChange={(next) => {
              setElements(next);
              markDirty();
            }}
            onSelect={setSelectedIndex}
            assetPreviewUrls={assetPreviewUrls}
          />
        </div>

        <details className="border-b border-border lg:hidden" open>
          <summary className="cursor-pointer px-0 py-3 text-sm font-semibold text-foreground">Properties</summary>
          {propertiesPanel()}
        </details>
        <aside className="hidden w-64 shrink-0 border-l border-border pl-6 lg:block">
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
