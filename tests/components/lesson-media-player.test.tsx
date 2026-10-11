import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { LessonMediaPlayer } from "@/components/catalogue/LessonMediaPlayer";
import { LessonContent } from "@/components/catalogue/LessonContent";

afterEach(cleanup);

const SRC = "/api/lesson-resources/vid-1/download";

describe("LessonMediaPlayer captions (NFR-09)", () => {
  it("renders one captions track per caption at the captions route, only the first default", () => {
    const { container } = render(
      <LessonMediaPlayer
        src={SRC}
        title="Intro"
        captions={[
          { id: "cap-en", language: "en", label: "English" },
          { id: "cap-fr", language: "fr-CA", label: "Francais" },
        ]}
      />,
    );
    const tracks = Array.from(container.querySelectorAll("video > track"));
    expect(tracks).toHaveLength(2);
    expect(tracks.map((t) => t.getAttribute("kind"))).toEqual(["captions", "captions"]);
    expect(tracks.map((t) => t.getAttribute("src"))).toEqual([
      "/api/lesson-resources/cap-en/captions",
      "/api/lesson-resources/cap-fr/captions",
    ]);
    expect(tracks.map((t) => t.getAttribute("srclang"))).toEqual(["en", "fr-CA"]);
    expect(tracks.map((t) => t.getAttribute("label"))).toEqual(["English", "Francais"]);
    expect(tracks.map((t) => t.hasAttribute("default"))).toEqual([true, false]);
  });

  it("renders no track element at all without captions", () => {
    const none = render(<LessonMediaPlayer src={SRC} title="Intro" />);
    expect(none.container.querySelector("track")).toBeNull();
    cleanup();
    const empty = render(<LessonMediaPlayer src={SRC} title="Intro" captions={[]} />);
    expect(empty.container.querySelector("track")).toBeNull();
  });

  it("leaves the video src, controls, label and download fallback unchanged", () => {
    const { container } = render(
      <LessonMediaPlayer src={SRC} title="Intro" captions={[{ id: "cap-en", language: "en", label: "English" }]} />,
    );
    const video = container.querySelector("video");
    expect(video?.getAttribute("src")).toBe(SRC);
    expect(video?.hasAttribute("controls")).toBe(true);
    expect(video?.getAttribute("aria-label")).toBe("Intro");
    expect(video?.getAttribute("preload")).toBe("metadata");
    expect(video?.hasAttribute("crossorigin")).toBe(false);
    expect(container.querySelector("video a")?.getAttribute("href")).toBe(SRC);
  });
});

describe("LessonContent passes captions to the video player", () => {
  const lesson = {
    id: "lesson-1",
    title: "Video lesson",
    type: "VIDEO",
    body: null,
    embedUrl: null,
    linkUrl: null,
    withdrawnAt: null,
  };
  const video = {
    id: "vid-1",
    title: "Video",
    filename: "v.mp4",
    mimeType: "video/mp4",
    sizeBytes: "1000",
    uploadStatus: "READY" as const,
  };

  it("renders only the captions that belong to the video resource", () => {
    const { container } = render(
      <LessonContent
        lesson={lesson}
        resources={[video]}
        captions={[
          { id: "cap-en", language: "en", label: "English", videoResourceId: "vid-1" },
          { id: "cap-other", language: "de", label: "Deutsch", videoResourceId: "some-other-video" },
        ]}
      />,
    );
    const tracks = Array.from(container.querySelectorAll("track"));
    expect(tracks.map((t) => t.getAttribute("src"))).toEqual(["/api/lesson-resources/cap-en/captions"]);
  });

  it("renders no track without captions, and none while the video is still uploading", () => {
    const plain = render(<LessonContent lesson={lesson} resources={[video]} />);
    expect(plain.container.querySelector("track")).toBeNull();
    cleanup();
    const uploading = render(
      <LessonContent
        lesson={lesson}
        resources={[{ ...video, uploadStatus: "UPLOADING" }]}
        captions={[{ id: "cap-en", language: "en", label: "English", videoResourceId: "vid-1" }]}
      />,
    );
    expect(uploading.container.querySelector("video")).toBeNull();
    expect(uploading.container.querySelector("track")).toBeNull();
  });
});
