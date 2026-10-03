import Link from "next/link";
import type { ReactNode } from "react";
import { CircleCheck, Lock } from "lucide-react";
import {
  DetailFacts,
  DetailLayout,
  StatusPill,
  type DetailLayoutState,
  type DetailSection,
} from "@/components/primitives";
import { NOTE, NOTE_WARNING } from "@/components/primitives/controls";
import {
  ACTIVATION_PERMISSION_NOTE,
  BLOCKED_HEADING,
  DIAGNOSTIC_HELPER,
  EXPORTS_HELPER,
  EXPORTS_LINK_LABEL,
  NOTHING_BLOCKED,
  NOT_AVAILABLE,
  WORKS_HEADING,
} from "@/server/licence/policy";
import type { LicenceFactView, LicenceStatusViewModel } from "@/server/licence/view-model";
import { CopyButton } from "./CopyButton";

/**
 * Licence & System Status (Phase 14, plan 14-10; LIC-02, D-14, 14-UI-SPEC).
 *
 * A presentational component: every sentence arrives in the view model or is a
 * `policy.ts` constant, so no licence wording is typed here (D-06). It offers no
 * control that creates, extends, edits, replaces a signature on or self-reactivates
 * a licence (LIC-03); the only write control is the `activationSlot` that plan
 * 14-15 supplies, shown to holders of `licence.activate` only. `diagnosticSlot`
 * is the diagnostic download supplied by the same plan.
 *
 * The denied, error and loading states render no licence field at all: with no
 * view model there is nothing to leak (T-14-10-03). Only existing tokens and
 * primitives are used; this component adds no CSS.
 */

const TITLE = "Licence & System Status";
const LINK_CLASS = "font-semibold text-accent underline underline-offset-2";

export type LicenceStatusViewProps = {
  vm?: LicenceStatusViewModel;
  canActivate: boolean;
  state?: DetailLayoutState;
  activationSlot?: ReactNode;
  diagnosticSlot?: ReactNode;
};

export function LicenceStatusView({
  vm,
  canActivate,
  state,
  activationSlot,
  diagnosticSlot,
}: LicenceStatusViewProps) {
  if (state && state.status !== "ready") {
    return <DetailLayout title={TITLE} sections={[]} mode="stacked" state={state} />;
  }
  if (!vm) {
    // Defensive: a ready state with no view model is a load failure, never an empty screen.
    return <DetailLayout title={TITLE} sections={[]} mode="stacked" state={{ status: "error" }} />;
  }

  const sections: DetailSection[] = [
    { id: "status", label: "Status", content: <StatusBlock vm={vm} /> },
    { id: "details", label: "Licence details", content: <DetailFacts facts={vm.facts.map(factRow)} /> },
    { id: "capabilities", label: "What works and what is blocked", content: <Capabilities vm={vm} /> },
    { id: "support", label: "Renewal and support", content: <SupportBlock vm={vm} />, aside: true },
    {
      id: "activate",
      label: "Activate a licence",
      aside: true,
      // No slot yet (before plan 14-15): a holder sees no empty heading.
      content: canActivate ? (activationSlot ?? null) : <p className={NOTE}>{ACTIVATION_PERMISSION_NOTE}</p>,
    },
    {
      id: "data",
      label: "Data and diagnostics",
      aside: true,
      // Nothing to show (no slot, no reports access): no empty heading.
      content: diagnosticSlot || vm.canViewReports ? <DataBlock vm={vm} diagnosticSlot={diagnosticSlot} /> : null,
    },
  ];

  return (
    <DetailLayout
      title={TITLE}
      badges={<StatusPill label={vm.pill.label} tone={vm.pill.tone} />}
      subtitle={
        vm.subtitleEmail ? (
          <span>
            Renewal contact: <span className="break-all">{vm.subtitleEmail}</span>
          </span>
        ) : undefined
      }
      mode="stacked"
      sections={sections}
    />
  );
}

/** One DetailFacts row; a missing value is the muted "Not available", never a blank. */
function factRow(fact: LicenceFactView): { label: string; value: ReactNode } {
  const muted = "font-normal text-muted-foreground";
  const pill = fact.pill ? <StatusPill label={fact.pill.label} tone={fact.pill.tone} /> : null;

  if (fact.id === "deploymentId" && fact.value !== null) {
    return {
      label: fact.label,
      value: (
        <span className="flex items-start gap-2">
          <span className="min-w-0 flex-1 self-center font-mono text-[13px] tabular-nums break-all">{fact.value}</span>
          <CopyButton value={fact.value} label="Copy deployment ID" />
        </span>
      ),
    };
  }

  const text =
    fact.value === null ? (
      pill ? null : (
        <span className={muted}>{NOT_AVAILABLE}</span>
      )
    ) : (
      <span
        className={
          fact.mono ? "font-mono text-[13px] tabular-nums break-all" : fact.id === "client" ? "break-words" : undefined
        }
      >
        {fact.value}
      </span>
    );

  return {
    label: fact.label,
    value: (
      <span className="flex flex-col gap-1">
        {pill}
        {text}
        {fact.zoneNote && <span className={`text-sm ${muted}`}>{fact.zoneNote}</span>}
        {fact.utc && (
          <span className={`font-mono text-[13px] tabular-nums break-all ${muted}`}>{fact.utc}</span>
        )}
      </span>
    ),
  };
}

