import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LessonContent } from "@/components/catalogue/LessonContent";

afterEach(cleanup);

type LessonInput = Parameters<typeof LessonContent>[0]["lesson"];
type ResourceInput = NonNullable<Parameters<typeof LessonContent>[0]["resources"]>[number];

const lesson = (over: Partial<LessonInput> & Pick<LessonInput, "type">): LessonInput => ({
  id: "lesson-1",
  title: "A lesson",
  body: null,
  embedUrl: null,
  linkUrl: null,
  withdrawnAt: null,
  ...over,
});

const resource = (over: Partial<ResourceInput> & Pick<ResourceInput, "scanStatus">): ResourceInput => ({
  id: "res-1",
  title: "Handout",
  filename: "handout.pdf",
  mimeType: "application/pdf",
  sizeBytes: "1048576",
  ...over,
});

describe("LessonContent", () => {
  it("strips a stored script, H1 and style attribute from a TEXT body at render time", () => {
    const { container } = render(
      <LessonContent
        lesson={lesson({
          type: "TEXT",
          body: '<script>alert(1)</script><h1>x</h1><p style="color:red">y</p>',
        })}
      />,
    );
    expect(container.innerHTML).not.toContain("<script");
    expect(container.querySelector("h1")).toBeNull();
    expect(container.querySelector("[style]")).toBeNull();
    expect(container.querySelector("p")?.textContent).toBe("y");
  });

  it("renders an EMBED as a sandboxed, titled, lazy iframe with the stored src", () => {
    const { container } = render(
      <LessonContent
        lesson={lesson({ type: "EMBED", embedUrl: "https://www.youtube.com/watch?v=abc123" })}
      />,
    );
    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toBe("https://www.youtube.com/watch?v=abc123");
    expect(iframe?.getAttribute("sandbox")).toBeTruthy();
    expect(iframe?.getAttribute("title")).toBeTruthy();
    expect(iframe?.getAttribute("loading")).toBe("lazy");
    expect(iframe?.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("renders a fallback and NO iframe when the stored embedUrl fails host validation", () => {
    const { container } = render(
      <LessonContent lesson={lesson({ type: "EMBED", embedUrl: "https://evil.example/x" })} />,
    );
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.getByText(/cannot be shown|not an allowed|unavailable/i)).toBeTruthy();
  });

  it("renders a working download link for a FILE lesson with a CLEAN resource", () => {
    render(
      <LessonContent
        lesson={lesson({ type: "FILE" })}
        resources={[resource({ scanStatus: "CLEAN", filename: "notes.pdf", sizeBytes: "2097152" })]}
      />,
    );
    const link = screen.getByRole("link", { name: /download|notes\.pdf/i });
    expect(link.getAttribute("href")).toBe("/api/lesson-resources/res-1/download");
    expect(screen.getByText(/2(\.0)? MB/i)).toBeTruthy();
  });

  it("renders Scanning and NO download link for a PENDING resource", () => {
    const { container } = render(
      <LessonContent lesson={lesson({ type: "FILE" })} resources={[resource({ scanStatus: "PENDING" })]} />,
    );
    expect(screen.getByText(/scanning/i)).toBeTruthy();
    expect(container.querySelector('a[href*="/api/lesson-resources/"]')).toBeNull();
  });

  it.each(["INFECTED", "ERROR"] as const)("renders a blocked notice and NO download for a %s resource", (scanStatus) => {
    const { container } = render(
      <LessonContent lesson={lesson({ type: "FILE" })} resources={[resource({ scanStatus })]} />,
    );
    expect(screen.getByText(/blocked|did not pass|security scan/i)).toBeTruthy();
    expect(container.querySelector('a[href*="/api/lesson-resources/"]')).toBeNull();
  });

  it("gives an IMAGE an empty alt and a visible caption rather than a filename in alt", () => {
    const { container } = render(
      <LessonContent
        lesson={lesson({ type: "IMAGE" })}
        resources={[resource({ scanStatus: "CLEAN", title: "Site plan", filename: "plan-final-v3.png", mimeType: "image/png" })]}
      />,
    );
    const img = container.querySelector("img");
    expect(img?.getAttribute("alt")).toBe("");
    expect(img?.getAttribute("alt")).not.toContain("plan-final-v3");
    expect(screen.getByText("Site plan")).toBeTruthy();
  });

  it("renders a native video with metadata preload, an authorized src, no crossorigin and no source-less track", () => {
    const { container } = render(
      <LessonContent
        lesson={lesson({ type: "VIDEO" })}
        resources={[resource({ scanStatus: "CLEAN", filename: "intro.mp4", mimeType: "video/mp4" })]}
      />,
    );
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.hasAttribute("controls")).toBe(true);
    expect(video?.getAttribute("preload")).toBe("metadata");
    expect(video?.getAttribute("src")).toBe("/api/lesson-resources/res-1/download");
    expect(video?.getAttribute("src")).not.toContain("?");
    expect(video?.hasAttribute("crossorigin")).toBe(false);

    // CR-11 partial remediation: no <track> may be emitted without a real
    // source. An empty captions track advertises captions that do not exist.
    const tracks = Array.from(container.querySelectorAll("track"));
    for (const track of tracks) {
      expect(track.getAttribute("src")).toBeTruthy();
    }
    expect(container.querySelector("track:not([src])")).toBeNull();
  });

  it("keeps a CLEAN video playable — the track removal does not remove the video", () => {
    const { container } = render(
      <LessonContent
        lesson={lesson({ type: "VIDEO" })}
        resources={[resource({ scanStatus: "CLEAN", filename: "intro.webm", mimeType: "video/webm" })]}
      />,
    );
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.getAttribute("src")).toBe("/api/lesson-resources/res-1/download");
    const fallback = container.querySelector("video a");
    expect(fallback?.getAttribute("href")).toBe("/api/lesson-resources/res-1/download");
  });

  it("blocks a non-CLEAN video and renders no <video> element", () => {
    const { container } = render(
      <LessonContent
        lesson={lesson({ type: "VIDEO" })}
        resources={[resource({ scanStatus: "INFECTED", filename: "intro.mp4", mimeType: "video/mp4" })]}
      />,
    );
    expect(container.querySelector("video")).toBeNull();
    expect(screen.getByText(/blocked|did not pass|security scan/i)).toBeTruthy();
  });

  it("renders a LINK as an anchor with rel noopener noreferrer nofollow", () => {
    render(<LessonContent lesson={lesson({ type: "LINK", linkUrl: "https://example.com/resource" })} />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("https://example.com/resource");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer nofollow");
  });

  it.each(["QUIZ", "ASSIGNMENT"] as const)("renders a %s placeholder naming Phase 10", (type) => {
    render(<LessonContent lesson={lesson({ type })} />);
    expect(screen.getByText(/Phase 10/)).toBeTruthy();
  });

  it("renders a withdrawn lesson read-only with a visible Withdrawn marker", () => {
    render(
      <LessonContent
        lesson={lesson({ type: "TEXT", body: "<p>still here</p>", withdrawnAt: new Date("2026-01-01") })}
      />,
    );
    expect(screen.getByText(/withdrawn/i)).toBeTruthy();
    expect(screen.getByText("still here")).toBeTruthy();
  });
});
