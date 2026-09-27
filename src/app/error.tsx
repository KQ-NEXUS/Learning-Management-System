"use client";

import { LearnerShell } from "@/components/shell/LearnerShell";
import { LearnerPageHeader } from "@/components/shell/LearnerPageHeader";
import { RouteErrorPanel } from "@/components/shell/RouteErrorPanel";

/** Catches errors in segments with no boundary of their own (orders, verify pages). Same bare frame as the root 404. */
export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <LearnerShell nav={[]} rightSlot={null}>
      <div className="flex flex-col gap-8">
        <LearnerPageHeader title="Something went wrong" />
        <RouteErrorPanel error={error} retry={retry} home={{ href: "/", label: "Back to the home page" }} />
      </div>
    </LearnerShell>
  );
}
