"use client";

import "./globals.css";
import { RouteErrorPanel } from "@/components/shell/RouteErrorPanel";

/** Replaces the root layout when it fails, so it draws its own document. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-background">
        <title>Something went wrong · Training Administration</title>
        <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-16">
          <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
          <RouteErrorPanel error={error} retry={retry} home={{ href: "/", label: "Back to the home page" }} />
        </main>
      </body>
    </html>
  );
}
