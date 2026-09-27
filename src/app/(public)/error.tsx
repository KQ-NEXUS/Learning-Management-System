"use client";

import { LearnerPageHeader } from "@/components/shell/LearnerPageHeader";
import { RouteErrorPanel } from "@/components/shell/RouteErrorPanel";

export default function PublicError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="flex flex-col gap-8">
      <LearnerPageHeader title="Something went wrong" />
      <RouteErrorPanel error={error} retry={retry} home={{ href: "/courses", label: "Back to the catalogue" }} />
    </div>
  );
}
