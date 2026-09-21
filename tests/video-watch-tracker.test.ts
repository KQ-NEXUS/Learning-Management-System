import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  attachWatchTracker,
  VideoWatchTracker,
  type VideoLike,
} from "@/components/learner/VideoWatchTracker";

/**
 * `src/components/learner/VideoWatchTracker.tsx` (09-12 Task 2).
 *
 * This file runs under Vitest's "node" project (no jsdom) — `attachWatchTracker`
 * is the DOM-library-agnostic attach/detach logic extracted from the
 * component's effect precisely so it can be exercised here against a
 * hand-built fake `<video>` element and fake timers, with only the global
 * `document` stubbed for the `visibilitychange` listener. The React
 * component wrapper itself is proven separately via `renderToStaticMarkup`
 * (rendered-shape only — effects never run during static markup, which is
 * exactly what the "no element other than the wrapping div" assertion
 * needs).
 */

type Handler = () => void;

function createFakeVideo(initial: { currentTime?: number; duration?: number } = {}) {
  const listeners = new Map<string, Set<Handler>>();
  const video = {
    currentTime: initial.currentTime ?? 0,
    duration: initial.duration ?? 100,
    paused: false,
    addEventListener: vi.fn((type: string, handler: Handler) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(handler);
    }),
    removeEventListener: vi.fn((type: string, handler: Handler) => {
      listeners.get(type)?.delete(handler);
    }),
  };

  function fire(type: string) {
    listeners.get(type)?.forEach((handler) => handler());
  }

  function listenerCount() {
    let total = 0;
    listeners.forEach((set) => (total += set.size));
    return total;
  }

  return { video: video as unknown as VideoLike & { paused: boolean }, fire, listenerCount };
}

function createFakeDocument() {
  const listeners = new Map<string, Set<Handler>>();
  const doc = {
    hidden: false,
    addEventListener: vi.fn((type: string, handler: Handler) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(handler);
    }),
    removeEventListener: vi.fn((type: string, handler: Handler) => {
      listeners.get(type)?.delete(handler);
    }),
  };

  function fire(type: string) {
    listeners.get(type)?.forEach((handler) => handler());
  }

  return { doc, fire };
}

let fakeDoc: ReturnType<typeof createFakeDocument>;

