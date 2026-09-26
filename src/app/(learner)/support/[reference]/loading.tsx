export default function LoadingSupportTicket() {
  return (
    <div role="status" aria-busy="true" className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div aria-hidden className="h-8 w-72 max-w-full animate-pulse rounded-md bg-surface-2" />
        <p className="text-sm text-muted-foreground">Loading ticket</p>
      </header>
      <div aria-hidden className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <span key={index} className="h-14 animate-pulse rounded-md bg-surface-2" />
        ))}
      </div>
      <div aria-hidden className="flex flex-col gap-3">
        {Array.from({ length: 3 }, (_, index) => (
          <span key={index} className="h-24 animate-pulse rounded-xl border border-border bg-surface-2" />
        ))}
      </div>
    </div>
  );
}
