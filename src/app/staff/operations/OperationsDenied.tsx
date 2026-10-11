"use client";

import { ResourceTable } from "@/components/primitives/ResourceTable";

/**
 * The existing denied panel for a direct visit to `/staff/operations` without
 * `audit.view`. A client file because `ResourceTable` takes function props,
 * which a server page cannot pass across the client boundary; it carries no data.
 */
export function OperationsDenied() {
  return (
    <ResourceTable
      asPage
      title="Operations status"
      noun="the operations status"
      columns={[]}
      state={{ status: "denied", permission: "audit.view" }}
      getRowKey={() => ""}
    />
  );
}
