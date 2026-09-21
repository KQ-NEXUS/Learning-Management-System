export default function LoadingDatasetReport() {
  return <main role="status" aria-busy="true" className="flex min-w-0 flex-col gap-8">
    <header className="flex flex-col gap-3"><p className="text-sm text-muted-foreground">Staff workspace / Reports</p><div aria-hidden className="h-8 w-48 animate-pulse rounded-md bg-surface-2" /><p className="text-sm">Loading report data</p></header>
    <div aria-hidden className="grid grid-cols-1 gap-4 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <span key={index} className="h-12 animate-pulse rounded-md bg-surface-2" />)}</div>
    <div aria-hidden className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">{Array.from({ length: 5 }, (_, index) => <span key={index} className="h-28 animate-pulse rounded-xl border border-border bg-surface-2" />)}</div>
    <div aria-hidden className="h-48 animate-pulse rounded-xl border border-border bg-surface-2" />
  </main>;
}
