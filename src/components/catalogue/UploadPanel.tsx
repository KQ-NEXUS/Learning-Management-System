"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  scanStatus: "PENDING" | "CLEAN" | "INFECTED" | "ERROR";
  scanDetail: string | null;
  position: number;
};

export type UploadPanelProps = {
  lessonId: string;
  lessonType: UploadableLessonType;
  initialResources?: LessonResourceView[];
  /** Test seams; production uses a short interval and a finite one-minute window. */
  pollIntervalMs?: number;
  maxPolls?: number;
};

const FRIENDLY_LIMIT_MESSAGES: Record<UploadableLessonType, string> = {
  IMAGE: "Images must be PNG, JPEG, WebP or GIF and under 10 MB.",
  FILE: "Files must be an accepted document, text, archive or Office format and under 50 MB.",
  VIDEO: "Videos must be MP4 or WebM and under 2 GB.",
};

/**
 * A single failed status refresh is transient: the attempt is still spent from
 * the poll budget, but the loop keeps going. Kept distinct from the
 * exhausted-budget instruction below so a flake never looks like a dead end.
 */
const POLL_RETRY_MESSAGE = "Could not refresh scan status just now — trying again.";

/**
 * Shown once the finite poll budget is spent. This is an instruction, not a
 * transient notice: nothing further will happen automatically.
 */
const POLL_EXHAUSTED_MESSAGE =
  "Automatic scan-status checks have stopped for now. Reload the page to keep checking.";

