"use client";

import { RouteErrorPanel } from "@/components/shell/RouteErrorPanel";

export default function AuthError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
      <RouteErrorPanel error={error} retry={retry} home={{ href: "/signin", label: "Back to sign in" }} />
    </div>
  );
}
