import { ListChecks, ClipboardList } from "lucide-react";
import { StatusPill } from "@/components/primitives/ResourceTable";
import { formatTimestamp } from "@/lib/format-timestamp";
import type { LearnerResultCard } from "@/server/services/learner-results-service";

/**
 * ResultsList — the per-Assessment result cards on `/learn/[enrolmentId]/results`
 * (ASM-07, plan 10-15, UI-SPEC §7.5).
 *
 * Renders `results` in the exact order the caller passed them (the service's
 * course-order decision, `learner-results-service.ts`) — this component never
 * calls `.sort()` on the incoming array, so there is exactly one place the
 * ordering rule lives.
 *
 * DRAFT grades never reach this component: `getOwnResults` already excludes
 * `status !== "RELEASED"` rows at the database, and no branch below renders a
 * "pending"/muted placeholder for one — adding such a branch is exactly how
 * a DRAFT grade would quietly start leaking again, so none exists here.
 */

type Props = { results: LearnerResultCard[] };

function TypeIcon({ type }: { type: LearnerResultCard["type"] }) {
  const Icon = type === "QUIZ" ? ListChecks : ClipboardList;
  return <Icon aria-hidden size={20} className="shrink-0 text-muted-foreground" />;
}

function scoreLine(result: LearnerResultCard): string | null {
  if (result.effectiveScore === null || result.maxScore === null) return null;
  const pct = result.maxScore > 0 ? Math.round((result.effectiveScore / result.maxScore) * 100) : 0;
  return `${result.effectiveScore} / ${result.maxScore} (${pct}%)`;
}

function HistoryStatus({
  entry,
  passMark,
}: {
  entry: LearnerResultCard["history"][number];
  passMark: number | null;
}) {
  if (entry.kind === "submission") {
    if (entry.status === "ERROR") return <StatusPill tone="danger" label="Failed" />;
    if (entry.status === "UPLOADING") return <StatusPill tone="neutral" label="Uploading" />;
    return <StatusPill tone="success" label="Submitted" />;
  }
  // kind === "attempt" — ABANDONED carries no score; EXPIRED renders
  // identically to SUBMITTED (UI-SPEC §0.3 — never its own pill tone).
  if (entry.status === "ABANDONED") return <StatusPill tone="neutral" label="Abandoned" />;
  const passed = entry.score !== null && passMark !== null ? entry.score >= passMark : null;
  return <StatusPill tone={passed ? "success" : "warning"} label={passed ? "Passed" : "Not yet passed"} />;
}

function ResultCard({ result }: { result: LearnerResultCard }) {
  const line = scoreLine(result);
  const historyLabel = result.type === "QUIZ" ? "Attempt history" : "Submission history";

  return (
    <article className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6 shadow-xs">
      <div className="flex items-center gap-2">
        <TypeIcon type={result.type} />
        <h2 className="text-[16px] font-semibold text-foreground">{result.title}</h2>
      </div>

      {line && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-sm font-semibold text-foreground">{line}</span>
          {result.passed !== null && (
            <StatusPill
              tone={result.passed ? "success" : "warning"}
              label={result.passed ? "Passed" : "Not yet passed"}
            />
          )}
        </div>
      )}

      {result.feedback && <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-sm text-muted-foreground">{result.feedback}</p>}

      {/* Unmet pass requirement (ASM-07, §6.1) — only meaningful for a quiz,
          the only type an attempt-limited "remaining" count applies to; never
          rendered once passed. */}
      {result.passed === false &&
        result.type === "QUIZ" &&
        (result.attemptsRemaining === 0 ? (
          <p className="text-sm text-warning">You&apos;ve used all your attempts for {result.title}.</p>
        ) : (
          <p className="text-sm text-warning">
            You haven&apos;t yet passed {result.title}. {result.attemptsRemaining ?? "Unlimited"} attempt(s)
            remaining.
          </p>
        ))}

      {result.overrides.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-foreground">Grade overrides</h3>
          <ul className="flex flex-col gap-1">
            {result.overrides.map((override, index) => (
              <li key={index} className="text-sm text-muted-foreground">
                Overridden from {override.previousScore} to {override.newScore} by{" "}
                {override.actorName ?? "a staff member"}, {formatTimestamp(new Date(override.at)).slice(0, 10)} — &quot;
                {override.reason}&quot;
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Always rendered as a list, even at length 1 — no singular/plural
          structural branch (UI-SPEC §8 zero-one-many resolution). */}
      <details className="rounded-lg border border-border bg-surface-2 px-4 py-2">
        <summary className="cursor-pointer text-sm font-semibold text-foreground [&::-webkit-details-marker]:hidden">
          {historyLabel} ({result.history.length})
        </summary>
        <ul className="mt-2 flex flex-col gap-2">
          {result.history.map((entry) => (
            <li key={entry.ref} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono text-muted-foreground">{formatTimestamp(new Date(entry.at))}</span>
              <HistoryStatus entry={entry} passMark={result.passMark} />
              <span className="font-mono">{entry.score ?? "—"}</span>
              {entry.isLate && <StatusPill tone="warning" label="Late" />}
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}

export function ResultsList({ results }: Props) {
  return (
    <div className="flex flex-col gap-4">
      {results.map((result) => (
        <ResultCard key={result.assessmentId} result={result} />
      ))}
    </div>
  );
}
