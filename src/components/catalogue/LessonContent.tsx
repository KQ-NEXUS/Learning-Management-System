import { sanitizeLessonBody } from "@/lib/sanitize";
import { parseEmbedUrl } from "@/lib/embed-url";
import { LessonMediaPlayer } from "./LessonMediaPlayer";

/**
 * The learner-facing lesson renderer for all eight `LessonType` values.
 *
 * A SERVER COMPONENT by construction: no client directive, no state, no
 * event handlers, and (absolute prohibition) no editor-library import reachable from
 * here or anything it imports (that editor bundle is the authoring form's alone). `Lesson.body` stores HTML precisely so the read
 * path ships zero client JavaScript (D-30, NFR-02). Phase 9 builds the learner
 * journey around this component.
 */

export type LessonContentLesson = {
  id: string;
  title: string;
  type: string;
  body: string | null;
  embedUrl: string | null;
  linkUrl: string | null;
  withdrawnAt: Date | string | null;
};

export type LessonContentResource = {
  id: string;
  title: string;
  filename: string;
  mimeType: string;
  /** Decimal string — the column is a BigInt (never a JSON number). */
  sizeBytes: string;
  scanStatus: "PENDING" | "CLEAN" | "INFECTED" | "ERROR";
};

export type LessonContentProps = {
  lesson: LessonContentLesson;
  resources?: LessonContentResource[];
};

const DOWNLOAD_ROUTE = (id: string) => `/api/lesson-resources/${id}/download`;

function humanSize(bytes: string): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

function ScanBlocked({ status }: { status: "PENDING" | "INFECTED" | "ERROR" }) {
  if (status === "PENDING") {
    return (
      <p role="alert" className="rounded-md border border-danger/30 bg-danger-surface px-4 py-2 text-sm text-danger">
        Scanning — this file will be available once its security scan finishes.
      </p>
    );
  }
  return (
    <p role="alert" className="rounded-md border border-danger/30 bg-danger-surface px-4 py-2 text-sm text-danger">
      This file is blocked: it did not pass a security scan and cannot be downloaded.
    </p>
  );
}

function BodyProse({ html }: { html: string }) {
  if (!html.trim()) return null;
  return (
    <div
      className="prose-sm max-w-prose [&_a]:text-accent [&_a]:underline"
      // D-30: the write-time sanitisation pass is NOT the last defence — a row
      // written before a sanitiser bug was fixed, or through a path since
      // removed, or by a direct DB edit, must still be safe when read. This
      // second pass runs the SAME `sanitizeLessonBody` on every render. Do not
      // remove it as redundant.
      dangerouslySetInnerHTML={{ __html: sanitizeLessonBody(html) }}
    />
  );
}

function Placeholder({ type }: { type: string }) {
  return (
    <p className="rounded-md border border-border bg-surface-2 px-4 py-2 text-sm text-muted-foreground">
      {type === "QUIZ" ? "Quiz" : "Assignment"} content — assessment authoring and delivery arrive in
      Phase 10. This lesson still holds its place in the order.
    </p>
  );
}

export function LessonContent({ lesson, resources = [] }: LessonContentProps) {
  const withdrawn = lesson.withdrawnAt != null;
  const first = resources[0];

  let body: React.ReactNode;

  switch (lesson.type) {
    case "TEXT": {
      body = <BodyProse html={lesson.body ?? ""} />;
      break;
    }

    case "EMBED": {
      const parsed = lesson.embedUrl ? parseEmbedUrl(lesson.embedUrl) : { ok: false as const, message: "" };
      body = (
        <>
          <BodyProse html={lesson.body ?? ""} />
          {parsed.ok ? (
            <iframe
              src={lesson.embedUrl ?? undefined}
              title={`Embedded content for ${lesson.title}`}
              sandbox="allow-scripts allow-same-origin allow-presentation"
              loading="lazy"
              referrerPolicy="no-referrer"
              allowFullScreen
              className="aspect-video w-full max-w-2xl rounded-lg border border-border bg-surface-2"
            />
          ) : (
            <p role="alert" className="rounded-md border border-danger/30 bg-danger-surface px-4 py-2 text-sm text-danger">
              This embedded content cannot be shown — its address is not an allowed video host.
            </p>
          )}
        </>
      );
      break;
    }

    case "LINK": {
      body = (
        <>
          <BodyProse html={lesson.body ?? ""} />
          {lesson.linkUrl ? (
            <a
              href={lesson.linkUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-accent underline underline-offset-2"
            >
              {lesson.linkUrl}
            </a>
          ) : (
            <p className="text-sm text-muted-foreground">No link was provided for this lesson.</p>
          )}
        </>
      );
      break;
    }

    case "FILE": {
      body = (
        <>
          <BodyProse html={lesson.body ?? ""} />
          {!first ? (
            <p className="text-sm text-muted-foreground">No file has been uploaded for this lesson yet.</p>
          ) : first.scanStatus === "CLEAN" ? (
            <a
              href={DOWNLOAD_ROUTE(first.id)}
              className="inline-flex items-center gap-2 rounded-md border border-input-border bg-surface px-4 py-2 text-sm font-semibold hover:bg-surface-2"
            >
              <span>Download {first.filename}</span>
              <span className="text-[11px] text-muted-foreground">{humanSize(first.sizeBytes)}</span>
            </a>
          ) : (
            <ScanBlocked status={first.scanStatus} />
          )}
        </>
      );
      break;
    }

    case "IMAGE": {
      body = (
        <>
          <BodyProse html={lesson.body ?? ""} />
          {!first ? (
            <p className="text-sm text-muted-foreground">No image has been uploaded for this lesson yet.</p>
          ) : first.scanStatus === "CLEAN" ? (
            <figure className="flex flex-col gap-1">
              {/* No alt text was authored, so `alt` is the empty string and the
                  authored resource title carries the meaning as a visible
                  caption — a filename in `alt` is worse than no alt. */}
              <div className="aspect-video w-full max-w-2xl overflow-hidden rounded-lg border border-border bg-surface-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- the src is a 302 to a
                    short-lived presigned URL; next/image cannot proxy an authorized redirect. */}
                <img
                  src={DOWNLOAD_ROUTE(first.id)}
                  alt=""
                  loading="lazy"
                  className="h-full w-full max-w-full object-contain"
                />
              </div>
              <figcaption className="text-[11px] text-muted-foreground">{first.title || first.filename}</figcaption>
            </figure>
          ) : (
            <ScanBlocked status={first.scanStatus} />
          )}
        </>
      );
      break;
    }

    case "VIDEO": {
      body = (
        <>
          <BodyProse html={lesson.body ?? ""} />
          {!first ? (
            <p className="text-sm text-muted-foreground">No video has been uploaded for this lesson yet.</p>
          ) : first.scanStatus === "CLEAN" ? (
            <LessonMediaPlayer src={DOWNLOAD_ROUTE(first.id)} title={lesson.title} />
          ) : (
            <ScanBlocked status={first.scanStatus} />
          )}
        </>
      );
      break;
    }

    case "QUIZ":
    case "ASSIGNMENT": {
      body = <Placeholder type={lesson.type} />;
      break;
    }

    default: {
      body = <BodyProse html={lesson.body ?? ""} />;
    }
  }

  return (
    <article className="flex flex-col gap-4">
      {withdrawn && (
        <p className="inline-flex w-fit items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-warning">
          Withdrawn — kept visible for cohorts pinned to a version that still includes it
        </p>
      )}
      {body}
    </article>
  );
}
