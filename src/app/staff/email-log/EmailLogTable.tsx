"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import {
  ResourceTable,
  StatusPill,
  type Column,
  type TableFilter,
} from "@/components/primitives/ResourceTable";
import { ConfirmModal } from "@/components/primitives/ConfirmModal";
import { BTN, NOTE_SUCCESS } from "@/components/primitives/controls";
import { formatTimestamp } from "@/lib/format-timestamp";
import { TEMPLATE_IDS } from "@/server/communications/contracts";
import type { EmailDeliveryLogRow } from "@/server/services/email-delivery-log-service";
import { resendEmailAction } from "./actions";

/**
 * The staff delivery log (D-06, UI-SPEC "Delivery log page"). A client
 * sibling of `ResourceTable` in the same shape as `CertificateQueueTable`:
 * filters read from and write to the URL (mirroring `AuditTable`), a local
 * `rows` copy so a successful resend reflects immediately without waiting for
 * the next navigation, and the audited `ConfirmModal` for the one mutating
 * action this page exposes.
 */

export type EmailLogFilters = { status: string; template: string };

const STATUS_OPTIONS = [
  { value: "", label: "Any" },
  { value: "SENT", label: "Sent" },
  { value: "QUEUED", label: "Queued" },
  { value: "FAILED", label: "Failed" },
  { value: "SKIPPED", label: "Skipped" },
];

const TEMPLATE_OPTIONS = [
  { value: "", label: "Any" },
  ...TEMPLATE_IDS.map((id) => ({ value: id, label: id })),
];

function statusTone(status: string): "success" | "accent" | "danger" | "neutral" {
  if (status === "SENT") return "success";
  if (status === "QUEUED" || status === "SENDING") return "accent";
  if (status === "FAILED") return "danger";
  return "neutral";
}

export function EmailLogTable({
  rows: initialRows,
  denied,
  error,
  filters,
  canManageUsers = false,
}: {
  rows?: EmailDeliveryLogRow[];
  denied?: { permission: string };
  error?: { message?: string };
  filters: EmailLogFilters;
  canManageUsers?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [rows, setRows] = useState<EmailDeliveryLogRow[]>(initialRows ?? []);
  const [target, setTarget] = useState<EmailDeliveryLogRow | null>(null);
  const [actionPending, startAction] = useTransition();
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  function setParam(name: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(name, value);
    } else {
      params.delete(name);
    }
    startTransition(() => {
      router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
    });
  }

  function clearFilters() {
    startTransition(() => router.push(pathname));
  }

  function confirmResend(reason: string) {
    if (!target) return;
    const row = target;
    startAction(async () => {
      const result = await resendEmailAction({ dispatchId: row.id, reason });
      if (!result.ok) {
        setDialogError(result.message);
        return;
      }
      setDialogError(null);
      setTarget(null);
      setNotice(`Resend queued for ${row.toEmail}.`);
      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, status: "QUEUED", attempts: 0, canResend: false } : r)),
      );
    });
  }

  const activeFilterCount = [filters.status, filters.template].filter(Boolean).length;

  const columns: Column<EmailDeliveryLogRow>[] = [
    { key: "template", header: "Template", render: (row) => row.template },
    {
      key: "recipient",
      header: "Recipient",
      mono: true,
      render: (row) => (
        <span className="block max-w-[220px] truncate" title={row.toEmail}>
          {row.toEmail}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <span className="flex items-center gap-2">
          <StatusPill label={row.status} tone={statusTone(row.status)} />
          {row.isStub && (
            <span className="font-mono text-xs text-muted-foreground">stub</span>
          )}
        </span>
      ),
    },
    {
      key: "attempts",
      header: "Attempts",
      render: (row) => `${row.attempts} of ${row.maxAttempts}`,
    },
    {
      key: "nextAttempt",
      header: "Next attempt",
      mono: true,
      render: (row) => (row.nextAttemptAt ? formatTimestamp(row.nextAttemptAt) : "—"),
    },
    {
      key: "error",
      header: "Last error",
      render: (row) => {
        const text = row.error ?? row.skipReason ?? "—";
        return (
          <span className="block max-w-[220px] truncate" title={text !== "—" ? text : undefined}>
            {text}
          </span>
        );
      },
    },
    {
      key: "created",
      header: "Created",
      mono: true,
      render: (row) => formatTimestamp(row.createdAt),
    },
    {
      key: "action",
      header: "Actions",
      render: (row) =>
        canManageUsers && row.canResend ? (
          <button
            type="button"
            onClick={() => {
              setDialogError(null);
              setTarget(row);
            }}
            className={BTN}
          >
            Resend
          </button>
        ) : null,
    },
  ];

  if (denied) {
    return (
      <ResourceTable
        asPage
        title="Email log"
        noun="delivery log entries"
        columns={columns}
        state={{ status: "denied", permission: denied.permission }}
        getRowKey={(row) => row.id}
      />
    );
  }

  if (error) {
    return (
      <ResourceTable
        asPage
        title="Email log"
        noun="delivery log entries"
        columns={columns}
        state={{
          status: "error",
          message: error.message ?? "Couldn't load the delivery log. Reload the page; if it persists, contact an administrator.",
        }}
        getRowKey={(row) => row.id}
      />
    );
  }

  const filterDefs: TableFilter[] = [
    { kind: "select", name: "status", label: "Status", value: filters.status, options: STATUS_OPTIONS },
    { kind: "select", name: "template", label: "Template", value: filters.template, options: TEMPLATE_OPTIONS },
  ];

  return (
    <>
      <ResourceTable
        asPage
        title="Email log"
        noun="emails"
        columns={columns}
        state={
          isPending
            ? { status: "loading" }
            : rows.length
              ? { status: "ready", rows }
              : { status: "empty", activeFilterCount }
        }
        getRowKey={(row) => row.id}
        getRowLabel={(row) => `${row.template} to ${row.toEmail}`}
        emptyHeading="No emails sent yet"
        emptyBody="Transactional emails appear here once lifecycle events are processed."
        filters={filterDefs}
        onFilterChange={setParam}
        onClearFilters={activeFilterCount > 0 ? clearFilters : undefined}
      />
      {notice && (
        <p role="status" className={NOTE_SUCCESS}>
          {notice}
        </p>
      )}
      <ConfirmModal
        open={target !== null}
        eyebrow="Audited action"
        tone="default"
        title="Resend this email?"
        confirmLabel="Resend email"
        minReasonLength={10}
        reasonLabel="Reason for resending"
        description={
          target
            ? `This sends the same message again to ${target.toEmail}. Your name and reason are recorded in the audit log.`
            : ""
        }
        pending={actionPending}
        error={dialogError}
        onConfirm={confirmResend}
        onCancel={() => {
          setTarget(null);
          setDialogError(null);
        }}
      />
    </>
  );
}
