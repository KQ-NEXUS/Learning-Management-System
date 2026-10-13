"use client";

import { useId, useState } from "react";
import { Captions } from "lucide-react";
import { StatusPill } from "@/components/primitives";
import {
  CAPTION_FILE_MESSAGE,
  CAPTION_LABEL_MAX_LENGTH,
  CAPTION_LABEL_MESSAGE,
  CAPTION_LANGUAGE_MAX_LENGTH,
  CAPTION_LANGUAGE_MESSAGE,
  UPLOAD_LIMITS,
  isValidCaptionLanguage,
} from "@/lib/upload-limits";

/**
 * Add and remove WebVTT caption tracks for ONE video resource (NFR-09, plan 15-24).
 *
 * It reuses the lesson upload flow UploadPanel already runs for files: ask the
 * upload-intent route for a presigned PUT, send the bytes straight to private
 * storage, then call the completion route, which is the real verdict. The browser
 * checks below are a courtesy only; the upload-intent route and the lesson resource
 * service repeat every rule and are the actual gate.
 *
 * Removal is requested here (`onRequestRemove`) but confirmed and performed by
 * UploadPanel, which already owns the one confirmation dialog for this editor.
 */

export type CaptionView = {
  id: string;
  /** The video resource this track belongs to. */
  videoResourceId: string;
  language: string;
  label: string;
  uploadStatus: "UPLOADING" | "READY" | "ERROR";
  uploadDetail: string | null;
};

export type CaptionPanelProps = {
  lessonId: string;
  videoResourceId: string;
  /** Only the captions of this video. */
  captions: CaptionView[];
  /** Called with a new track, and again with the same id when its status changes. */
  onCaptionChange: (caption: CaptionView) => void;
  onRequestRemove: (captionId: string) => void;
  /** The caption currently being removed, so its control can say so. */
  removingId?: string | null;
};

const DEFAULT_LANGUAGE = "en";
const DEFAULT_LABEL = "English";

type IntentResponse = {
  resource: { id: string; uploadStatus: CaptionView["uploadStatus"]; uploadDetail: string | null };
  upload: { url: string; method: "PUT"; headers: Record<string, string> };
};

