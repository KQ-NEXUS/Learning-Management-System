import { describe, expect, it } from "vitest";
import {
  formatLearnerNumber,
  learnerNumberCapacity,
  parseLearnerNumberPattern,
  previewLearnerNumbers,
} from "@/lib/learner-number";

const AT = new Date("2026-10-04T12:00:00.000Z");
const message = (pattern: string) => {
  const parsed = parseLearnerNumberPattern(pattern);
  return parsed.ok ? null : parsed.message;
};

describe("learner number patterns", () => {
  it("issues numbers in order, zero-padded to the counter's width", () => {
    expect(formatLearnerNumber("KQL-######", 1, AT)).toBe("KQL-000001");
    expect(formatLearnerNumber("KQL-######", 2, AT)).toBe("KQL-000002");
    expect(formatLearnerNumber("KQL-######", 482, AT)).toBe("KQL-000482");
  });

  it("supports the registration year, in four or two digits, anywhere in the pattern", () => {
    expect(formatLearnerNumber("KQ/{YY}/#####", 7, AT)).toBe("KQ/26/00007");
    expect(formatLearnerNumber("{YYYY}-STU-####", 15, AT)).toBe("2026-STU-0015");
    expect(formatLearnerNumber("STU####.{YY}", 15, new Date("2031-01-01T00:00:00Z"))).toBe("STU0015.31");
  });

  it("keeps fixed text exactly as typed, including case", () => {
    expect(formatLearnerNumber("kq_Lrn-###", 9, AT)).toBe("kq_Lrn-009");
  });

  it("a number that outgrows its width gets longer rather than failing", () => {
    expect(formatLearnerNumber("KQL-###", 999, AT)).toBe("KQL-999");
    expect(formatLearnerNumber("KQL-###", 1000, AT)).toBe("KQL-1000");
  });

  it("previews the next numbers from wherever the counter stands", () => {
    expect(previewLearnerNumbers("KQL-######", 41, AT)).toEqual(["KQL-000041", "KQL-000042", "KQL-000043"]);
    expect(previewLearnerNumbers("no counter", 1, AT)).toEqual([]);
  });

  it("reports how many learners fit before the number widens", () => {
    expect(learnerNumberCapacity("KQL-######")).toBe(999_999);
    expect(learnerNumberCapacity("KQL-###")).toBe(999);
    expect(learnerNumberCapacity("")).toBeNull();
  });

  it("trims surrounding spaces from a pattern", () => {
    expect(parseLearnerNumberPattern("  KQL-####  ").ok).toBe(true);
  });
});

describe("patterns that are refused, with a reason an administrator can act on", () => {
  it.each([
    ["", /Enter a pattern/],
    ["KQL-", /Add a counter/],
    ["KQL-##", /at least 3 # signs/],
    ["KQL-###-###", /only one counter/],
    ["KQ L-####", /cannot contain spaces/],
    ["KQL*####", /"\*" cannot be used/],
    ["{YYYY}-{YY}-####", /year only once/],
    ["{MM}-####", /only codes in braces are \{YYYY\} and \{YY\}/],
    ["KQL-####}", /only codes in braces/],
    ["K".repeat(38) + "###", /40 characters or fewer/],
  ])("%j", (pattern, expected) => {
    expect(message(pattern)).toMatch(expected);
  });

  it("formatting refuses an invalid pattern or a counter below 1 rather than issuing something wrong", () => {
    expect(() => formatLearnerNumber("KQL-", 1, AT)).toThrow(/Invalid learner number pattern/);
    expect(() => formatLearnerNumber("KQL-####", 0, AT)).toThrow(/starts at 1/);
    expect(() => formatLearnerNumber("KQL-####", 1.5, AT)).toThrow(/starts at 1/);
  });
});
