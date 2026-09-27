export default function LoadingLearnerPage() {
  return (
    <div role="status" aria-busy="true" className="flex min-w-0 flex-col gap-6 py-6">
      <span className="sr-only">Loading</span>
      <div aria-hidden className="h-8 w-56 animate-pulse rounded-md bg-surface-2" />
      <div aria-hidden className="flex flex-col gap-3">
        {Array.from({ length: 6 }, (_, index) => (
          <span key={index} className="h-14 animate-pulse rounded-md bg-surface-2" />
        ))}
      </div>
    </div>
  );
}
