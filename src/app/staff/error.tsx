"use client";

import { PageHeader } from "@/components/shell/PageHeader";
import { RouteErrorPanel } from "@/components/shell/RouteErrorPanel";

export default function StaffError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Something went wrong" />
      <RouteErrorPanel error={error} retry={retry} home={{ href: "/staff", label: "Back to overview" }} />
    </div>
  );
}
