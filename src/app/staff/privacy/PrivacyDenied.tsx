"use client";

import { ResourceTable } from "@/components/primitives/ResourceTable";
import { PageHeader } from "@/components/shell/PageHeader";

/**
 * The existing denied panel for a direct visit to `/staff/privacy` without
 * `privacy.manage` (UI-SPEC S2: noun "learner privacy tools"). A client file
 * because `ResourceTable` takes function props, which a server page cannot pass
 * across the client boundary; it carries no data. The record page does not use
 * it: there a denial is the standard 404.
 *
 * The page title is drawn by `PageHeader`, as on the page itself, so the screen
 * has its h1 (W-08). The denied panel is left untitled: it then draws the
 * refusal as the h2, and no heading level is skipped.
 */
export function PrivacyDenied() {
  return (
    <div className="flex flex-col">
      <PageHeader title="Learner privacy" />
      <div className="mt-4">
        <ResourceTable
          noun="learner privacy tools"
          columns={[]}
          state={{ status: "denied", permission: "privacy.manage" }}
          getRowKey={() => ""}
        />
      </div>
    </div>
  );
}
