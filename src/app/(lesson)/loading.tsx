export default function LoadingLesson() {
  return (
    <div role="status" aria-busy="true" className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 bg-surface px-6 py-12">
      <span className="sr-only">Loading lesson</span>
      <div aria-hidden className="h-8 w-56 animate-pulse rounded-md bg-surface-2" />
      <div aria-hidden className="flex flex-col gap-3">
        {Array.from({ length: 6 }, (_, index) => (
          <span key={index} className="h-14 animate-pulse rounded-md bg-surface-2" />
        ))}
      </div>
    </div>
  );
}
