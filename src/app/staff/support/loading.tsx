export default function LoadingStaffSupportQueue() {
  return (
    <div role="status" aria-busy="true" className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">Staff workspace / Support</p>
        <div aria-hidden className="h-8 w-48 animate-pulse rounded-md bg-surface-2" />
        <p className="text-sm">Loading support queue</p>
      </header>
      <div aria-hidden className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <span key={index} className="h-20 animate-pulse rounded-xl border border-border bg-surface-2" />
        ))}
      </div>
      <div aria-hidden className="flex flex-col gap-3">
        {Array.from({ length: 6 }, (_, index) => (
          <span key={index} className="h-14 animate-pulse rounded-md bg-surface-2" />
        ))}
      </div>
    </div>
  );
}
