export default function LoadingStaffSupportTicket() {
  return (
    <div role="status" aria-busy="true" className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">Staff workspace / Support</p>
        <div aria-hidden className="h-8 w-72 max-w-full animate-pulse rounded-md bg-surface-2" />
        <p className="text-sm">Loading ticket</p>
      </header>
      <div aria-hidden className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <span className="h-64 animate-pulse rounded-xl border border-border bg-surface-2 lg:col-span-2" />
        <span className="h-64 animate-pulse rounded-xl border border-border bg-surface-2" />
      </div>
    </div>
  );
}
