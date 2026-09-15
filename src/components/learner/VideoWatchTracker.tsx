"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { recordWatchProgressAction } from "@/app/(learner)/learn/[enrolmentId]/lessons/[lessonId]/actions";

/**
 * VideoWatchTracker — the D-09/D-08 auto-completion client island (09-12
 * Task 2).
 *
 * DD-2: a client-boundary wrapper that takes the server-rendered subtree
 * (`LessonMediaPlayer`, ultimately `LessonContent`'s VIDEO branch) as
 * `children` and locates the native `<video>` element through a ref on its
 * OWN wrapping `<div>` (`containerRef.current.querySelector("video")`) —
 * never a prop threaded into `LessonMediaPlayer.tsx`, which stays a Server
 * Component with no client directive, per that file's own doc comment.
 *
 * DD-30: renders NOTHING but `children` inside a bare wrapping `<div>` — no
 * percentage figure, on-screen bar, caption, or visual layer of any kind is
 * drawn on top of the native player. The browser's own controls remain the
 * sole visible indicator (UI-SPEC §7.3, explicit).
 *
 * DD-28: at most ONE `recordWatchProgressAction` dispatch per 15 seconds of
 * wall clock while `timeupdate` fires (which happens roughly 4x/second —
 * Pitfall 3 in 09-RESEARCH.md), plus an immediate flush on `pause`, `ended`,
 * and `visibilitychange` to hidden. An in-flight guard additionally blocks a
 * new dispatch while a prior one is still resolving, so a slow response can
 * never queue a backlog (Server Actions dispatch sequentially per client).
 *
 * DD-29: every dispatch is wrapped in try/catch; a failure is logged via
 * `console.debug` only, never surfaced as an error state, and never touches
 * playback — no `pause()`, no `preventDefault()`. 09-06's forward-only
 * high-water mark means the next throttled tick simply repairs the gap.
 *
 * Once a dispatch resolves `{ completed: true }`, no further writes are
 * sent for the remainder of this mount — the server write is already
 * idempotent, but a completed lesson has nothing left worth recording.
 */

const THROTTLE_MS = 15000;

/** The narrow slice of `HTMLVideoElement` this file actually reads/attaches
 *  to — narrow enough that a hand-built fake object satisfies it in tests
 *  without a real DOM element. */
export type VideoLike = Pick<
  HTMLVideoElement,
  "currentTime" | "duration" | "addEventListener" | "removeEventListener"
>;

export type WatchWriteDispatcher = (input: {
  enrolmentId: string;
  lessonId: string;
  secondsWatched: number;
  durationSeconds: number | null;
}) => Promise<{ completed: boolean }>;

export type AttachWatchTrackerDeps = {
  enrolmentId: string;
  lessonId: string;
  /** The learner's own stored high-water mark — 0 when no row exists yet. */
  initialSecondsWatched: number;
  /** Injectable for tests; defaults to the real Server Action. */
  dispatch?: WatchWriteDispatcher;
};

/**
 * The DOM-library-agnostic attach/detach logic, extracted from the React
 * effect below so it can be unit tested against a fake `<video>` element and
 * fake timers with no real browser or jsdom environment involved — the
 * `VideoWatchTracker` component wrapper is the only React-specific part of
 * this file. Returns a cleanup function that removes every listener, clears
 * any pending throttle timer, and flushes one final write.
 */
export function attachWatchTracker(video: VideoLike, deps: AttachWatchTrackerDeps): () => void {
  const dispatch = deps.dispatch ?? recordWatchProgressAction;

  const position = { currentTime: 0, durationSeconds: null as number | null };
  let completed = false;
  let inFlight = false;
  let throttled = false;
  let throttleTimer: ReturnType<typeof setTimeout> | null = null;

  function clearThrottleTimer() {
    if (throttleTimer !== null) {
      clearTimeout(throttleTimer);
      throttleTimer = null;
    }
  }

  function armThrottle() {
    clearThrottleTimer();
    throttled = true;
    throttleTimer = setTimeout(() => {
      throttled = false;
      throttleTimer = null;
    }, THROTTLE_MS);
  }

  async function runDispatch() {
    if (completed || inFlight) return;
    inFlight = true;
    try {
      const result = await dispatch({
        enrolmentId: deps.enrolmentId,
        lessonId: deps.lessonId,
        secondsWatched: Math.floor(position.currentTime),
        durationSeconds: position.durationSeconds,
      });
      if (result.completed) completed = true;
    } catch (error) {
      // DD-29 — swallowed, never surfaced, never touches playback.
      console.debug("VideoWatchTracker: watch write failed", error);
    } finally {
      inFlight = false;
    }
  }

  function handleLoadedMetadata() {
    const duration = video.duration;
    position.durationSeconds = Number.isFinite(duration) ? duration : null;
    if (
      deps.initialSecondsWatched > 0 &&
      Number.isFinite(duration) &&
      deps.initialSecondsWatched < duration
    ) {
      video.currentTime = deps.initialSecondsWatched;
    }
  }

  function handleTimeUpdate() {
    position.currentTime = video.currentTime;
    if (Number.isFinite(video.duration)) position.durationSeconds = video.duration;
    if (completed || throttled) return;
    armThrottle();
    void runDispatch();
  }

  /** Bypasses the throttle window entirely — `pause`/`ended`/hidden are each
   *  a deliberate "stopped watching" signal, not a high-frequency tick. */
  function flushNow() {
    if (completed) return;
    armThrottle();
    void runDispatch();
  }

  function handlePause() {
    flushNow();
  }

  function handleEnded() {
    flushNow();
  }

  function handleVisibilityChange() {
    if (document.hidden) flushNow();
  }

  video.addEventListener("loadedmetadata", handleLoadedMetadata);
  video.addEventListener("timeupdate", handleTimeUpdate);
  video.addEventListener("pause", handlePause);
  video.addEventListener("ended", handleEnded);
  document.addEventListener("visibilitychange", handleVisibilityChange);

  return () => {
    video.removeEventListener("loadedmetadata", handleLoadedMetadata);
    video.removeEventListener("timeupdate", handleTimeUpdate);
    video.removeEventListener("pause", handlePause);
    video.removeEventListener("ended", handleEnded);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    clearThrottleTimer();
    // One final write on unmount — fire-and-forget over refs/closures only,
    // there is no component state left to update.
    void runDispatch();
  };
}

export type VideoWatchTrackerProps = {
  enrolmentId: string;
  lessonId: string;
  /** The learner's own stored high-water mark — 0 when no row exists yet. */
  initialSecondsWatched: number;
  children: ReactNode;
};

export function VideoWatchTracker({
  enrolmentId,
  lessonId,
  initialSecondsWatched,
  children,
}: VideoWatchTrackerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const video = containerRef.current?.querySelector("video");
    if (!video) return;

    return attachWatchTracker(video, { enrolmentId, lessonId, initialSecondsWatched });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrolmentId, lessonId, initialSecondsWatched]);

  return <div ref={containerRef}>{children}</div>;
}