beforeEach(() => {
  vi.useFakeTimers();
  fakeDoc = createFakeDocument();
  vi.stubGlobal("document", fakeDoc.doc);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("attachWatchTracker", () => {
  it("dispatches exactly once across 20 timeupdate events inside a 15 second window", async () => {
    const { video, fire } = createFakeVideo();
    const dispatch = vi.fn().mockResolvedValue({ completed: false });

    attachWatchTracker(video, {
      enrolmentId: "enrolment-1",
      lessonId: "lesson-1",
      initialSecondsWatched: 0,
      dispatch,
    });

    for (let i = 0; i < 20; i++) {
      video.currentTime = i;
      fire("timeupdate");
    }
    await vi.runOnlyPendingTimersAsync().catch(() => {});
    await Promise.resolve();

    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("dispatches a second time once the 15 second throttle interval elapses", async () => {
    const { video, fire } = createFakeVideo();
    const dispatch = vi.fn().mockResolvedValue({ completed: false });

    attachWatchTracker(video, {
      enrolmentId: "enrolment-1",
      lessonId: "lesson-1",
      initialSecondsWatched: 0,
      dispatch,
    });

    fire("timeupdate");
    await Promise.resolve();
    expect(dispatch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15000);

    fire("timeupdate");
    await Promise.resolve();

    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("dispatches immediately on pause, bypassing the throttle window", async () => {
    const { video, fire } = createFakeVideo();
    const dispatch = vi.fn().mockResolvedValue({ completed: false });

    attachWatchTracker(video, {
      enrolmentId: "enrolment-1",
      lessonId: "lesson-1",
      initialSecondsWatched: 0,
      dispatch,
    });

    fire("timeupdate");
    await Promise.resolve();
    expect(dispatch).toHaveBeenCalledTimes(1);

    fire("pause");
    await Promise.resolve();

    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("dispatches immediately on ended", async () => {
    const { video, fire } = createFakeVideo();
    const dispatch = vi.fn().mockResolvedValue({ completed: false });

    attachWatchTracker(video, {
      enrolmentId: "enrolment-1",
      lessonId: "lesson-1",
      initialSecondsWatched: 0,
      dispatch,
    });

    fire("ended");
    await Promise.resolve();

    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("dispatches immediately when the document becomes hidden", async () => {
    const { video } = createFakeVideo();
    const dispatch = vi.fn().mockResolvedValue({ completed: false });

    attachWatchTracker(video, {
      enrolmentId: "enrolment-1",
      lessonId: "lesson-1",
      initialSecondsWatched: 0,
      dispatch,
    });

    fakeDoc.doc.hidden = true;
    fakeDoc.fire("visibilitychange");
    await Promise.resolve();

    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch on visibilitychange when the document is still visible", async () => {
    const { video } = createFakeVideo();
    const dispatch = vi.fn().mockResolvedValue({ completed: false });

    attachWatchTracker(video, {
      enrolmentId: "enrolment-1",
      lessonId: "lesson-1",
      initialSecondsWatched: 0,
      dispatch,
    });

    fakeDoc.doc.hidden = false;
    fakeDoc.fire("visibilitychange");
    await Promise.resolve();

    expect(dispatch).not.toHaveBeenCalled();
  });

  it("a rejected dispatch throws nothing and leaves the fake video's paused property unchanged", async () => {
    const { video, fire } = createFakeVideo();
    const dispatch = vi.fn().mockRejectedValue(new Error("network blip"));
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    expect(() => {
      attachWatchTracker(video, {
        enrolmentId: "enrolment-1",
        lessonId: "lesson-1",
        initialSecondsWatched: 0,
        dispatch,
      });
      fire("timeupdate");
    }).not.toThrow();

    await Promise.resolve();
    await Promise.resolve();

    expect(video.paused).toBe(false);
    expect(debugSpy).toHaveBeenCalled();
    debugSpy.mockRestore();
  });

  it("removes every listener it added, from both the video and the document, on cleanup", () => {
    const { video, listenerCount } = createFakeVideo();
    const dispatch = vi.fn().mockResolvedValue({ completed: false });

    const cleanup = attachWatchTracker(video, {
      enrolmentId: "enrolment-1",
      lessonId: "lesson-1",
      initialSecondsWatched: 0,
      dispatch,
    });

    expect(listenerCount()).toBe(4); // loadedmetadata, timeupdate, pause, ended
    expect(fakeDoc.doc.addEventListener).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );

    cleanup();

    expect(listenerCount()).toBe(0);
    expect(fakeDoc.doc.removeEventListener).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
  });

  it("resumes playback at initialSecondsWatched when it is greater than zero and less than duration", () => {
    const { video, fire } = createFakeVideo({ duration: 100 });
    const dispatch = vi.fn().mockResolvedValue({ completed: false });

    attachWatchTracker(video, {
      enrolmentId: "enrolment-1",
      lessonId: "lesson-1",
      initialSecondsWatched: 42,
      dispatch,
    });

    fire("loadedmetadata");

    expect(video.currentTime).toBe(42);
  });

  it("does not resume when initialSecondsWatched is zero", () => {
    const { video, fire } = createFakeVideo({ duration: 100, currentTime: 0 });
    const dispatch = vi.fn().mockResolvedValue({ completed: false });

    attachWatchTracker(video, {
      enrolmentId: "enrolment-1",
      lessonId: "lesson-1",
      initialSecondsWatched: 0,
      dispatch,
    });

    fire("loadedmetadata");

    expect(video.currentTime).toBe(0);
  });

  it("stops dispatching further writes once a dispatch resolves completed: true", async () => {
    const { video, fire } = createFakeVideo();
    const dispatch = vi.fn().mockResolvedValue({ completed: true });

    attachWatchTracker(video, {
      enrolmentId: "enrolment-1",
      lessonId: "lesson-1",
      initialSecondsWatched: 0,
      dispatch,
    });

    fire("timeupdate");
    await Promise.resolve();
    expect(dispatch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15000);
    fire("timeupdate");
    await Promise.resolve();

    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("flushes one final write on unmount cleanup", async () => {
    const { video } = createFakeVideo();
    const dispatch = vi.fn().mockResolvedValue({ completed: false });

    const cleanup = attachWatchTracker(video, {
      enrolmentId: "enrolment-1",
      lessonId: "lesson-1",
      initialSecondsWatched: 0,
      dispatch,
    });

    cleanup();
    await Promise.resolve();

    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});

describe("VideoWatchTracker component shape", () => {
  it("renders no element other than the wrapping div plus its children", () => {
    const props = {
      enrolmentId: "enrolment-1",
      lessonId: "lesson-1",
      initialSecondsWatched: 0,
      children: createElement("video", { controls: true, src: "/x", "data-testid": "child-video" }),
    };
    const html = renderToStaticMarkup(
      createElement(VideoWatchTracker, props),
    );

    expect(html).toMatch(/^<div[^>]*><video[^>]*><\/video><\/div>$/);
  });
});
