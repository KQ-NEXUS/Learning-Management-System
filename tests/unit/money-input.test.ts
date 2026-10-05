import { describe, expect, it } from "vitest";
import { majorToMinorString, minorToMajorString } from "@/lib/money-input";

describe("minorToMajorString", () => {
  it("shows whole naira without decimals and keeps real kobo", () => {
    expect(minorToMajorString(45_000_000)).toBe("450000");
    expect(minorToMajorString(45_000_050)).toBe("450000.50");
    expect(minorToMajorString(5)).toBe("0.05");
    expect(minorToMajorString(0)).toBe("0");
  });

  it("is empty when there is no price", () => {
    expect(minorToMajorString(null)).toBe("");
    expect(minorToMajorString(undefined)).toBe("");
  });
});

describe("majorToMinorString", () => {
  it("turns naira and dollars into kobo and cents", () => {
    expect(majorToMinorString("450000")).toBe("45000000");
    expect(majorToMinorString("450000.5")).toBe("45000050");
    expect(majorToMinorString("500.00")).toBe("50000");
    expect(majorToMinorString("0.05")).toBe("5");
    expect(majorToMinorString("0")).toBe("0");
  });

  it("accepts thousands separators and surrounding spaces", () => {
    expect(majorToMinorString(" 450,000 ")).toBe("45000000");
  });

  it("does not drift on amounts that floating point gets wrong", () => {
    expect(majorToMinorString("1.15")).toBe("115");
    expect(majorToMinorString("19.99")).toBe("1999");
  });

  it("is empty for a blank field", () => {
    expect(majorToMinorString("")).toBe("");
    expect(majorToMinorString("   ")).toBe("");
  });

  it("hands anything that is not an amount back unchanged, so the server refuses it", () => {
    expect(majorToMinorString("abc")).toBe("abc");
    expect(majorToMinorString("12.345")).toBe("12.345");
    expect(majorToMinorString("-5")).toBe("-5");
  });

  it("round-trips with minorToMajorString", () => {
    for (const minor of [0, 5, 100, 12_345, 45_000_050, 50_000]) {
      expect(majorToMinorString(minorToMajorString(minor))).toBe(String(minor));
    }
  });
});
