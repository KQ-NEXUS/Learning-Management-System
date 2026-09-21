import { ExportUnavailableError, exportReadService } from "@/server/services/export-read-service";
import { ExportHistory } from "./ExportHistory";

export const metadata = { title: "Export History" };

function single(value: string | string[] | undefined): string {
  return typeof value === "string" ? value.slice(0, 128) : "";
}

export default async function ExportHistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const filters = { dataset: single(params.dataset), status: single(params.status), from: single(params.from), to: single(params.to), search: single(params.search) };
  const requestedPage = Number(single(params.page));
  let history: Awaited<ReturnType<typeof exportReadService.listPage>> | null = null;
  try {
    history = await exportReadService.listPage({ ...filters, page: requestedPage });
  } catch (error) {
    if (!(error instanceof ExportUnavailableError)) throw error;
  }
  return history ? <ExportHistory state="ready" rows={history.rows} page={history.page} hasMore={history.hasMore} filters={filters} /> : <ExportHistory state="error" filters={filters} />;
}
