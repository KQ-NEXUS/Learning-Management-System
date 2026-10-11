/**
 * Native <video> for a VIDEO lesson. Server-rendered — no client directive.
 *
 * RANGE-REQUEST ASSUMPTION (D-37, `src/lib/upload-limits.ts` `downloadTtlFor`):
 * a <video> element follows the 302 from `/api/lesson-resources/[id]/download`
 * exactly ONCE, caches the resolved presigned URL, and issues every subsequent
 * HTTP Range request straight against that resolved URL — it does not
 * re-resolve the download route per range. That is why plan 04-07 signs VIDEO
 * URLs for 4 hours (`DOWNLOAD_TTL_SECONDS.VIDEO = 14400`) while FILE and IMAGE
 * keep the tight 60-second window: a 2 GB file behind a 60-second signature
 * stalls partway through, which is arithmetic, not a risk.
 *
 * If this is ever swapped for a player that re-resolves per range (an HLS or
 * DASH manifest would), the VIDEO TTL can and should drop back to 60 seconds —
 * and that change must be made deliberately in `src/lib/upload-limits.ts`, not
 * left as an accident.
 *
 * No cross-origin attribute and no cache-busting query parameter: either forces a
 * re-request that defeats the single-resolution assumption above. Native
 * controls are keyboard-accessible and screen-reader-labelled by the browser;
 * a custom player would have to re-earn that and NFR-09 gives no reason to.
 *
 * TRACK ELEMENTS ONLY FOR REAL CAPTION FILES (NFR-09, plan 15-23). A `<track>`
 * is rendered for each entry of the `captions` prop and for nothing else: each
 * entry is a scanned (READY) WebVTT `LessonResource` linked to this video, and
 * its `src` is the same-origin, authorised, uncached route
 * `/api/lesson-resources/{id}/captions` (a `<track>` cannot follow a redirect to
 * object storage without bucket CORS, and a caption file is at most 1 MB). With
 * no captions the markup has no `<track>` at all, so the native menu never
 * advertises captions that do not exist (the 04.1 honest-markup rule, CR-11).
 * Captions are never fabricated from the lesson title or body. The video's own
 * `src` stays the presigned download redirect and still carries no cross-origin
 * attribute, because the track is same-origin.
 */

/** One caption track: a READY WebVTT resource linked to this video. */
export type LessonMediaCaption = {
  /** The caption resource id (not the video's). */
  id: string;
  /** BCP 47 language tag, rendered as `srclang`. */
  language: string;
  /** Shown in the native captions menu. */
  label: string;
};

export type LessonMediaPlayerProps = {
  /** The authorized download route for the CLEAN video resource. */
  src: string;
  /** For the accessible name of the player. */
  title: string;
  /** Caption tracks for this video; omit or pass an empty list for none. */
  captions?: readonly LessonMediaCaption[];
};

const CAPTIONS_ROUTE = (id: string) => `/api/lesson-resources/${id}/captions`;

export function LessonMediaPlayer({ src, title, captions = [] }: LessonMediaPlayerProps) {
  return (
    <div className="aspect-video w-full max-w-2xl overflow-hidden rounded-lg border border-border bg-surface-2">
      <video
        controls
        preload="metadata"
        src={src}
        aria-label={title}
        className="h-full w-full bg-foreground"
      >
        {captions.map((caption, index) => (
          <track
            key={caption.id}
            kind="captions"
            src={CAPTIONS_ROUTE(caption.id)}
            srcLang={caption.language}
            label={caption.label}
            default={index === 0}
          />
        ))}
        Your browser cannot play this video.{" "}
        <a href={src} className="underline">
          Download it instead
        </a>
        .
      </video>
    </div>
  );
}
