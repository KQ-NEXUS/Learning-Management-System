"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, Upload } from "lucide-react";
import { StatusPill } from "@/components/primitives";
import {
  UPLOAD_LIMITS,
  validateUpload,
  type UploadableLessonType,
} from "@/lib/upload-limits";

export type LessonResourceView = {
  id: string;
  title: string;
  filename: string;
  mimeType: string;
  /** Decimal string because the database column is a BigInt. */
  sizeBytes: string;
  uploadStatus: "UPLOADING" | "READY" | "ERROR";
  uploadDetail: string | null;
  position: number;
};

export type UploadPanelProps = {
  lessonId: string;
  lessonType: UploadableLessonType;
  initialResources?: LessonResourceView[];
};

const FRIENDLY_LIMIT_MESSAGES: Record<UploadableLessonType, string> = {
  IMAGE: "Images must be PNG, JPEG, WebP or GIF and under 10 MB.",
  FILE: "Files must be an accepted document, text or Office format and under 50 MB.",
  VIDEO: "Videos must be MP4 or WebM and under 2 GB.",
};

type UploadIntentResponse = {
  resource: LessonResourceView;
  upload: {
    url: string;
    method: "PUT";
    headers: Record<string, string>;
    expiresIn: number;
  };
};

function statusPresentation(status: LessonResourceView["uploadStatus"]) {
  switch (status) {
    case "READY":
      return { label: "Ready", tone: "success" as const };
    case "ERROR":
      return { label: "Upload failed", tone: "danger" as const };
    default:
      return { label: "Uploading", tone: "neutral" as const };
  }
}

async function responseMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

