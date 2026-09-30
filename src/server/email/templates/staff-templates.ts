/**
 * The four staff templates (D-08). Staff mail carries references and a coded
 * reason label only, never staff notes or exception notes (T-13-03). The
 * caller maps a reason code to a plain-language `reasonLabel` before rendering.
 */

import { buildAbsoluteUrl } from "@/server/email/config";
import type { EmailContent } from "@/server/email/templates/layout";

export type StaffParamsMap = {
  "staff-ticket-assigned": { reference: string; ticketPath: string };
  "staff-ticket-escalated": { reference: string; queueLabel: string; ticketPath: string };
  "staff-order-exception": { orderReference: string; reasonLabel: string; paymentPath: string };
  "staff-reconciliation-exception": { orderReference: string; paymentPath: string };
};

type Definition<P> = (params: P) => EmailContent;

export const STAFF_TEMPLATES: { [K in keyof StaffParamsMap]: Definition<StaffParamsMap[K]> } = {
  "staff-ticket-assigned": (p) => ({
    subject: `Ticket ${p.reference} was assigned to you`,
    heading: "A ticket was assigned to you",
    paragraphs: [`Ticket ${p.reference} has been assigned to you.`],
    button: { label: "View ticket", href: buildAbsoluteUrl(p.ticketPath) },
  }),
  "staff-ticket-escalated": (p) => ({
    subject: `Ticket ${p.reference} was escalated to ${p.queueLabel}`,
    heading: "A ticket was escalated",
    paragraphs: [`Ticket ${p.reference} has been escalated to ${p.queueLabel}.`],
    button: { label: "View ticket", href: buildAbsoluteUrl(p.ticketPath) },
  }),
  "staff-order-exception": (p) => ({
    subject: `Order ${p.orderReference} needs review: ${p.reasonLabel}`,
    heading: "An order needs review",
    paragraphs: [`Order ${p.orderReference} has a payment exception: ${p.reasonLabel}.`],
    button: { label: "Review payment", href: buildAbsoluteUrl(p.paymentPath) },
  }),
  "staff-reconciliation-exception": (p) => ({
    subject: `Reconciliation exception for order ${p.orderReference}`,
    heading: "A reconciliation exception was raised",
    paragraphs: [`Payment reconciliation for order ${p.orderReference} raised an exception.`],
    button: { label: "Review payment", href: buildAbsoluteUrl(p.paymentPath) },
  }),
};

export const STAFF_SAMPLES: StaffParamsMap = {
  "staff-ticket-assigned": { reference: "KQT-1", ticketPath: "/staff/support/KQT-1" },
  "staff-ticket-escalated": {
    reference: "KQT-1",
    queueLabel: "Billing",
    ticketPath: "/staff/support/KQT-1",
  },
  "staff-order-exception": {
    orderReference: "KQO-1042",
    reasonLabel: "Amount mismatch",
    paymentPath: "/staff/payments/KQO-1042",
  },
  "staff-reconciliation-exception": {
    orderReference: "KQO-1042",
    paymentPath: "/staff/payments/KQO-1042",
  },
};
