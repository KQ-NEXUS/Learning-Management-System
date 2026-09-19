"use client";

import { useState } from "react";
import { FormField, TextInput, StatusPill } from "@/components/primitives";
import type { CertificateElementV1, CertificateTextField } from "@/server/services/certificate-template-layout";
import {
  presignTemplateAssetUploadAction,
  confirmTemplateAssetUploadAction,
} from "./template-asset-actions";
import { PENDING_UPLOAD_ASSET_KEY } from "./TemplateCanvas";

type TextElement = Extract<CertificateElementV1, { kind: "text" }>;
type ImageElement = Extract<CertificateElementV1, { kind: "image" }>;
type BorderElement = Extract<CertificateElementV1, { kind: "border" }>;

/**
 * ElementInspector — the selected element's editable properties, bound
 * two-way to the canvas (UI-SPEC §7.3.5, plan 11-12 Task 2/3).
 *
 * A controlled component: it never holds its own copy of the element, it
 * reads `element` from `TemplateEditorShell`'s state and writes back a
 * whole REPLACEMENT element through `onChange` — the SAME state the
 * canvas's drag/nudge writes to, so position edits from either surface
 * flow through one update path and can never diverge.
 *
 * Every numeric input clamps at the input boundary (non-negative, finite)
 * before it ever reaches `onChange`, and switching a text element's field
 * type constructs a genuinely NEW object with the inapplicable key
 * (`literal`) absent rather than set to `undefined` — so nothing this file
 * emits can ever fail `parseCertificateTemplateLayout`.
 */

export type ElementInspectorProps = {
  element: CertificateElementV1 | null;
  onChange: (nextElement: CertificateElementV1) => void;
  /** Scopes the staged upload's object-storage path (Task 3). An unsaved
   * new template has no real id yet — the shell passes `"draft"` in that
   * case, which is safe: this string only organises storage keys, it is
   * never trusted as an authorization scope (that is always the fixed
   * `certificates.manage` / GLOBAL check `template-asset-actions.ts` runs). */
  templateId: string;
  /** Fired once a real asset is promoted, so the shell can register a
   * client-only preview URL for the canvas (Task 1) — never part of the
   * persisted layout. */
  onAssetUploaded?: (assetKey: string, previewUrl: string) => void;
};

const FIELD_TYPE_OPTIONS: { value: CertificateTextField; label: string }[] = [
  { value: "learnerName", label: "Learner name" },
  { value: "awardTitle", label: "Award title" },
  { value: "issuedAt", label: "Issued date" },
  { value: "verificationRef", label: "Verification reference" },
  { value: "literal", label: "Custom text" },
];

const FIELD_LABELS: Record<CertificateTextField, string> = {
  learnerName: "learner name",
  awardTitle: "award title",
  issuedAt: "issued date",
  verificationRef: "verification reference",
  literal: "custom text",
};

const ALIGNMENTS = ["left", "center", "right"] as const;
type BorderStyleValue = "solid" | "double";

/** Non-negative, finite only — matches `certificate-template-layout.ts`'s
 * `nonNegativeFinite` exactly, so nothing this parses can ever fail that
 * check on save. Returns `null` for anything else, and the caller simply
 * does not call `onChange` for a `null` — the invalid keystroke is dropped,
 * never forwarded. */