export function UploadPanel({ lessonId, lessonType, initialResources }: UploadPanelProps) {
  const [resources, setResources] = useState<LessonResourceView[]>(initialResources ?? []);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const loadResources = useCallback(
    async (signal?: AbortSignal): Promise<LessonResourceView[]> => {
      const response = await fetch(
        `/api/lesson-resources?${new URLSearchParams({ lessonId })}`,
        { signal, cache: "no-store" },
      );
      if (!response.ok) {
        throw new Error(await responseMessage(response, "Could not load resources."));
      }
      const body = (await response.json()) as { resources: LessonResourceView[] };
      return body.resources;
    },
    [lessonId],
  );

  useEffect(() => {
    if (initialResources !== undefined) return;
    const controller = new AbortController();
    void loadResources(controller.signal)
      .then(setResources)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setMessage(error instanceof Error ? error.message : "Could not load resources.");
        }
      });
    return () => controller.abort();
  }, [loadResources, initialResources]);

  function chooseFile(file: File | null) {
    setMessage(null);
    setSelectedFile(null);
    if (!file) return;

    // Courtesy only: the upload-intent route repeats this validation and
    // remains the actual security and size gate for browser input.
    const check = validateUpload({
      lessonType,
      mimeType: file.type,
      sizeBytes: file.size,
    });
    if (!check.ok) {
      setMessage(FRIENDLY_LIMIT_MESSAGES[lessonType]);
      return;
    }

    setSelectedFile(file);
    setTitle((current) => current || file.name.replace(/\.[^.]+$/, ""));
  }

  async function upload() {
    if (!selectedFile) return;
    const resourceTitle = title.trim();
    if (!resourceTitle) {
      setMessage("Give this resource a title before uploading.");
      return;
    }

    setUploading(true);
    setMessage(null);

    try {
      const intentResponse = await fetch("/api/lesson-resources/upload-intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lessonId,
          title: resourceTitle,
          filename: selectedFile.name,
          mimeType: selectedFile.type,
          sizeBytes: selectedFile.size,
        }),
      });
      if (!intentResponse.ok) {
        throw new Error(await responseMessage(intentResponse, "The upload could not be started."));
      }
      const intent = (await intentResponse.json()) as UploadIntentResponse;
      setResources((current) => [...current, intent.resource]);

      // The presigned PUT goes straight to private storage. A network error
      // here is ambiguous — storage may still have received the object — so we
      // always attempt completion, which is the real verdict.
      let putFailure: Error | null = null;
      try {
        const put = await fetch(intent.upload.url, {
          method: intent.upload.method,
          headers: intent.upload.headers,
          body: selectedFile,
        });
        if (!put.ok) putFailure = new Error("Storage rejected the upload.");
      } catch (error) {
        putFailure = error instanceof Error ? error : new Error("The storage upload failed.");
      }

      const complete = await fetch(`/api/lesson-resources/${intent.resource.id}/complete`, {
        method: "POST",
      });
      const completed = (await complete.json().catch(() => null)) as {
        resource?: LessonResourceView;
        error?: string;
      } | null;
      if (completed?.resource) {
        const next = completed.resource;
        setResources((current) => current.map((row) => (row.id === next.id ? next : row)));
      }
      if (!complete.ok) {
        throw new Error(completed?.error ?? putFailure?.message ?? "The upload failed.");
      }

      setSelectedFile(null);
      setTitle("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function remove(resourceId: string) {
    if (!window.confirm("Remove this resource? This cannot be undone.")) return;
    setRemovingId(resourceId);
    setMessage(null);
    try {
      const response = await fetch(`/api/lesson-resources/${resourceId}`, { method: "DELETE" });
      if (response.status !== 204) {
        throw new Error(await responseMessage(response, "Could not remove this resource."));
      }
      setResources((current) => current.filter((resource) => resource.id !== resourceId));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove this resource.");
    } finally {
      setRemovingId(null);
    }
  }

  const noun = lessonType.toLowerCase();
  const limit = UPLOAD_LIMITS[lessonType];

  return (
    <fieldset
      aria-label={`${noun} resources`}
      className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 shadow-xs"
    >
      <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-foreground">
        Resources
      </legend>

      <label className="flex flex-col gap-1 text-sm font-semibold text-foreground">
        Resource title
        <input
          type="text"
          value={title}
          maxLength={300}
          onChange={(event) => setTitle(event.target.value)}
          className="rounded-md border border-input-border bg-surface px-4 py-2 text-sm"
        />
      </label>
      <label className="flex flex-col gap-2 rounded-md border border-dashed border-input-border bg-surface-2 p-4 text-sm font-semibold text-foreground">
        <span className="flex items-center gap-2">
          <Upload aria-hidden className="size-4 text-accent" />
          {`Choose ${noun}`}
        </span>
        <input
          type="file"
          accept={limit.mimeTypes.join(",")}
          onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
          className="text-sm file:mr-4 file:rounded-md file:border file:border-input-border file:bg-surface file:px-4 file:py-2 file:text-sm file:font-semibold"
        />
      </label>
      <button
        type="button"
        disabled={!selectedFile || uploading}
        onClick={() => void upload()}
        className="self-start rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast disabled:opacity-50"
      >
        Upload resource
      </button>

      {uploading && (
        <div aria-live="polite" className="flex items-center gap-2 text-sm text-muted-foreground">
          <progress aria-label="Upload progress" className="h-1.5 w-32" />
          Uploading…
        </div>
      )}
      {message && (
        <p role="alert" className="text-sm text-danger">
          {message}
        </p>
      )}

      {resources.length === 0 ? (
        <p className="text-sm text-muted-foreground">No resources uploaded yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border border-t border-border">
          {resources.map((resource) => {
            const status = statusPresentation(resource.uploadStatus);
            return (
              <li key={resource.id} className="flex flex-wrap items-start justify-between gap-2 py-4">
                <div className="flex min-w-0 flex-1 items-start gap-2">
                  <FileText aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-semibold">{resource.title}</p>
                    <p className="break-all text-sm text-muted-foreground">{resource.filename}</p>
                    {resource.uploadStatus === "ERROR" && resource.uploadDetail && (
                      <p className="mt-1 break-words text-sm text-muted-foreground">
                        {resource.uploadDetail}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill label={status.label} tone={status.tone} />
                  {resource.uploadStatus === "READY" && (
                    <a
                      href={`/api/lesson-resources/${resource.id}/download`}
                      className="text-sm font-semibold text-accent underline underline-offset-2"
                    >
                      Download
                    </a>
                  )}
                  {resource.uploadStatus === "ERROR" && (
                    <button
                      type="button"
                      aria-label="Remove resource"
                      disabled={removingId === resource.id}
                      onClick={() => void remove(resource.id)}
                      className="rounded-md border border-input-border bg-surface px-2 py-1 text-sm font-semibold disabled:opacity-50"
                    >
                      {removingId === resource.id ? "Removing…" : "Remove"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}