function StatusBlock({ vm }: { vm: LicenceStatusViewModel }) {
  if (vm.emptyState) {
    return (
      <div className="flex flex-col gap-3 pt-4">
        <p className="text-base font-semibold text-foreground">{vm.emptyState.heading}</p>
        <p className="max-w-prose text-base text-foreground">{vm.emptyState.body}</p>
      </div>
    );
  }

  const figureClass = vm.figure && vm.figure.length > 9 ? "text-[22px]" : "text-[28px]";
  return (
    <div className="flex flex-col gap-4 pt-4">
      <div className="flex flex-col gap-1">
        {vm.figure && (
          <p className={`${figureClass} leading-[1.2] font-semibold tabular-nums text-foreground`}>{vm.figure}</p>
        )}
        {vm.caption &&
          (vm.figure ? (
            <p className="text-sm text-muted-foreground">{vm.caption}</p>
          ) : (
            <p className="text-[22px] leading-[1.2] font-semibold text-foreground">{vm.caption}</p>
          ))}
      </div>
      <p className="max-w-prose text-base text-foreground">{vm.summary}</p>
      {vm.clockNote && <p className={NOTE_WARNING}>{vm.clockNote}</p>}
    </div>
  );
}

function CapabilityList({
  heading,
  items,
  icon,
  after,
}: {
  heading: string;
  items: string[];
  icon: "works" | "blocked";
  after?: { heading: string; items: string[] } | null;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 border border-border bg-surface-2 p-4">
      <h3 className="text-sm font-semibold text-foreground">{heading}</h3>
      <ul className="flex flex-col gap-2">
        {items.map((text) => (
          <CapabilityItem key={text} text={text} icon={text === NOTHING_BLOCKED ? null : icon} />
        ))}
      </ul>
      {after && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <h4 className="text-sm font-semibold text-foreground">{after.heading}</h4>
          <ul className="flex flex-col gap-2">
            {after.items.map((text) => (
              <CapabilityItem key={text} text={text} icon="blocked" />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CapabilityItem({ text, icon }: { text: string; icon: "works" | "blocked" | null }) {
  return (
    <li className="flex items-start gap-2 text-sm text-foreground">
      {icon === "works" && <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
      {icon === "blocked" && <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
      <span className="min-w-0 break-words">{text}</span>
    </li>
  );
}

function Capabilities({ vm }: { vm: LicenceStatusViewModel }) {
  return (
    <div className="flex flex-col gap-6 pt-6">
      <div className="grid gap-8 md:grid-cols-2">
        <CapabilityList heading={WORKS_HEADING} items={vm.works} icon="works" />
        <CapabilityList heading={BLOCKED_HEADING} items={vm.blocked} icon="blocked" after={vm.afterGrace} />
      </div>
      <p className={NOTE}>{vm.preservedData}</p>
    </div>
  );
}

function SupportBlock({ vm }: { vm: LicenceStatusViewModel }) {
  const renewal = vm.renewal;
  if (!renewal) {
    return <p className="pt-4 text-base text-foreground">{vm.renewalFallback}</p>;
  }
  return (
    <dl className="flex flex-col gap-4 pt-4">
      <SupportRow label="Renewal email">
        <a href={`mailto:${renewal.renewalEmail}`} className={`${LINK_CLASS} break-all`}>
          {renewal.renewalEmail}
        </a>
      </SupportRow>
      <SupportRow label="Support email">
        <a href={`mailto:${renewal.supportEmail}`} className={`${LINK_CLASS} break-all`}>
          {renewal.supportEmail}
        </a>
      </SupportRow>
      {renewal.phone && (
        <SupportRow label="Phone">
          <span className="break-words">{renewal.phone}</span>
        </SupportRow>
      )}
      {renewal.hours && (
        <SupportRow label="Hours">
          <span className="break-words">{renewal.hours}</span>
        </SupportRow>
      )}
    </dl>
  );
}

function SupportRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-base text-foreground">{children}</dd>
    </div>
  );
}

function DataBlock({ vm, diagnosticSlot }: { vm: LicenceStatusViewModel; diagnosticSlot?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 pt-4">
      {diagnosticSlot && (
        <div className="flex flex-col gap-2">
          {diagnosticSlot}
          <p className="text-sm text-muted-foreground">{DIAGNOSTIC_HELPER}</p>
        </div>
      )}
      {vm.canViewReports && (
        <div className="flex flex-col gap-2">
          <Link href="/staff/reports" className={LINK_CLASS}>
            {EXPORTS_LINK_LABEL}
          </Link>
          <p className="text-sm text-muted-foreground">{EXPORTS_HELPER}</p>
        </div>
      )}
    </div>
  );
}
