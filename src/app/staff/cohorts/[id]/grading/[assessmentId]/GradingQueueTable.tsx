"use client";

import { useState, useTransition } from "react";
import { ResourceTable, StatusPill } from "@/components/primitives/ResourceTable";
import { ConfirmModal } from "@/components/primitives/ConfirmModal";
import { formatTimestamp } from "@/lib/format-timestamp";
import type { GradingQueueRow } from "@/server/services/grading-service";
import { releaseGradesBatchAction } from "../../grading-actions";

type Props = { cohortId: string; assessmentId: string; rows: GradingQueueRow[]; onRelease?: typeof releaseGradesBatchAction };
export function GradingQueueTable({ cohortId, assessmentId, rows, onRelease = releaseGradesBatchAction }: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [pending, transition] = useTransition();
  const chosen = rows.filter(row => selected.includes(row.submissionId));
  const gradeIds = chosen.flatMap(row => row.gradeId ? [row.gradeId] : []);
  const disabled = pending || !chosen.some(row => row.gradeStatus === "DRAFT");
  const visible = rows.filter(row => !status || row.gradeStatus === status);
  function release() {
    transition(async () => {
      try {
        const result = await onRelease({ cohortId, gradeIds });
        if (!result.ok) { setError(result.message); return; }
        setOpen(false); setSelected([]);
        setNotice(`${result.released.length} grades released.${result.skipped.length ? ` ${result.skipped.length} already released grades skipped.` : ""}`);
      } catch { setError("These grades could not be released. Try again."); }
    });
  }
  return <>
    <ResourceTable noun="submissions" columns={[
      { key: "learner", header: "Learner", render: row => row.learnerName },
      { key: "submitted", header: "Submitted", mono: true, render: row => formatTimestamp(new Date(row.submittedAt)) },
      { key: "late", header: "Late", render: row => row.isLate ? <StatusPill tone="warning" label="Late" /> : null },
      { key: "status", header: "Status", render: row => row.gradeStatus ? <StatusPill tone={row.gradeStatus === "RELEASED" ? "success" : "neutral"} label={row.gradeStatus === "RELEASED" ? "Released" : "Draft"} /> : null },
      { key: "score", header: "Score", mono: true, align: "right", render: row => row.score ?? "—" },
    ]} state={visible.length ? { status: "ready", rows: visible } : { status: "empty", activeFilterCount: status ? 1 : 0, totalWithoutFilters: rows.length }}
      getRowKey={row => row.submissionId} getRowLabel={row => row.learnerName}
      getRowHref={row => `/staff/cohorts/${cohortId}/grading/${assessmentId}/${row.submissionId}`}
      filters={[{ kind: "select", name: "status", label: "Status", value: status, options: [{ value: "", label: "All" }, { value: "DRAFT", label: "Draft" }, { value: "RELEASED", label: "Released" }] }]}
      onFilterChange={(_, value) => { setStatus(value); setSelected([]); }} onClearFilters={() => { setStatus(""); setSelected([]); }}
      selection={{ selectedIds: selected, onChange: ids => { if (!pending) setSelected(ids); }, actions: [{ label: "Release selected", disabled, description: disabled ? "Select one or more draft submissions to release them together." : undefined, onClick: () => { setError(null); setOpen(true); } }] }}
      emptyHeading="Nothing to grade yet" emptyBody="Submissions will appear here once learners in this Cohort submit their work." />
    {notice && <p role="status" className="mt-2 text-sm text-muted-foreground">{notice}</p>}
    <ConfirmModal open={open} tone="default" title={`Release ${gradeIds.length} grades`} confirmLabel="Release grades"
      description={`These grades will become visible to the ${gradeIds.length} learner(s) immediately. This can't be undone from this screen — a released grade can only be corrected with an audited override.`}
      pending={pending} error={error} onConfirm={release} onCancel={() => setOpen(false)} />
  </>;
}
