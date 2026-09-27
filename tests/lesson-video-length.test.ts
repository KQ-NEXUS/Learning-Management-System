import { describe, expect, it } from "vitest";
import { formatVideoLength, parseLessonInput, parseLessonUpdateInput, parseVideoLength } from "@/lib/lesson-input";

describe("F-15 — staff-set video length", () => {
  it("reads m:ss, h:mm:ss and plain seconds", () => {
    expect(parseVideoLength("12:30")).toBe(750);
    expect(parseVideoLength("1:02:03")).toBe(3723);
    expect(parseVideoLength("95")).toBe(95);
  });

  it("rejects malformed lengths", () => {
    for (const bad of ["abc", "1:75", "-5", "1::2", "0", "0:00"]) expect(parseVideoLength(bad)).toBeNaN();
  });

  it("formats seconds back for the editor", () => {
    expect(formatVideoLength(750)).toBe("12:30");
    expect(formatVideoLength(3723)).toBe("1:02:03");
    expect(formatVideoLength(null)).toBe("");
  });

  it("the lesson schema stores the parsed seconds, clears on null, and names a bad value", () => {
    expect(parseLessonInput({ moduleId: "m", title: "T", type: "VIDEO", videoDurationSeconds: "10:00" }).videoDurationSeconds).toBe(600);
    expect(parseLessonUpdateInput({ videoDurationSeconds: null }).videoDurationSeconds).toBeNull();
    expect(() => parseLessonUpdateInput({ videoDurationSeconds: "soon" })).toThrow(/video length/i);
  });
});
