import { describe, expect, it } from "vitest";
import { EMBED_HOST_ALLOWLIST, parseEmbedUrl, parseLinkUrl } from "@/lib/embed-url";
import { parseLessonInput } from "@/lib/lesson-input";

describe("parseEmbedUrl", () => {
  it("accepts a youtube.com embed URL", () => {
    const result = parseEmbedUrl("https://www.youtube.com/embed/abc");
    expect(result.ok).toBe(true);
  });

  it("accepts a player.vimeo.com embed URL", () => {
    const result = parseEmbedUrl("https://player.vimeo.com/video/1");
    expect(result.ok).toBe(true);
  });

  it("rejects a host outside the allow-list, naming the allow-list", () => {
    const result = parseEmbedUrl("https://evil.example/x");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      for (const host of EMBED_HOST_ALLOWLIST) {
        expect(result.message).toContain(host);
      }
    }
  });

  it("rejects http (https only)", () => {
    const result = parseEmbedUrl("http://www.youtube.com/embed/abc");
    expect(result.ok).toBe(false);
  });

  it("rejects a javascript: URL", () => {
    const result = parseEmbedUrl("javascript:alert(1)");
    expect(result.ok).toBe(false);
  });

  it("rejects a protocol-relative URL", () => {
    const result = parseEmbedUrl("//youtube.com/x");
    expect(result.ok).toBe(false);
  });

  it("never uses a substring match — a lookalike host is rejected", () => {
    const result = parseEmbedUrl("https://youtube.com.evil.example/x");
    expect(result.ok).toBe(false);
  });
});

describe("parseLinkUrl", () => {
  it("accepts any https URL", () => {
    const result = parseLinkUrl("https://anything.example/page");
    expect(result.ok).toBe(true);
  });

  it("rejects a javascript: URL", () => {
    expect(parseLinkUrl("javascript:alert(1)").ok).toBe(false);
  });

  it("rejects a data: URL", () => {
    expect(parseLinkUrl("data:text/html,x").ok).toBe(false);
  });

  it("rejects a file: URL", () => {
    expect(parseLinkUrl("file:///etc/passwd").ok).toBe(false);
  });
});

describe("parseLessonInput", () => {
  it("sanitises body through sanitizeLessonBody before it reaches the database", () => {
    const result = parseLessonInput({
      moduleId: "m1",
      title: "Intro",
      type: "TEXT",
      body: "<script>alert(1)</script><p>ok</p>",
    });
    expect(result.body).not.toContain("<script>");
    expect(result.body).toContain("<p>ok</p>");
  });

  it("rejects an EMBED lesson with an off-allow-list embedUrl", () => {
    expect(() =>
      parseLessonInput({
        moduleId: "m1",
        title: "Video",
        type: "EMBED",
        embedUrl: "https://evil.example",
      }),
    ).toThrow();
  });

  it("succeeds for a QUIZ lesson with a null assessmentId — an empty picker is a readiness gap, not a validation error", () => {
    const result = parseLessonInput({
      moduleId: "m1",
      title: "Chapter quiz",
      type: "QUIZ",
      assessmentId: null,
    });
    expect(result.assessmentId).toBeNull();
  });

  it("succeeds for an ASSIGNMENT lesson with no assessmentId at all", () => {
    const result = parseLessonInput({
      moduleId: "m1",
      title: "Submit your work",
      type: "ASSIGNMENT",
    });
    expect(result.type).toBe("ASSIGNMENT");
  });

  it("accepts required and allowManualComplete as booleans", () => {
    const result = parseLessonInput({
      moduleId: "m1",
      title: "Intro",
      type: "TEXT",
      body: "<p>hello</p>",
      required: false,
      allowManualComplete: false,
    });
    expect(result.required).toBe(false);
    expect(result.allowManualComplete).toBe(false);
  });

  it("requires moduleId", () => {
    expect(() =>
      parseLessonInput({
        title: "Intro",
        type: "TEXT",
        body: "<p>hello</p>",
      }),
    ).toThrow();
  });

  it("rejects an input carrying a position key rather than silently dropping it", () => {
    expect(() =>
      parseLessonInput({
        moduleId: "m1",
        title: "Intro",
        type: "TEXT",
        body: "<p>hello</p>",
        position: 5,
      }),
    ).toThrow();
  });

  it("rejects a TEXT lesson with no body", () => {
    expect(() =>
      parseLessonInput({
        moduleId: "m1",
        title: "Intro",
        type: "TEXT",
      }),
    ).toThrow();
  });

  it("rejects a LINK lesson with no linkUrl", () => {
    expect(() =>
      parseLessonInput({
        moduleId: "m1",
        title: "Read more",
        type: "LINK",
      }),
    ).toThrow();
  });
});
