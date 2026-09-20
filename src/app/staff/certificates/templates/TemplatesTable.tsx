"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ResourceTable, StatusPill, type Column } from "@/components/primitives";
import { ConfirmModal } from "@/components/primitives";
import { formatTimestamp } from "@/lib/format-timestamp";
import {
  archiveTemplateAction,
  setDefaultTemplateAction,
} from "./template-actions";

/**
 * The certificate-template library table (UI-SPEC 7.3.1).
 *
 * No bulk row-picking is wired here — D-04/§0.4 only asked for a per-template
 * "Edit"/"View", "Set as default" and "Archive" affordance, never a
 * multi-template operation, so `ResourceTable`'s bulk-actions prop is never
 * passed (avoids inventing a capability nobody asked for).
 */

export type TemplateRow = {
  id: string;
  name: string;
  isDefault: boolean;
  archivedAt: Date | null;
  updatedAt: Date;
};

type Props = {
  rows: TemplateRow[];
  /** Hide the New template button for staff who cannot manage templates. Default true. */
  canCreate?: boolean;
  onArchive?: typeof archiveTemplateAction;
  onSetDefault?: typeof setDefaultTemplateAction;
};

const LINK = "text-sm font-semibold text-accent underline underline-offset-2 hover:opacity-80";
const PLAIN_ACTION =
  "text-sm font-semibold text-foreground underline underline-offset-2 hover:text-accent disabled:cursor-not-allowed disabled:opacity-60";
const DANGER_ACTION =
  "text-sm font-semibold text-danger underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-60";

export function TemplatesTable({
  rows,
  canCreate = true,
  onArchive = archiveTemplateAction,
  onSetDefault = setDefaultTemplateAction,
}: Props) {
  const [pending, transition] = useTransition();
  const [defaultBusyId, setDefaultBusyId] = useState<string | null>(null);
  const [defaultError, setDefaultError] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<TemplateRow | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  function handleSetDefault(id: string) {
    setDefaultError(null);
    setDefaultBusyId(id);
    transition(async () => {
      const result = await onSetDefault({ id });
      setDefaultBusyId(null);
      if (!result.ok) setDefaultError(result.message);
    });
  }

  function handleArchive(reason: string) {
    if (!archiveTarget) return;
    transition(async () => {
      const result = await onArchive({ id: archiveTarget.id, reason });
      if (!result.ok) {
        setArchiveError(result.message);
        return;
      }
      setArchiveTarget(null);
      setArchiveError(null);
    });
  }

  const columns: Column<TemplateRow>[] = [
    {
      key: "name",
      header: "Name",
      render: (row) => row.name,
      width: "40%",
    },
    {
      key: "default",
      header: "Default",
      render: (row) => (row.isDefault ? <StatusPill tone="neutral" label="Default" /> : null),
      width: "16%",
    },
    {
      key: "updatedAt",
      header: "Last edited",
      mono: true,
      render: (row) => formatTimestamp(row.updatedAt),
      width: "18%",
    },
    {
      key: "actions",
      header: "Actions",
      render: (row) => {
        const archived = row.archivedAt !== null;
        return (
          <span className="flex flex-wrap items-center gap-3">
            <Link href={`/staff/certificates/templates/${row.id}`} className={LINK}>
              {archived ? "View" : "Edit"}
            </Link>
            {!archived && (
              <>
                <button
                  type="button"
                  disabled={pending && defaultBusyId === row.id}
                  onClick={() => handleSetDefault(row.id)}
                  className={PLAIN_ACTION}
                >
                  Set as default
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setArchiveError(null);
                    setArchiveTarget(row);
                  }}
                  className={DANGER_ACTION}
                >
                  Archive
                </button>
              </>
            )}
          </span>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <ResourceTable<TemplateRow>
        asPage
        title="Certificate templates"
        headerActions={
          canCreate ? (
            <>
              <Link
                href="/staff/certificates/templates/from-design"
                className="inline-flex min-h-10 items-center rounded-md border border-input-border bg-surface px-4 text-sm font-semibold text-foreground hover:bg-surface-2"
              >
                Upload existing design
              </Link>
              <Link
                href="/staff/certificates/templates/new"
                className="inline-flex min-h-10 items-center rounded-md bg-accent px-4 text-sm font-semibold text-accent-contrast hover:bg-accent-deep"
              >
                New template
              </Link>
            </>
          ) : undefined
        }
        noun="templates"
        columns={columns}
        state={
          rows.length > 0
            ? { status: "ready", rows }
            : { status: "empty" }
        }
        getRowKey={(row) => row.id}
        getRowLabel={(row) => row.name}
        getRowHref={(row) => `/staff/certificates/templates/${row.id}`}
        primaryColumnKey="name"
        emptyHeading="No templates yet"
        emptyBody="Create a template to define how issued certificates look."
      />

      {defaultError && (
        <p role="alert" className="text-sm text-danger">
          {defaultError}
        </p>
      )}

      <ConfirmModal
        open={archiveTarget !== null}
        tone="danger"
        title={`Archive ${archiveTarget?.name ?? "template"}`}
        description="This template will no longer be offered when choosing a certificate template for a Course or Programme. Already-issued certificates that used it are unaffected."
        confirmLabel="Archive template"
        minReasonLength={10}
        reasonLabel="Reason for archiving"
        pending={pending}
        error={archiveError}
        onConfirm={handleArchive}
        onCancel={() => setArchiveTarget(null)}
      />
    </div>
  );
}