function parseNonNegative(raw: string): number | null {
  if (raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

function NumberField({
  name,
  label,
  suffixHint,
  value,
  onCommit,
}: {
  name: string;
  label: string;
  suffixHint?: string;
  value: number;
  onCommit: (value: number) => void;
}) {
  return (
    <FormField name={name} label={suffixHint ? `${label} (${suffixHint})` : label}>
      {(fieldProps) => (
        <TextInput
          {...fieldProps}
          type="number"
          min={0}
          step="any"
          value={value}
          onChange={(event) => {
            const parsed = parseNonNegative(event.target.value);
            if (parsed === null) return;
            onCommit(parsed);
          }}
        />
      )}
    </FormField>
  );
}

const SEGMENT_GROUP = "flex h-8 items-center gap-1 rounded-md border border-input-border bg-surface-2 p-1";
const SEGMENT_BTN = (active: boolean) =>
  `rounded-md px-2 py-1 text-sm font-semibold capitalize ${
    active ? "bg-surface text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
  }`;

export function ElementInspector({ element, onChange, templateId, onAssetUploaded }: ElementInspectorProps) {
  const [uploadState, setUploadState] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [chosenFile, setChosenFile] = useState<File | null>(null);

  if (!element) {
    return <p className="text-sm text-muted-foreground">Select an element to edit its properties.</p>;
  }

  // Position/size fields apply to `text` and `image` elements only — a
  // `border` element has no x/y/width/height in the schema at all (it draws
  // inset from the page edge), so rendering them for a border would emit
  // keys `parseCertificateTemplateLayout`'s `rejectUnknownKeys` rejects.
  const positionFields =
    element.kind === "text" || element.kind === "image" ? (
      <div className="grid grid-cols-2 gap-3">
        <NumberField name="elementX" label="X" value={element.x} onCommit={(x) => onChange({ ...element, x })} />
        <NumberField name="elementY" label="Y" value={element.y} onCommit={(y) => onChange({ ...element, y })} />
        <NumberField
          name="elementWidth"
          label="Width"
          value={element.width}
          onCommit={(width) => onChange({ ...element, width })}
        />
        <NumberField
          name="elementHeight"
          label="Height"
          value={element.height}
          onCommit={(height) => onChange({ ...element, height })}
        />
      </div>
    ) : null;

  async function uploadChosenFile(file: File, currentElement: ImageElement) {
    setUploadState("uploading");
    setUploadMessage(null);

    const presign = await presignTemplateAssetUploadAction({
      templateId,
      filename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    });
    if (!presign.ok) {
      setUploadState("error");
      setUploadMessage(presign.message);
      return;
    }

    try {
      const put = await fetch(presign.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) throw new Error("Storage rejected the upload.");
    } catch {
      setUploadState("error");
      setUploadMessage("The upload failed. Try again.");
      return;
    }

    const confirmed = await confirmTemplateAssetUploadAction({
      stagedKey: presign.stagedKey,
      contentType: file.type,
      sizeBytes: file.size,
    });
    if (!confirmed.ok) {
      setUploadState("error");
      setUploadMessage(confirmed.message);
      return;
    }

    setUploadState("success");
    setUploadMessage(null);
    onAssetUploaded?.(confirmed.assetKey, URL.createObjectURL(file));
    onChange({ ...currentElement, assetKey: confirmed.assetKey });
  }

  function imageUploadControl(imageElement: ImageElement) {
    const status = {
      idle: { label: "No image attached", tone: "neutral" as const },
      uploading: { label: "Uploading…", tone: "neutral" as const },
      success: { label: "Uploaded", tone: "success" as const },
      error: { label: "Upload failed", tone: "danger" as const },
    }[uploadState];
    const nothingAttachedYet = imageElement.assetKey === PENDING_UPLOAD_ASSET_KEY && uploadState === "idle";

    return (
      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-sm font-semibold text-foreground">
          Image
          <input
            type="file"
            accept="image/png,image/jpeg"
            disabled={uploadState === "uploading"}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setChosenFile(file);
              if (file) void uploadChosenFile(file, imageElement);
            }}
            className="text-sm file:mr-4 file:rounded-md file:border file:border-input-border file:bg-surface file:px-4 file:py-2 file:text-sm file:font-semibold"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill
            label={nothingAttachedYet ? "No image attached" : status.label}
            tone={nothingAttachedYet ? "neutral" : status.tone}
          />
          {uploadState === "error" && (
            <button
              type="button"
              onClick={() => {
                if (chosenFile) void uploadChosenFile(chosenFile, imageElement);
              }}
              className="rounded-md border border-input-border bg-surface px-2 py-1 text-[11px] font-semibold text-foreground hover:bg-surface-2"
            >
              Retry
            </button>
          )}
        </div>
        {uploadMessage && (
          <p role="alert" className="text-sm text-danger">
            {uploadMessage}
          </p>
        )}
      </div>
    );
  }

  function handleFieldTypeChange(textElement: TextElement, nextField: CertificateTextField) {
    if (nextField === "literal") {
      // Build a fresh object with `literal` present — never merge onto the
      // prior (dynamic-field) element, which had no `literal` key at all.
      onChange({ ...textElement, field: "literal", literal: "" });
      return;
    }
    // Switching OFF "Custom text": construct a new object that never had a
    // `literal` key, rather than spreading the old one and setting it to
    // `undefined` — `parseCertificateTemplateLayout`'s `"literal" in
    // record` check would still see (and reject) a present-but-undefined
    // key.
    const rest: Omit<TextElement, "literal"> = {
      kind: textElement.kind,
      field: nextField,
      x: textElement.x,
      y: textElement.y,
      width: textElement.width,
      height: textElement.height,
      fontSize: textElement.fontSize,
      color: textElement.color,
      align: textElement.align,
    };
    onChange(rest);
  }

  function textFields(textElement: TextElement) {
    return (
      <>
        <FormField name="elementFieldType" label="Field type">
          {(fieldProps) => (
            <select
              {...fieldProps}
              value={textElement.field}
              onChange={(event) => handleFieldTypeChange(textElement, event.target.value as CertificateTextField)}
              className="h-[38px] rounded-md border border-input-border bg-surface px-2 py-1 text-sm"
            >
              {FIELD_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
        </FormField>

        {textElement.field === "literal" && (
          <FormField name="elementLiteral" label="Text">
            {(fieldProps) => (
              <TextInput
                {...fieldProps}
                value={textElement.literal ?? ""}
                onChange={(event) => onChange({ ...textElement, literal: event.target.value })}
              />
            )}
          </FormField>
        )}

        {textElement.field !== "literal" && (
          <p className="text-sm text-muted-foreground">
            This will be replaced with the learner&apos;s actual {FIELD_LABELS[textElement.field]} when issued.
          </p>
        )}

        <NumberField
          name="elementFontSize"
          label="Font size"
          value={textElement.fontSize}
          onCommit={(fontSize) => onChange({ ...textElement, fontSize })}
        />

        <FormField name="elementColor" label="Color">
          {(fieldProps) => (
            <input
              {...fieldProps}
              type="color"
              value={textElement.color}
              onChange={(event) => onChange({ ...textElement, color: event.target.value })}
              className="h-[38px] w-16 rounded-md border border-input-border bg-surface p-1"
            />
          )}
        </FormField>

        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-foreground">Alignment</span>
          <div role="group" aria-label="Alignment" className={SEGMENT_GROUP}>
            {ALIGNMENTS.map((align) => (
              <button
                key={align}
                type="button"
                aria-pressed={textElement.align === align}
                onClick={() => onChange({ ...textElement, align })}
                className={SEGMENT_BTN(textElement.align === align)}
              >
                {align}
              </button>
            ))}
          </div>
        </div>
      </>
    );
  }

  function borderFields(borderElement: BorderElement) {
    return (
      <>
        <FormField name="elementBorderStyle" label="Style">
          {(fieldProps) => (
            <select
              {...fieldProps}
              value={borderElement.style}
              onChange={(event) =>
                onChange({ ...borderElement, style: event.target.value as BorderStyleValue })
              }
              className="h-[38px] rounded-md border border-input-border bg-surface px-2 py-1 text-sm"
            >
              <option value="solid">Solid</option>
              <option value="double">Double</option>
            </select>
          )}
        </FormField>

        <FormField name="elementBorderColor" label="Color">
          {(fieldProps) => (
            <input
              {...fieldProps}
              type="color"
              value={borderElement.color}
              onChange={(event) => onChange({ ...borderElement, color: event.target.value })}
              className="h-[38px] w-16 rounded-md border border-input-border bg-surface p-1"
            />
          )}
        </FormField>

        <NumberField
          name="elementBorderWidth"
          label="Width"
          suffixHint="pt"
          value={borderElement.widthPt}
          onCommit={(widthPt) => onChange({ ...borderElement, widthPt })}
        />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {positionFields}
      {element.kind === "text" && textFields(element)}
      {element.kind === "image" && imageUploadControl(element)}
      {element.kind === "border" && borderFields(element)}
    </div>
  );
}
