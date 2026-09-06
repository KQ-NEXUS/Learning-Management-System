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
 * NO <track> ELEMENT. There is no caption source to point one at: neither
 * `Lesson` nor `LessonResource` carries a captions/WebVTT association, and the
 * VIDEO upload allow-list (`src/lib/upload-limits.ts`) accepts only `video/mp4`
 * and `video/webm`. A `<track>` with no `src` renders a "captions" entry in the
 * native menu that does nothing — it advertises an accessibility feature that
 * does not exist. Removing it is honest markup, NOT closure of CR-11 / NFR-09:
 * real caption delivery needs a new scanned-WebVTT data/upload contract and is
 * recorded, unresolved, in
 * `.planning/phases/04.1-design-system-rollout-modern-ui-across-every-existing-surfac/04.1-CAPTIONS-SCOPE.md`.
 */

export type LessonMediaPlayerProps = {
  /** The authorized download route for the CLEAN video resource. */
  src: string;
  /** For the accessible name of the player. */
  title: string;
};

export function LessonMediaPlayer({ src, title }: LessonMediaPlayerProps) {
  return (
    <div className="aspect-video w-full max-w-2xl overflow-hidden rounded-lg border border-border bg-surface-2">
      <video
        controls
        preload="metadata"
        src={src}
        aria-label={title}
        className="h-full w-full bg-foreground"
      >
        Your browser cannot play this video.{" "}
        <a href={src} className="underline">
          Download it instead
        </a>
        .
      </video>
    </div>
  );
}
