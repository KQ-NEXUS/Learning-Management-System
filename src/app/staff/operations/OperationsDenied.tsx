"use client";

import { ResourceTable } from "@/components/primitives/ResourceTable";
import { PageHeader } from "@/components/shell/PageHeader";

/**
 * The existing denied panel for a direct visit to `/staff/operations` without
 * `audit.view`. A client file because `ResourceTable` takes function props,
 * which a server page cannot pass across the client boundary; it carries no data.
 *
 * The page title is drawn by `PageHeader`, as on the page itself, so the screen
 * has its h1 (W-08). The denied panel is left untitled: it then draws the
 * refusal as the h2, and no heading level is skipped.
 */
export function OperationsDenied() {
  return (
    <div className="flex flex-col">
      <PageHeader title="Operations status" />
      <div className="mt-4">
        <ResourceTable
          noun="the operations status"
          columns={[]}
          state={{ status: "denied", permission: "audit.view" }}
          getRowKey={() => ""}
        />
      </div>
    </div>
  );
}
