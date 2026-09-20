import { describe, expect, it } from "vitest";
import { csvCell, serializeCsv, streamCsv } from "@/server/services/csv-service";

const metadata = { dataset: "payments", version: "1.0", filters: { provider: "MANUAL", from: "2026-09-01" }, generatedAt: new Date("2026-09-16T10:00:00Z"), asOf: new Date("2026-09-16T09:00:00Z"), timezone: "Africa/Lagos" };
const columns = [{ key: "reference", label: "Reference" }, { key: "amountMinor", label: "Amount" }];

describe("safe CSV contract", () => {
  it("quotes separators, CR/LF, quotes and Unicode", () => {
    expect(csvCell('a,"\r\n😀')).toBe('"a,""\r\n😀"');
  });
  it.each(["=SUM(1,1)", "+cmd", "-1+2", "@A1", " \t=HYPERLINK(1)"])("neutralizes formula-shaped text %s", (value) => {
    expect(csvCell(value)).toContain(`'${value}`);
  });
  it("preserves stable versioned metadata and empty headers", async () => {
    const csv = await serializeCsv(metadata, columns, []);
    expect(csv).toContain("Dataset,payments\r\nDataset version,1.0\r\n");
    expect(csv).toContain("Request as of,2026-09-16T09:00:00.000Z\r\n");
    expect(csv).toContain("\r\nReference,Amount\r\n");
    expect(csv).not.toContain("undefined");
  });
  it("streams ordered rows with exact integers, blanks, and not-applicable text", async () => {
    const chunks = [];
    for await (const chunk of streamCsv(metadata, columns, [{ reference: "Not applicable", amountMinor: -123456789 }, { reference: "下一行", amountMinor: null }])) chunks.push(chunk);
    const text = new TextDecoder().decode(Buffer.concat(chunks));
    expect(text).toContain("Not applicable,'-123456789\r\n下一行,\r\n");
    expect(text.indexOf("Reference,Amount")).toBeLessThan(text.indexOf("Not applicable"));
  });
});
