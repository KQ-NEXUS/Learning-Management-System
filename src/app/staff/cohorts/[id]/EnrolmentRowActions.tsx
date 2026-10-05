"use client";

import { RowActionMenu, type RowActionItem } from "@/components/primitives/RowActionMenu";
import type { EnrolmentActionTarget } from "./EnrolmentActionModals";

/**
 * The per-row enrolment actions as a three-dots menu, shared by the global
 * enrolments list and the cohort Roster tab so the two always offer the same
 * actions. Choosing one opens the same confirmation dialogs as before
 * (`EnrolmentActionModals`); nothing here changes what an action does.
 */
export function EnrolmentRowActions({
  status,
  cohortId,
  enrolmentId,
  learnerName,
  onOpen,
}: {
  status: string;
  cohortId: string;
  enrolmentId: string;
  learnerName: string;
  onOpen: (target: EnrolmentActionTarget) => void;
}) {
  const item = (
    action: "approve" | "transfer" | "withdraw" | "cancel",
    label: string,
    destructive = false,
  ): RowActionItem => ({
    key: action,
    label,
    destructive,
    onSelect: () => onOpen({ action, cohortId, enrolmentId, learnerName }),
  });

  let items: RowActionItem[] = [];
  if (status === "PENDING_PAYMENT") {
    items = [item("approve", "Approve"), item("cancel", "Cancel enrolment", true)];
  } else if (status === "ACTIVE") {
    items = [item("transfer", "Transfer"), item("withdraw", "Withdraw", true), item("cancel", "Cancel enrolment", true)];
  }

  if (items.length === 0) return <span aria-hidden>—</span>;
  return <RowActionMenu label={`Actions for ${learnerName}`} items={items} />;
}
