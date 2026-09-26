export default function LoadingSupportList() {
  return (
    <div role="status" aria-busy="true" className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div aria-hidden className="h-8 w-56 animate-pulse rounded-md bg-surface-2" />
        <p className="text-sm text-muted-foreground">Loading your support tickets</p>
      </header>
      <div aria-hidden className="flex flex-col gap-3">
        {Array.from({ length: 5 }, (_, index) => (
          <span key={index} className="h-16 animate-pulse rounded-xl border border-border bg-surface-2" />
        ))}
      </div>
    </div>
  );
}
