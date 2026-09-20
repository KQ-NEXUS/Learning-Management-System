import { describe, expect, it, vi } from "vitest";
import { generateVerificationRef } from "@/server/services/certificate-reference";

const PREFIX = "CERT-";
const HEX_ALPHABET_SIZE = 16;

describe("generateVerificationRef", () => {
  it("uses the CERT- prefix", () => {
    expect(generateVerificationRef().startsWith(PREFIX)).toBe(true);
  });

  it("produces 10,000 distinct successive references", () => {
    const references = new Set<string>();
    for (let index = 0; index < 10_000; index += 1) {
      references.add(generateVerificationRef());
    }
    expect(references).toHaveLength(10_000);
  });

  it("encodes at least 128 bits in the random segment", () => {
    const randomSegment = generateVerificationRef().slice(PREFIX.length);
    const entropyBits = randomSegment.length * Math.log2(HEX_ALPHABET_SIZE);
    expect(randomSegment).toMatch(/^[0-9A-F]+$/);
    expect(entropyBits).toBeGreaterThanOrEqual(128);
  });

  it("contains only uppercase letters, digits, and hyphens", () => {
    expect(generateVerificationRef()).toMatch(/^[A-Z0-9-]+$/);
  });

  it("contains neither a date stamp nor caller-derived data", () => {
    const reference = generateVerificationRef();
    expect(generateVerificationRef).toHaveLength(0);
    expect(reference).toMatch(/^CERT-[0-9A-F]{32}$/);
    expect(reference).not.toContain("20260916");
  });

  it("uses independent random segments for references generated in the same millisecond", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    try {
      const first = generateVerificationRef();
      const second = generateVerificationRef();
      expect(first.slice(PREFIX.length)).not.toBe(second.slice(PREFIX.length));
      expect(first.slice(0, PREFIX.length)).toBe(second.slice(0, PREFIX.length));
    } finally {
      vi.restoreAllMocks();
    }
  });
});
