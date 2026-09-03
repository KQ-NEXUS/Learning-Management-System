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
 */

export type LessonMediaPlayerProps = {
  /** The authorized download route for the CLEAN video resource. */
  src: string;
  /** For the accessible name of the player. */
  title: string;
};

export function LessonMediaPlayer({ src, title }: LessonMediaPlayerProps) {
  return (
    <video
      controls
      preload="metadata"
      src={src}
      aria-label={title}
      className="w-full max-w-2xl border border-zinc-200 bg-black"
    >
      {/*
        Caption slot. No caption upload exists yet — Phase 9 or 15 should
        REQUIRE a captions file for WCAG 1.2.2 rather than leaving this empty
        forever. Kept in the markup so that requirement has somewhere to land.
      */}
      <track kind="captions" srcLang="en" label="English captions" />
      Your browser cannot play this video.{" "}
      <a href={src} className="underline">
        Download it instead
      </a>
      .
    </video>
  );
}
