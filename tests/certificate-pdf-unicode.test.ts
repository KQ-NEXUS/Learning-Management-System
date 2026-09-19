import { Buffer } from "node:buffer";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { CERTIFICATE_FONT_FILENAME, loadCertificateFontBytes } from "@/server/services/certificate-font";
import {
  renderCertificatePdf,
  sanitiseCertificateText,
  type CertificateRenderFields,
} from "@/server/services/certificate-pdf-renderer";
import type { CertificateElementV1, CertificateTemplateLayoutV1 } from "@/server/services/certificate-template-layout";
import { extractPdfText, readTextPlacements } from "./support/pdf-content";

// CR-01: the renderer embedded only Helvetica (WinAnsi), so real Yoruba, Polish
// and other Latin-extended names made widthOfTextAtSize/drawText throw and
// aborted certificate generation. These tests run REAL names through the REAL
// renderer with the bundled font (no mocks).

const FONT_DIRECTORY = path.join(process.cwd(), "assets", "fonts", "certificate");

const BASE_FIELDS: CertificateRenderFields = {
  learnerName: "Amara Okafor",
  awardTitle: "Certificate in Applied Data Science",
  issuedAt: new Date("2026-03-14T00:00:00.000Z"),
  verificationRef: "CERT-9K2X7QF4",
};

const noAssets = async (assetKey: string): Promise<Uint8Array> => {
  throw new Error(`unexpected asset request: ${assetKey}`);
};

function textElement(
  overrides: Partial<Extract<CertificateElementV1, { kind: "text" }>> = {},
): Extract<CertificateElementV1, { kind: "text" }> {
  return {
    kind: "text",
    field: "literal",
    literal: "Sample",
    x: 40,
    y: 40,
    width: 500,
    height: 40,
    fontSize: 20,
    color: "#000000",
    align: "left",
    ...overrides,
  };
}

function layoutOf(elements: CertificateElementV1[]): CertificateTemplateLayoutV1 {
  return { schema: 1, pageSize: "A4", orientation: "landscape", elements };
}

async function renderLearnerName(learnerName: string): Promise<Uint8Array> {
  return renderCertificatePdf({
    layout: layoutOf([textElement({ field: "learnerName" })]),
    fields: { ...BASE_FIELDS, learnerName },
    resolveAsset: noAssets,
  });
}

async function renderLiteral(literal: string): Promise<Uint8Array> {
  return renderCertificatePdf({
    layout: layoutOf([textElement({ literal })]),
    fields: BASE_FIELDS,
    resolveAsset: noAssets,
  });
}

function startsWithPdfMagic(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "%PDF";
}

describe("Latin-extended, Yoruba and diacritic names render as real glyphs (CR-01)", () => {
  const names: Array<[string, string]> = [
    ["Yoruba (precomposed dot-below + tone marks)", "Adébáyọ̀ Ṣolá"],
    ["Yoruba (Olorun Elegbe)", "Ọlọ́run Ẹlẹ́gbẹ́"],
    ["Polish", "Łukasz Żółć"],
    ["French/German/Spanish/Portuguese accents", "François Müller-Ñandú"],
    ["Yoruba in DECOMPOSED form (normalised to NFC)", "Ọ̀ Ṣolá"],
  ];

  it.each(names)("%s renders and the recovered text equals the NFC-normalised input", async (_label, name) => {
    const bytes = await renderLearnerName(name);
    expect(startsWithPdfMagic(bytes)).toBe(true);
    expect(extractPdfText(bytes)).toBe(name.normalize("NFC"));
  });

  it("keeps plain ASCII text byte-for-byte unchanged", async () => {
    const ascii = "Certificate of Completion 2026 - CERT-9K2X7QF4";
    expect(extractPdfText(await renderLiteral(ascii))).toBe(ascii);
  });

  it("produces a small PDF for a Yoruba certificate (the font is subset, not embedded whole)", async () => {
    const bytes = await renderLearnerName("Adébáyọ̀ Ṣolá");
    expect(bytes.length).toBeLessThan(200 * 1024);
  });
});

