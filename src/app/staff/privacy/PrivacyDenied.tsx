"use client";

import { ResourceTable } from "@/components/primitives/ResourceTable";

/**
 * The existing denied panel for a direct visit to `/staff/privacy` without
 * `privacy.manage` (UI-SPEC S2: noun "learner privacy tools"). A client file
 * because `ResourceTable` takes function props, which a server page cannot pass
 * across the client boundary; it carries no data. The record page does not use
 * it: there a denial is the standard 404.
 */
export function PrivacyDenied() {
  return (
    <ResourceTable
      asPage
      title="Learner privacy"
      noun="learner privacy tools"
      columns={[]}
      state={{ status: "denied", permission: "privacy.manage" }}
      getRowKey={() => ""}
    />
  );
}
