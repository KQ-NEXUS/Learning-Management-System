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
  return <Icon aria-hidden size={24} className="shrink-0 text-muted-foreground" />;
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
    <article className="border-b border-border py-8">
      <div className="flex flex-wrap items-center gap-4">
        <TypeIcon type={result.type} />
        <h2 className="grow text-[22px] leading-[1.2] font-semibold tracking-[-0.02em] text-foreground">
          {result.title}
        </h2>
        {line && <span className="font-mono text-[22px] font-medium tabular-nums text-foreground">{line}</span>}
        {result.passed !== null && (
          <span className="min-w-[120px] text-right font-medium">
            <StatusPill
              tone={result.passed ? "success" : "warning"}
              label={result.passed ? "Passed" : "Not yet passed"}
            />
          </span>
        )}
      </div>

      {result.feedback && (
        <p className="mt-4 max-h-48 max-w-[760px] overflow-y-auto break-words whitespace-pre-wrap text-foreground-soft">
          {result.feedback}
        </p>
      )}

      {/* Unmet pass requirement (ASM-07, §6.1) — only meaningful for a quiz,
          the only type an attempt-limited "remaining" count applies to; never
          rendered once passed. */}
      {result.passed === false &&
        result.type === "QUIZ" &&
        (result.attemptsRemaining === 0 ? (
          <p className="mt-4 text-sm text-warning">You&apos;ve used all your attempts for {result.title}.</p>
        ) : (
          <p className="mt-4 text-sm text-warning">
            You haven&apos;t yet passed {result.title}. {result.attemptsRemaining ?? "Unlimited"} attempt(s)
            remaining.
          </p>
        ))}

      {/* Always rendered as a table, even at length 1 — no singular/plural
          structural branch (UI-SPEC §8 zero-one-many resolution). */}
      <table className="mt-4 w-full border-collapse text-sm">
        <caption className="sr-only">
          {historyLabel} ({result.history.length})
        </caption>
        <thead>
          <tr className="border-b border-foreground text-left text-[13px] font-medium text-muted-foreground">
            <th scope="col" className="pr-4 pb-3 font-medium">
              {result.type === "QUIZ" ? "Attempt" : "Submission"}
            </th>
            <th scope="col" className="pr-4 pb-3 font-medium">
              When
            </th>
            <th scope="col" className="pr-4 pb-3 text-right font-medium">
              Score
            </th>
            <th scope="col" className="pb-3 text-right font-medium">
              Outcome
            </th>
          </tr>
        </thead>
        <tbody>
          {result.history.map((entry) => (
            <tr key={entry.ref} className="border-b border-border">
              <td className="h-14 pr-4 font-mono">{entry.number}</td>
              <td className="pr-4 font-mono tabular-nums">
                {formatTimestamp(new Date(entry.at))}
                {entry.isLate && (
                  <span data-tone="warning" className="ml-2 font-sans font-medium text-warning">
                    · Late
                  </span>
                )}
              </td>
              <td className="pr-4 text-right font-mono tabular-nums">{entry.score ?? "—"}</td>
              <td className="text-right whitespace-nowrap">
                <HistoryStatus entry={entry} passMark={result.passMark} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {result.overrides.length > 0 && (
        <div className="mt-4 flex flex-col gap-1">
          <h3 className="sr-only">Grade overrides</h3>
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
    </article>
  );
}

export function ResultsList({ results }: Props) {
  return (
    <div className="border-t border-foreground">
      {results.map((result) => (
        <ResultCard key={result.assessmentId} result={result} />
      ))}
    </div>
  );
}
