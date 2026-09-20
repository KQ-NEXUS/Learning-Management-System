/** One UTF-8 CSV contract for every worker. Spreadsheet formulas are
 * neutralized with a leading apostrophe, including after leading whitespace. */
export type CsvColumn = Readonly<{ key: string; label: string }>;
export type CsvMetadata = Readonly<{
  dataset: string;
  version: string;
  filters: Readonly<Record<string, unknown>>;
  generatedAt: Date;
  asOf: Date;
  timezone: string;
}>;
export type CsvRow = Readonly<Record<string, string | number | boolean | null | undefined>>;

export function csvCell(value: CsvRow[string]): string {
  let text = value === null || value === undefined ? "" : String(value);
  // CSV quoting alone does not stop Excel/LibreOffice formula evaluation.
  // A tab or leading spaces before = + - @ still count as executable input.
  if (/^[\s\uFEFF]*[=+\-@]/u.test(text)) text = `'${text}`;
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function record(values: readonly CsvRow[string][]): string {
  return `${values.map(csvCell).join(",")}\r\n`;
}

function canonicalFilters(filters: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(filters).filter(([key]) => key !== "requestSignature").sort(([a], [b]) => a.localeCompare(b))));
}

/** Yields bounded chunks; the caller can pipe them to multipart storage. */
export async function* streamCsv(
  metadata: CsvMetadata,
  columns: readonly CsvColumn[],
  rows: AsyncIterable<CsvRow> | Iterable<CsvRow>,
): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  yield encoder.encode("\uFEFF" + record(["Export format", "1"]));
  for (const [key, value] of [
    ["Dataset", metadata.dataset],
    ["Dataset version", metadata.version],
    ["Applied filters", canonicalFilters(metadata.filters)],
    ["Generated at", metadata.generatedAt.toISOString()],
    ["Request as of", metadata.asOf.toISOString()],
    ["Timezone", metadata.timezone],
  ] as const) yield encoder.encode(record([key, value]));
  yield encoder.encode("\r\n" + record(columns.map((column) => column.label)));
  for await (const row of rows) yield encoder.encode(record(columns.map((column) => row[column.key])));
}

export async function serializeCsv(metadata: CsvMetadata, columns: readonly CsvColumn[], rows: AsyncIterable<CsvRow> | Iterable<CsvRow>): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of streamCsv(metadata, columns, rows)) chunks.push(chunk);
  return new TextDecoder().decode(Buffer.concat(chunks));
}
