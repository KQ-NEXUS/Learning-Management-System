import { createHash } from "node:crypto";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import * as fontkit from "@pdf-lib/fontkit";
import { describe, expect, it } from "vitest";

const FONT_DIR = path.resolve(process.cwd(), "assets/fonts/certificate");
const README_PATH = path.join(FONT_DIR, "README.md");

/** SHA-256 pinned from the human-approved file (orchestrator-verified). */
const PINNED_SHA256 = "FE8C022F48D8DD29F17B744D16F9346F4357E16F7D4F7BE58B000AE7C291B614";

function readLabelled(readme: string, label: string): string {
  const lines = readme.split(/\r?\n/).filter((l) => l.startsWith(`${label}:`));
  expect(lines, `README.md must contain exactly one "${label}:" line`).toHaveLength(1);
  return lines[0]!.slice(label.length + 1).trim();
}

const readme = readFileSync(README_PATH, "utf8");
const recordedFilename = readLabelled(readme, "Filename");
const recordedHash = readLabelled(readme, "SHA-256");
const recordedLicence = readLabelled(readme, "Licence");
const fontPath = path.join(FONT_DIR, recordedFilename);

function codePoints(s: string): number[] {
  return Array.from(s, (c) => c.codePointAt(0)!);
}

describe("certificate font asset", () => {
  it("records every labelled provenance value in README.md", () => {
    for (const label of [
      "Filename",
      "Font name",
      "Version",
      "Source URL",
      "Licence",
      "SHA-256",
      "Decided by / Date",
    ]) {
      expect(readLabelled(readme, label).length).toBeGreaterThan(0);
    }
    expect(recordedHash).toMatch(/^[0-9A-Fa-f]{64}$/);
    expect(readme).toMatch(/limitation/i);
  });

  it("the recorded Filename exists and is the only .ttf in the directory", () => {
    expect(existsSync(fontPath)).toBe(true);
    const ttfs = readdirSync(FONT_DIR).filter((f) => f.toLowerCase().endsWith(".ttf"));
    expect(ttfs).toEqual([recordedFilename]);
  });

  it("guard: the recorded file's SHA-256 equals the README value and the pinned value", () => {
    const digest = createHash("sha256").update(readFileSync(fontPath)).digest("hex");
    expect(digest.toUpperCase()).toBe(recordedHash.toUpperCase());
    expect(digest.toUpperCase()).toBe(PINNED_SHA256);
  });

  it("a licence text file exists and names the licence recorded in README.md", () => {
    const licencePath = path.join(FONT_DIR, "LICENSE.txt");
    expect(existsSync(licencePath)).toBe(true);
    const text = readFileSync(licencePath, "utf8").toLowerCase();
    // README records "SIL Open Font License, Version 1.1"; match the stable core.
    expect(recordedLicence.toLowerCase()).toContain("open font license");
    expect(text).toContain("open font license");
    expect(text).toContain("copyright");
  });

  describe("glyph coverage (read through @pdf-lib/fontkit)", () => {
    const font = fontkit.create(new Uint8Array(readFileSync(fontPath)));

    const required: Array<[string, string]> = [
      ["ASCII letters and digits", "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"],
      ["Yoruba precomposed", "ẸẹỌọṢṣ"],
      ["combining grave/acute/macron", "̀́̄"],
      ["Polish L-stroke", "Łł"],
      ["Western European accents", "éüñçöå"],
    ];

    it("has a glyph for every required code point", () => {
      const missing: string[] = [];
      for (const [, chars] of required) {
        for (const cp of codePoints(chars)) {
          if (!font.hasGlyphForCodePoint(cp)) {
            missing.push(`U+${cp.toString(16).toUpperCase().padStart(4, "0")}`);
          }
        }
      }
      expect(missing, `missing code points: ${missing.join(", ")}`).toEqual([]);
    });

    it("lays out Yoruba and Polish sample strings with zero .notdef glyphs", () => {
      const samples = [
        "Ọlá Ṣẹ́gun Adéwálé", // Yoruba, precomposed + combining
        "Ọlá Ṣẹ́gun Adéwálé".normalize("NFD"),
        "Zbigniew Łukasiewicz Żółć",
        "José Müller Peña François",
      ];
      for (const sample of samples) {
        const run = font.layout(sample);
        const notdef = run.glyphs.filter((g) => g.id === 0);
        expect(notdef, `.notdef glyphs in "${sample}"`).toHaveLength(0);
        expect(run.glyphs.length).toBeGreaterThan(0);
      }
    });
  });
});
