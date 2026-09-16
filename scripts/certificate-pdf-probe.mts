import fontkit from "@pdf-lib/fontkit";
import { access, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, rgb } from "pdf-lib";

const A4_LANDSCAPE: [number, number] = [841.89, 595.28];
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nVQAAAAASUVORK5CYII=",
  "base64",
);

async function findFontPath(): Promise<string> {
  const candidates = [
    process.env.WINDIR && join(process.env.WINDIR, "Fonts", "arial.ttf"),
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue until a font available on this runtime is found.
    }
  }

  throw new Error(`No probe TTF found. Checked: ${candidates.join(", ")}`);
}

async function main(): Promise<void> {
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);

  const fontPath = await findFontPath();
  const customFont = await document.embedFont(await readFile(fontPath), {
    subset: true,
  });
  const image = await document.embedPng(PNG_BYTES);
  const page = document.addPage(A4_LANDSCAPE);

  page.drawRectangle({
    x: 36,
    y: 36,
    width: A4_LANDSCAPE[0] - 72,
    height: A4_LANDSCAPE[1] - 72,
    color: rgb(0.96, 0.94, 0.86),
    borderColor: rgb(0.12, 0.29, 0.48),
    borderWidth: 3,
  });
  page.drawText("Certificate PDF runtime probe", {
    x: 120,
    y: 430,
    size: 28,
    font: customFont,
    color: rgb(0.12, 0.29, 0.48),
  });
  page.drawImage(image, {
    x: 120,
    y: 280,
    width: 96,
    height: 96,
  });

  const bytes = await document.save();
  const header = Buffer.from(bytes.subarray(0, 4)).toString("ascii");
  if (header !== "%PDF") {
    throw new Error(`Unexpected PDF header: ${JSON.stringify(header)}`);
  }
  if (bytes.length <= 1000) {
    throw new Error(`Probe output was unexpectedly small: ${bytes.length} bytes`);
  }

  const outputPath = join(tmpdir(), `certificate-pdf-probe-${process.pid}.pdf`);
  await writeFile(outputPath, bytes);
  console.log(`PDF probe wrote ${bytes.length} bytes to ${outputPath}`);
  console.log(`Embedded custom font: ${fontPath}`);
}

main().catch((error: unknown) => {
  console.error("Certificate PDF probe failed", error);
  process.exitCode = 1;
});
