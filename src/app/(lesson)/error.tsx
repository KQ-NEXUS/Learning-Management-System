"use client";

import { RouteErrorPanel } from "@/components/shell/RouteErrorPanel";

export default function LessonError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 bg-surface px-6 py-12">
      <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
      <RouteErrorPanel error={error} retry={retry} home={{ href: "/learn", label: "Back to My learning" }} />
    </div>
  );
}