function statusPresentation(status: LessonResourceView["scanStatus"]) {
  switch (status) {
    case "CLEAN":
      return { label: "Clean", tone: "success" as const };
    case "INFECTED":
      return { label: "Infected", tone: "danger" as const };
    case "ERROR":
      return { label: "Scan error", tone: "warning" as const };
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

export function UploadPanel({
  lessonId,
  lessonType,
  initialResources,
  pollIntervalMs = 3_000,
  maxPolls = 20,
}: UploadPanelProps) {
  const [resources, setResources] = useState<LessonResourceView[]>(initialResources ?? []);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const pollCount = useRef(0);
  // Bumped whenever a fresh upload or a manual retry queues new scanning work,
  // so the recursive poll effect below restarts with a full budget even if
  // other resources were already pending (a boolean `hasPending` would not
  // change and would leave the loop stranded on its spent budget).
  const [pollEpoch, setPollEpoch] = useState(0);

  const fetchResources = useCallback(
    async (signal?: AbortSignal): Promise<LessonResourceView[]> => {
      const response = await fetch(
        `/api/lesson-resources?${new URLSearchParams({ lessonId })}`,
        { signal, cache: "no-store" },
      );
      if (!response.ok) {
        throw new Error(await responseMessage(response, "Could not refresh scan status."));
      }
      const body = (await response.json()) as { resources: LessonResourceView[] };
      return body.resources;
    },
    [lessonId],
  );

  useEffect(() => {
    if (initialResources !== undefined) return;
    const controller = new AbortController();
    void fetchResources(controller.signal)
      .then(setResources)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setMessage(error instanceof Error ? error.message : "Could not load resources.");
        }
      });
    return () => controller.abort();
  }, [fetchResources, initialResources]);

  const hasPending = resources.some((resource) => resource.scanStatus === "PENDING");

  // A recursive, bounded poll. It reschedules itself from `finally` — so a
  // rejected refresh does NOT strand the scanning rows the way a
  // dependency-triggered one-shot did (it would never re-run because a failed
  // poll changes no state) — while a rejected attempt still counts against the
  // finite budget so a permanently failing endpoint cannot spin forever. Only
  // one request is ever in flight; the timer is cleared on unmount or once no
  // resource is pending.
  useEffect(() => {
    if (!hasPending || maxPolls <= 0) return;

    let cancelled = false;
    let inFlight = false;
    let timer: number | undefined;
    const controller = new AbortController();
    pollCount.current = 0;

    function scheduleNext() {
      if (cancelled) return;
      if (pollCount.current >= maxPolls) {
        setMessage(POLL_EXHAUSTED_MESSAGE);
        return;
      }
      timer = window.setTimeout(runPoll, pollIntervalMs);
    }

    function runPoll() {
      if (cancelled || inFlight) return;
      inFlight = true;
      pollCount.current += 1;
      void fetchResources(controller.signal)
        .then((next) => {
          if (cancelled || controller.signal.aborted) return;
          setResources(next);
          setMessage((current) => (current === POLL_RETRY_MESSAGE ? null : current));
        })
        .catch(() => {
          if (cancelled || controller.signal.aborted) return;
          setMessage(POLL_RETRY_MESSAGE);
        })
        .finally(() => {
          inFlight = false;
          scheduleNext();
        });
    }

    timer = window.setTimeout(runPoll, pollIntervalMs);

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      controller.abort();
    };
  }, [fetchResources, hasPending, maxPolls, pollIntervalMs, pollEpoch]);

  function chooseFile(file: File | null) {
    setMessage(null);
    setSelectedFile(null);
    if (!file) return;

    // Courtesy only: the Route Handler repeats this validation and remains the
    // actual security and size gate for attacker-controlled browser input.
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
    const query = new URLSearchParams({
      lessonId,
      title: resourceTitle,
      filename: selectedFile.name,
      mimeType: selectedFile.type,
      sizeBytes: String(selectedFile.size),
    });

    try {
      const response = await fetch(`/api/lesson-resources/upload?${query}`, {
        method: "POST",
        body: selectedFile,
      });
      if (!response.ok) {
        throw new Error(await responseMessage(response, "The upload failed."));
      }
      const created = (await response.json()) as {
        id: string;
        scanStatus: "PENDING";
      };
      const pending: LessonResourceView = {
        id: created.id,
        title: resourceTitle,
        filename: selectedFile.name,
        mimeType: selectedFile.type,
        sizeBytes: String(selectedFile.size),
        scanStatus: created.scanStatus,
        scanDetail: null,
        position: resources.length,
      };
      setResources((current) => [...current, pending]);
      setPollEpoch((epoch) => epoch + 1);
      setSelectedFile(null);
      setTitle("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function retry(resourceId: string) {
    setRetryingId(resourceId);
    setMessage(null);
    try {
      const response = await fetch(`/api/lesson-resources/${resourceId}/retry`, {
        method: "POST",
      });
      const body = (await response.json().catch(() => null)) as {
        resource?: LessonResourceView;
        error?: string;
      } | null;

      // A 503 carries the row the server rolled back to ERROR, so apply the
      // resource whether or not the request succeeded.
      if (body?.resource) {
        const next = body.resource;
        setResources((current) =>
          current.map((resource) => (resource.id === resourceId ? next : resource)),
        );
      }
      if (!response.ok) {
        throw new Error(body?.error ?? "Could not retry this scan.");
      }
      setPollEpoch((epoch) => epoch + 1);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not retry this scan.");
    } finally {
      setRetryingId(null);
    }
  }

  const noun = lessonType.toLowerCase();
  const limit = UPLOAD_LIMITS[lessonType];

  return (
    <fieldset
      aria-label={`${noun} resources`}
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-xs"
    >
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-foreground">
        Resources
      </legend>

      <label className="flex flex-col gap-1 text-xs font-semibold text-foreground">
        Resource title
        <input
          type="text"
          value={title}
          maxLength={300}
          onChange={(event) => setTitle(event.target.value)}
          className="rounded-md border border-input-border bg-surface px-2.5 py-1.5 text-sm"
        />
      </label>
      <label className="flex flex-col gap-2 rounded-md border border-dashed border-input-border bg-surface-2 p-3 text-xs font-semibold text-foreground">
        <span className="flex items-center gap-2">
          <Upload aria-hidden className="size-4 text-accent" />
          {`Choose ${noun}`}
        </span>
        <input
          type="file"
          accept={limit.mimeTypes.join(",")}
          onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
          className="text-sm file:mr-3 file:rounded-md file:border file:border-input-border file:bg-surface file:px-2.5 file:py-1.5 file:text-xs file:font-semibold"
        />
      </label>
      <button
        type="button"
        disabled={!selectedFile || uploading}
        onClick={() => void upload()}
        className="self-start rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-contrast disabled:opacity-50"
      >
        Upload resource
      </button>

      {uploading && (
        <div aria-live="polite" className="flex items-center gap-2 text-xs text-muted-foreground">
          <progress aria-label="Upload progress" className="h-1.5 w-32" />
          Uploading…
        </div>
      )}
      {message && (
        <p role="alert" className="text-xs text-danger">
          {message}
        </p>
      )}

      {resources.length === 0 ? (
        <p className="text-xs text-muted-foreground">No resources uploaded yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border border-t border-border">
          {resources.map((resource) => {
            const status = statusPresentation(resource.scanStatus);
            return (
              <li key={resource.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="flex min-w-0 flex-1 items-start gap-2">
                  <FileText aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-semibold">{resource.title}</p>
                    <p className="break-all text-xs text-muted-foreground">{resource.filename}</p>
                    {(resource.scanStatus === "INFECTED" || resource.scanStatus === "ERROR") &&
                      resource.scanDetail && (
                        <p className="mt-1 break-words text-xs text-muted-foreground">
                          {resource.scanDetail}
                        </p>
                      )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill label={status.label} tone={status.tone} />
                  {resource.scanStatus === "CLEAN" && (
                    <a
                      href={`/api/lesson-resources/${resource.id}/download`}
                      className="text-xs font-semibold text-accent underline underline-offset-2"
                    >
                      Download
                    </a>
                  )}
                  {resource.scanStatus === "ERROR" && (
                    <button
                      type="button"
                      aria-label="Retry scan"
                      disabled={retryingId === resource.id}
                      onClick={() => void retry(resource.id)}
                      className="rounded-md border border-input-border bg-surface px-2 py-1 text-xs font-semibold disabled:opacity-50"
                    >
                      {retryingId === resource.id ? "Retrying…" : "Retry"}
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
