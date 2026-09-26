import { Lock } from "lucide-react";

export type TicketContextCardProps = {
  kind: string;
  reference: string;
  /** Present only before ticket creation; after creation the card is locked. */
  onRemove?: () => void;
  locked?: boolean;
};

const KIND_LABEL: Record<string, string> = {
  COURSE: "course",
  COHORT: "cohort",
  ORDER: "order",
  SUBMISSION: "submission",
  CERTIFICATE: "certificate",
  USER: "account",
};

export function TicketContextCard({ kind, reference, onRemove, locked = false }: TicketContextCardProps) {
  const type = KIND_LABEL[kind] ?? kind.toLowerCase();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-2 p-4">
      <p className="flex min-w-0 items-center gap-2 text-sm text-foreground">
        {locked && <Lock aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
        <span className="min-w-0 break-words">
          This ticket will include {type} <span className="font-mono">{reference}</span>.
        </span>
      </p>
      {locked && (
        <p className="w-full text-xs text-muted-foreground">
          Captured when this ticket was created. This reference cannot be changed.
        </p>
      )}
      {onRemove && !locked && (
        <button
          type="button"
          onClick={onRemove}
          className="min-h-11 rounded-md px-2 text-sm font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-focus"
        >
          Remove context
        </button>
      )}
    </div>
  );
}
