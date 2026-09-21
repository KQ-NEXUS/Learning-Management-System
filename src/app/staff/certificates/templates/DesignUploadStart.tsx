"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { PageHeader } from "@/components/shell/PageHeader";
import { BTN, BTN_PRIMARY, CONTROL, FIELD, NOTE_DANGER } from "@/components/primitives/controls";
import { validateTemplateAssetUpload } from "@/lib/upload-limits";
import {
  buildDesignLayout,
  designAspectMismatch,
  orientationForImage,
} from "@/server/services/certificate-design-layout";
import type { CertificateTemplateLayoutV1 } from "@/server/services/certificate-template-layout";
import { confirmTemplateAssetUploadAction, presignTemplateAssetUploadAction } from "./template-asset-actions";
import { pageDimensions } from "./TemplateCanvas";
import { TemplateEditorShell } from "./TemplateEditorShell";

/**
 * "Start from an uploaded design" (D-09 follow-up): a school that already has certificate artwork
 * uploads it once and lands in the template editor with that artwork as the full-page background
 * and the four dynamic fields on top, ready to be dragged into place.
 *
 * Nothing is saved here. The upload uses the editor's own image pipeline (presign, PUT straight to
 * storage, server-side verification), then the editor opens on an unsaved template, so the usual
 * "Save template" (which needs a name) is what creates it.
 */

type Size = { width: number; height: number };

type Deps = {
  presign?: typeof presignTemplateAssetUploadAction;
  confirm?: typeof confirmTemplateAssetUploadAction;
  /** Reads an image's pixel size; injectable because jsdom cannot decode images. */
  measure?: (file: File) => Promise<Size>;
  /** PUTs the file to the presigned URL. */
  put?: (url: string, file: File) => Promise<boolean>;
};

function measureImage(file: File): Promise<Size> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("unreadable image"));
    };
    image.src = url;
  });
}

async function putToStorage(url: string, file: File): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
    return response.ok;
  } catch {
    return false;
  }
}

type PageSize = CertificateTemplateLayoutV1["pageSize"];

type Started = { layout: CertificateTemplateLayoutV1; assetKey: string; previewUrl: string };

export function DesignUploadStart({
  presign = presignTemplateAssetUploadAction,
  confirm = confirmTemplateAssetUploadAction,
  measure = measureImage,
  put = putToStorage,
}: Deps) {
  const [file, setFile] = useState<File | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState<PageSize>("A4");
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<Started | null>(null);
  const [pending, transition] = useTransition();
  // The preview blob belongs to the chosen file: release it when the choice changes or the page is
  // left. It is NOT released when the editor takes over, because this effect only re-runs when
  // `previewUrl` changes, and the editor's canvas keeps drawing the design from the same URL.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  if (started) {
    return (
      <TemplateEditorShell
        initial={{ name: "", layout: started.layout, readOnly: false, startDirty: true }}
        initialAssetPreviewUrls={{ [started.assetKey]: started.previewUrl }}
      />
    );
  }

  const orientation = size ? orientationForImage(size.width, size.height) : "landscape";
  const page = pageDimensions(pageSize, orientation);
  const mismatch = size ? designAspectMismatch(size.width, size.height, page.w, page.h) : false;

  async function choose(chosen: File | null) {
    setError(null);
    setSize(null);
    setFile(null);
    setPreviewUrl(null);
    if (!chosen) return;

    const check = validateTemplateAssetUpload({ mimeType: chosen.type, sizeBytes: chosen.size });
    if (!check.ok) {
      setError(check.message);
      return;
    }
    try {
      setSize(await measure(chosen));
    } catch {
      setError("This image could not be read. Choose a PNG or JPEG file and try again.");
      return;
    }
    setFile(chosen);
    setPreviewUrl(URL.createObjectURL(chosen));
  }

  function upload() {
    if (!file || !size) return;
    const chosen = file;
    setError(null);
    transition(async () => {
      // "draft": the template has no id yet, exactly as in the editor's own image upload.
      const presigned = await presign({
        templateId: "draft",
        filename: chosen.name,
        mimeType: chosen.type,
        sizeBytes: chosen.size,
      });
      if (!presigned.ok) {
        setError(presigned.message);
        return;
      }
      if (!(await put(presigned.uploadUrl, chosen))) {
        setError("The upload failed. Try again.");
        return;
      }
      const confirmed = await confirm({
        stagedKey: presigned.stagedKey,
        contentType: chosen.type,
        sizeBytes: chosen.size,
      });
      if (!confirmed.ok) {
        setError(confirmed.message);
        return;
      }

      const layout = buildDesignLayout({
        assetKey: confirmed.assetKey,
        pageSize,
        orientation,
        pageWidth: page.w,
        pageHeight: page.h,
      });
      setStarted({ layout, assetKey: confirmed.assetKey, previewUrl: previewUrl ?? URL.createObjectURL(chosen) });
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <PageHeader
        breadcrumbs={[
          { label: "Certificates", href: "/staff/certificates" },
          { label: "Templates", href: "/staff/certificates/templates" },
          { label: "Upload existing design" },
        ]}
        title="Upload existing design"
        subtitle="Use your own certificate artwork as the background. You'll place the learner's name, the award, the date and the verification reference on top of it."
      />

      <div className="grid gap-x-16 gap-y-8 border-t border-foreground pt-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <label className={FIELD}>
            Certificate design
            <input
              type="file"
              accept="image/png,image/jpeg"
              disabled={pending}
              onChange={(event) => void choose(event.target.files?.[0] ?? null)}
              className="text-sm font-normal file:mr-4 file:min-h-10 file:rounded-md file:border file:border-input-border file:bg-surface file:px-4 file:text-sm file:font-semibold file:text-foreground"
            />
            <span className="text-sm font-normal text-muted-foreground">
              A PNG or JPEG, up to 10 MB. Export your design from Word, Canva or Photoshop as an image.
            </span>
          </label>

          <label className={FIELD}>
            Page size
            <select
              value={pageSize}
              disabled={pending}
              onChange={(event) => setPageSize(event.target.value as PageSize)}
              className={`${CONTROL} max-w-48`}
            >
              <option value="A4">A4</option>
              <option value="LETTER">Letter</option>
            </select>
          </label>

          {size && (
            <p className="text-sm text-muted-foreground">
              {size.width} × {size.height} px, so a {orientation} page.
              {mismatch && (
                <>
                  {" "}
                  <span className="font-semibold text-foreground">
                    This image is not the same shape as an {pageSize === "A4" ? "A4" : "Letter"} page, so it will be stretched to fit.
                  </span>
                </>
              )}
            </p>
          )}

          {error && (
            <p role="alert" className={NOTE_DANGER}>
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <Link href="/staff/certificates/templates" className={BTN}>
              Cancel
            </Link>
            <button type="button" disabled={!file || !size || pending} onClick={upload} className={BTN_PRIMARY}>
              {pending ? "Uploading…" : "Continue to editor"}
            </button>
          </div>
        </div>

        <div aria-live="polite">
          {previewUrl ? (
            // A client-only blob preview of the file the user just picked.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="Preview of your certificate design" className="w-full rounded-md border border-border" />
          ) : (
            <p className="text-sm text-muted-foreground">Your design will be previewed here.</p>
          )}
        </div>
      </div>
    </div>
  );
}
