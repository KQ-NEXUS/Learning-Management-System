import { ExportHistory } from "./ExportHistory";

export default function LoadingExportHistory() {
  return <ExportHistory state="loading" filters={{ dataset: "", status: "", from: "", to: "", search: "" }} />;
}