function statusPresentation(status: CaptionView["uploadStatus"]) {
  switch (status) {
    case "READY":
      return { label: "Ready", tone: "success" as const };
    case "ERROR":
      return { label: "Failed", tone: "danger" as const };
    default:
      return { label: "Scanning", tone: "neutral" as const };
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

/** Browser courtesy check; the server repeats it. Returns a plain message or null. */
function fileProblem(file: File): string | null {
  const isVtt =
    file.name.toLowerCase().endsWith(".vtt") && (file.type === "" || file.type === "text/vtt");
  if (!isVtt || file.size > UPLOAD_LIMITS.CAPTION.maxBytes) return CAPTION_FILE_MESSAGE;
  return null;
}

export function CaptionPanel({
  lessonId,
  videoResourceId,
  captions,
  onCaptionChange,
  onRequestRemove,
  removingId = null,
}: CaptionPanelProps) {
  const fieldId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState(DEFAULT_LANGUAGE);
  const [label, setLabel] = useState(DEFAULT_LABEL);
  const [message, setMessage] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // Remounting the file input is the only reliable way to clear it.
  const [inputKey, setInputKey] = useState(0);

  function chooseFile(next: File | null) {
    setMessage(null);
    setFile(null);
    if (!next) return;
    const problem = fileProblem(next);
    if (problem) {
      setMessage(problem);
      return;
    }
    setFile(next);
  }

  async function add() {
    if (!file) return;
    const trimmedLanguage = language.trim();
    const trimmedLabel = label.trim();
    if (!isValidCaptionLanguage(trimmedLanguage)) {
      setMessage(CAPTION_LANGUAGE_MESSAGE);
      return;
    }
    if (trimmedLabel.length < 1 || trimmedLabel.length > CAPTION_LABEL_MAX_LENGTH) {
      setMessage(CAPTION_LABEL_MESSAGE);
      return;
    }

    setAdding(true);
    setMessage(null);
    try {
      const intentResponse = await fetch("/api/lesson-resources/upload-intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lessonId,
          title: `${trimmedLabel} captions`,
          filename: file.name,
          // The browser often reports no type for .vtt; the extension was checked above.
          mimeType: "text/vtt",
          sizeBytes: file.size,
          kind: "CAPTION",
          captionForResourceId: videoResourceId,
          captionLanguage: trimmedLanguage,
          captionLabel: trimmedLabel,
        }),
      });
      if (!intentResponse.ok) {
        throw new Error(await responseMessage(intentResponse, "The captions could not be added."));
      }
      const intent = (await intentResponse.json()) as IntentResponse;
      const track: CaptionView = {
        id: intent.resource.id,
        videoResourceId,
        language: trimmedLanguage,
        label: trimmedLabel,
        uploadStatus: intent.resource.uploadStatus,
        uploadDetail: intent.resource.uploadDetail,
      };
      onCaptionChange(track);

      // A network error on the direct PUT is ambiguous (storage may still have the
      // object), so completion is always attempted and is the real verdict.
      let putFailure: Error | null = null;
      try {
        const put = await fetch(intent.upload.url, {
          method: intent.upload.method,
          headers: intent.upload.headers,
          body: file,
        });
        if (!put.ok) putFailure = new Error("Storage rejected the upload.");
      } catch (error) {
        putFailure = error instanceof Error ? error : new Error("The storage upload failed.");
      }

      const complete = await fetch(`/api/lesson-resources/${intent.resource.id}/complete`, {
        method: "POST",
      });
      const completed = (await complete.json().catch(() => null)) as {
        resource?: { uploadStatus: CaptionView["uploadStatus"]; uploadDetail: string | null };
        error?: string;
      } | null;
      if (completed?.resource) {
        onCaptionChange({
          ...track,
          uploadStatus: completed.resource.uploadStatus,
          uploadDetail: completed.resource.uploadDetail,
        });
      }
      if (!complete.ok) {
        throw new Error(completed?.error ?? putFailure?.message ?? "The captions could not be added.");
      }

      setFile(null);
      setInputKey((current) => current + 1);
      setLanguage(DEFAULT_LANGUAGE);
      setLabel(DEFAULT_LABEL);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The captions could not be added.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-2 border-t border-border pt-4">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Captions aria-hidden className="size-4 text-muted-foreground" />
        Captions
      </p>

      {captions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No captions yet. Learners who cannot hear the video need them.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {captions.map((caption) => {
            const status = statusPresentation(caption.uploadStatus);
            return (
              <li
                key={caption.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-semibold">
                    {caption.label} ({caption.language})
                  </p>
                  {caption.uploadStatus === "ERROR" && caption.uploadDetail && (
                    <p className="break-words text-sm text-muted-foreground">{caption.uploadDetail}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill label={status.label} tone={status.tone} />
                  <button
                    type="button"
                    aria-label={`Remove captions: ${caption.label}`}
                    disabled={removingId === caption.id}
                    onClick={() => onRequestRemove(caption.id)}
                    className="rounded-md border border-input-border bg-surface px-2 py-1 text-sm font-semibold disabled:opacity-50"
                  >
                    {removingId === caption.id ? "Removing…" : "Remove captions"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <label
          htmlFor={`${fieldId}-language`}
          className="flex flex-col gap-1 text-sm font-semibold text-foreground"
        >
          Caption language
          <input
            id={`${fieldId}-language`}
            type="text"
            value={language}
            maxLength={CAPTION_LANGUAGE_MAX_LENGTH}
            onChange={(event) => setLanguage(event.target.value)}
            className="w-28 rounded-md border border-input-border bg-surface px-4 py-2 text-sm"
          />
        </label>
        <label
          htmlFor={`${fieldId}-label`}
          className="flex flex-col gap-1 text-sm font-semibold text-foreground"
        >
          Caption label
          <input
            id={`${fieldId}-label`}
            type="text"
            value={label}
            maxLength={CAPTION_LABEL_MAX_LENGTH}
            onChange={(event) => setLabel(event.target.value)}
            className="rounded-md border border-input-border bg-surface px-4 py-2 text-sm"
          />
        </label>
      </div>
      <label
        htmlFor={`${fieldId}-file`}
        className="flex flex-col gap-1 text-sm font-semibold text-foreground"
      >
        Caption file (.vtt)
        <input
          key={inputKey}
          id={`${fieldId}-file`}
          type="file"
          accept=".vtt,text/vtt"
          onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
          className="text-sm file:mr-4 file:rounded-md file:border file:border-input-border file:bg-surface file:px-4 file:py-2 file:text-sm file:font-semibold"
        />
      </label>
      <button
        type="button"
        disabled={!file || adding}
        onClick={() => void add()}
        className="self-start rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast disabled:opacity-50"
      >
        Add captions
      </button>
      {!file && !adding && (
        <p className="text-sm text-muted-foreground">Choose a .vtt file to add captions.</p>
      )}

      {adding && (
        <p aria-live="polite" className="text-sm text-muted-foreground">
          Adding captions…
        </p>
      )}
      {message && (
        <p role="alert" className="text-sm text-danger">
          {message}
        </p>
      )}
    </div>
  );
}
