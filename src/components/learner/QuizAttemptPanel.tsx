"use client";

import { useEffect, useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Clock, ListChecks } from "lucide-react";
import { StatusPill } from "@/components/primitives/ResourceTable";
import { formatTimestamp } from "@/lib/format-timestamp";
import type { LearnerQuizView, SafeQuizAttempt } from "@/server/services/learner-quiz-service";
import type { AttemptResultView } from "@/server/services/attempt-service";
import { startAttemptAction, submitAttemptAction, saveAttemptAnswersAction } from "@/app/(learner)/learn/[enrolmentId]/lessons/[lessonId]/assessment-actions";

type Props = LearnerQuizView & {
  enrolmentId: string; lessonId: string;
  onStart?: typeof startAttemptAction; onSubmit?: typeof submitAttemptAction; onSave?: typeof saveAttemptAnswersAction;
};
const BUTTON = "rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast disabled:opacity-50";

export function QuizAttemptPanel(props: Props) {
  const [active, setActive] = useState<SafeQuizAttempt | null>(null);
  const [result, setResult] = useState<AttemptResultView | null>(props.result);
  const [history, setHistory] = useState(props.history);
  const [remaining, setRemaining] = useState(props.attemptsRemaining);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<{ message: string; body?: string } | null>(null);
  const [pending, transition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [competing, setCompeting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const closed = props.availableUntil != null && now >= new Date(props.availableUntil).getTime();
  const notOpen = props.availableFrom != null && now < new Date(props.availableFrom).getTime();
  const resumable = props.active && !active;
  const answered = active?.questions.filter(q => answers[q.id]?.length).length ?? 0;
  const responses = active?.questions.map(q => ({ questionId: q.id, selectedOptionIds: answers[q.id] ?? [] })) ?? [];
  const route = { enrolmentId: props.enrolmentId, lessonId: props.lessonId };

  function start(startNew = false) {
    setError(null);
    transition(async () => {
      try {
        const reply = await (props.onStart ?? startAttemptAction)({ ...route, assessmentId: props.assessmentId, startNew });
        if (!reply.ok) { setError(reply); return; }
        setActive(reply.attempt); setResult(null); setSaved(false);
        setHistory(reply.history);
        setRemaining(reply.attemptsRemaining);
        setAnswers(Object.fromEntries(reply.attempt.responses.map(r => [r.questionId, r.selectedOptionIds])));
      } catch { setError({ message: "This quiz could not be opened. Try again." }); }
    });
  }
  function submit() {
    if (!active) return;
    setError(null);
    transition(async () => {
      try {
        const reply = await (props.onSubmit ?? submitAttemptAction)({ ...route, attemptId: active.id, responses });
        if (!reply.ok) { setError(reply); return; }
        setResult(reply.result); setActive(null);
        setHistory(old => [...old.filter(a => a.attemptId !== reply.result.attemptId), reply.result]);
        setRemaining(old => old == null ? null : Math.max(0, old - (props.active?.id === active.id ? 0 : 1)));
      } catch { setError({ message: "Your quiz couldn't be submitted", body: "Keep this page open and try submitting again." }); }
    });
  }
  function save() {
    if (!active) return;
    setError(null);
    transition(async () => {
      try {
        const reply = await (props.onSave ?? saveAttemptAnswersAction)({ ...route, attemptId: active.id, responses });
        if (!reply.ok) setError(reply); else setSaved(true);
      } catch { setError({ message: "Your answers could not be saved. Try again." }); }
    });
  }

  return <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6 shadow-card" aria-label="Quiz">
    <h2 className="flex items-center gap-2 text-lg font-semibold"><ListChecks aria-hidden size={20} />{props.title}</h2>
    {props.instructions && <p className="whitespace-pre-wrap text-sm">{props.instructions}</p>}
    <dl className="flex flex-wrap gap-4 text-sm text-muted-foreground">
      <div><dt>Attempts</dt><dd>{props.maxAttempts ?? "Unlimited"}</dd></div>
      <div><dt>Remaining</dt><dd>{remaining ?? "Unlimited"}</dd></div>
      <div><dt>Pass mark</dt><dd>{props.passMark ?? "No threshold"}</dd></div>
      {props.availableFrom && <div><dt>Opens</dt><dd className="font-mono">{formatTimestamp(new Date(props.availableFrom))}</dd></div>}
      {props.availableUntil && <div><dt className="flex items-center gap-1"><Clock aria-hidden size={16} />Closes</dt><dd className="font-mono">{formatTimestamp(new Date(props.availableUntil))}</dd></div>}
    </dl>

    {active ? <form onSubmit={e => { e.preventDefault(); submit(); }} className="flex flex-col gap-6">
      <p role="status" className="sticky top-0 z-10 bg-surface py-2 text-sm font-semibold">{answered} of {active.questions.length} answered</p>
      <fieldset disabled={pending} className="flex flex-col gap-6">
        {active.questions.map((q, index) => <fieldset key={q.id} className="flex flex-col gap-2">
          <legend className="text-base font-semibold">{index + 1}. {q.prompt}</legend>
          <p className="text-sm text-muted-foreground">{q.marks} marks</p>
          {q.options.map(o => <label key={o.id} className="flex items-center gap-2 text-sm">
            <input type={q.type === "MULTI_CHOICE" ? "checkbox" : "radio"} name={q.id} value={o.id}
              checked={answers[q.id]?.includes(o.id) ?? false}
              className="size-4 border-[1.5px] border-input-border accent-accent"
              onChange={e => { setSaved(false); setAnswers(old => ({ ...old, [q.id]: q.type === "MULTI_CHOICE"
                ? e.target.checked ? [...(old[q.id] ?? []), o.id] : (old[q.id] ?? []).filter(id => id !== o.id) : [o.id] })); }} />{o.label}
          </label>)}
        </fieldset>)}
        <div className="flex gap-2">
          <button type="button" onClick={save} className="rounded-md border border-input-border px-4 py-2 text-sm">Save answers</button>
          <button type="submit" className={BUTTON} disabled={pending || answered !== active.questions.length}>{pending ? "Saving…" : "Submit quiz"}</button>
        </div>
        {saved && <p role="status" className="text-sm text-muted-foreground">Answers saved.</p>}
      </fieldset>
    </form> : <>
      {result && <div className="flex flex-col gap-4">
        {result.expired && <p className="flex gap-2 text-sm text-warning"><AlertTriangle aria-hidden size={20} />This assessment&apos;s availability window has closed. Your answers as submitted were scored automatically.</p>}
        <p className="font-semibold">{result.score} / {result.maxScore} ({Math.round((result.score ?? 0) / Math.max(1, result.maxScore ?? 1) * 100)}%)</p>
        <StatusPill tone={result.passed ? "success" : "warning"} label={result.passed ? "Passed" : "Not yet passed"} />
        {props.feedbackBehaviour !== "NEVER" && result.perQuestion.map(q => <div key={q.questionId} className="flex flex-col gap-1">
          <p>{q.prompt}</p><p className="text-sm text-muted-foreground">Your selection: {q.selectedOptionIds.map(id => q.optionLabels?.[id] ?? id).join(", ") || "No answer"}</p>
          {q.correctOptionIds.length > 0 && <p className={`flex gap-1 text-sm ${q.correct ? "text-success" : "text-danger"}`}><CheckCircle2 aria-hidden size={16} />Correct answer: {q.correctOptionIds.map(id => q.optionLabels?.[id] ?? id).join(", ")}</p>}
          {q.explanation && <p className="text-sm text-muted-foreground">{q.explanation}</p>}
        </div>)}
      </div>}
      {closed ? <p className="flex gap-2 text-sm text-warning"><AlertTriangle aria-hidden size={20} />The window for this assessment has closed.</p>
        : notOpen ? <p className="text-sm text-warning">The window for this assessment has not opened yet.</p>
        : remaining === 0 && !resumable ? <p className="text-sm text-muted-foreground">You&apos;ve used all {props.maxAttempts} of your attempts for this quiz.</p>
        : <div className="flex flex-col items-start gap-2">
          <button disabled={pending} onClick={() => start()} className={BUTTON}>{pending ? "Opening…" : resumable ? "Resume attempt" : history.length ? "Start new attempt" : "Start quiz"}</button>
          {resumable && (remaining == null || remaining > 0) && <>
            <button disabled={pending} onClick={() => competing ? start(true) : setCompeting(true)} className="text-sm text-accent">{competing ? "Continue with new attempt" : "Start new attempt"}</button>
            {competing && <p className="text-sm text-muted-foreground">Starting a new attempt will abandon your unfinished one — it won&apos;t be scored.</p>}
          </>}
        </div>}
    </>}
    {error && <div role="alert" className="flex flex-col gap-2 text-sm text-danger"><p>{error.message}</p>{error.body && <p>{error.body}</p>}{active && <button disabled={pending} onClick={submit} className={BUTTON}>Try again</button>}</div>}
    {history.length > 0 && <div className="flex flex-col gap-2"><h3 className="text-sm font-semibold">Attempt history</h3><ul className="flex flex-col gap-2">{history.map(a => <li key={a.attemptId} className="flex flex-wrap items-center gap-2 text-sm">
      <span>Attempt {a.attemptNumber}</span><span className="font-mono">{a.submittedAt ? formatTimestamp(new Date(a.submittedAt)) : "—"}</span>
      <StatusPill tone={a.status === "ABANDONED" ? "neutral" : a.passed ? "success" : "warning"} label={a.status === "ABANDONED" ? "Abandoned" : a.passed ? "Passed" : "Not yet passed"} />
      <span className="font-mono">{a.status === "ABANDONED" ? "—" : `${a.score} / ${a.maxScore}`}</span>
    </li>)}</ul></div>}
  </section>;
}