describe("unsupported scripts and control characters can never make the renderer throw (CR-01)", () => {
  it("draws each unsupported CJK code point as a question mark", async () => {
    const bytes = await renderLearnerName("山田 太郎");
    expect(startsWithPdfMagic(bytes)).toBe(true);
    expect(extractPdfText(bytes)).toBe("?? ??");
  });

  it("draws each unsupported Arabic code point as a question mark", async () => {
    const bytes = await renderLearnerName("محمد");
    expect(extractPdfText(bytes)).toBe("????");
  });

  it("draws an emoji (one astral code point) as exactly one question mark", async () => {
    const bytes = await renderLearnerName("Ada \u{1F600} Obi");
    expect(extractPdfText(bytes)).toBe("Ada ? Obi");
  });

  it("leaves supported neighbours of an unsupported character unchanged", async () => {
    const bytes = await renderLearnerName("José 山 Ọṣọ");
    expect(extractPdfText(bytes)).toBe("José ? Ọṣọ");
  });

  it("renders a literal with newlines, CRLF, tabs and a BEL control character", async () => {
    const bytes = await renderLiteral("Line one\nLine two\r\nLine\tthree\u0007end");
    expect(startsWithPdfMagic(bytes)).toBe(true);
    expect(extractPdfText(bytes)).toBe("Line one Line two Line three" + "end");
  });

  it("renders an empty string", async () => {
    const bytes = await renderLiteral("");
    expect(startsWithPdfMagic(bytes)).toBe(true);
  });

  it("draws a very long value in full rather than truncating it", async () => {
    const long = "Ọ".repeat(200);
    const bytes = await renderLiteral(long);
    expect(extractPdfText(bytes)).toBe(long);
    const [placement] = readTextPlacements(bytes);
    expect(placement.text.length).toBe(200);
  });
});

describe("sanitiseCertificateText", () => {
  async function embeddedFont() {
    const document = await PDFDocument.create();
    document.registerFontkit(fontkit);
    return document.embedFont(await loadCertificateFontBytes(), { subset: true });
  }

  it("normalises to NFC, collapses line breaks and tabs, drops other controls, replaces unsupported code points", async () => {
    const font = await embeddedFont();
    expect(sanitiseCertificateText(font, "ọ̀")).toBe("ọ̀");
    expect(sanitiseCertificateText(font, "a\r\n\t\nb")).toBe("a b");
    expect(sanitiseCertificateText(font, "a\u0007\u0085b")).toBe("ab");
    expect(sanitiseCertificateText(font, "山\u{1F600}")).toBe("??");
    expect(sanitiseCertificateText(font, "")).toBe("");
  });

  it("does not throw for lone surrogates or arbitrary code points", async () => {
    const font = await embeddedFont();
    expect(() => sanitiseCertificateText(font, "\ud800x\udc00")).not.toThrow();
    const sample = Array.from({ length: 2000 }, (_, i) => String.fromCodePoint((i * 7919) % 0x10ffff)).join("");
    expect(() => sanitiseCertificateText(font, sample)).not.toThrow();
  });
});

describe("renderer never falls back to a standard font", () => {
  it("contains no live reference to StandardFonts", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src", "server", "services", "certificate-pdf-renderer.ts"),
      "utf8",
    );
    const code = source
      .split("\n")
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join("\n");
    expect(code).not.toMatch(/StandardFonts/);
  });
});

describe("certificate font loader", () => {
  it("resolves the bundled font from the project root and returns cached bytes on the second call", async () => {
    const first = await loadCertificateFontBytes();
    const second = await loadCertificateFontBytes();
    expect(first.length).toBeGreaterThan(1024);
    expect(second).toBe(first);
    expect(Buffer.from(first).equals(readFileSync(path.join(FONT_DIRECTORY, CERTIFICATE_FONT_FILENAME)))).toBe(true);
  });

  it("does not cache a rejected read: a later call retries and succeeds", async () => {
    vi.resetModules();
    const fresh = await import("@/server/services/certificate-font");
    await expect(fresh.loadCertificateFontBytes(path.join(process.cwd(), "no-such-root"))).rejects.toThrow();
    const bytes = await fresh.loadCertificateFontBytes();
    expect(bytes.length).toBeGreaterThan(1024);
  });

  it("CERTIFICATE_FONT_FILENAME equals the Filename: line recorded in the font README, and that file exists", () => {
    const readme = readFileSync(path.join(FONT_DIRECTORY, "README.md"), "utf8");
    const match = /^Filename:\s*(.+?)\s*$/m.exec(readme);
    expect(match).not.toBeNull();
    expect(CERTIFICATE_FONT_FILENAME).toBe(match![1]);
    expect(existsSync(path.join(FONT_DIRECTORY, CERTIFICATE_FONT_FILENAME))).toBe(true);
  });
});
