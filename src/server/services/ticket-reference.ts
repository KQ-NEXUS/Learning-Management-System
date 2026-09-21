import { randomUUID as nodeRandomUUID } from "node:crypto";

const TICKET_REFERENCE_PATTERN = /^KQT-(\d{4})(\d{2})(\d{2})-([0-9A-F]{8})$/;

export type TicketReferenceDependencies = {
  now?: () => Date;
  randomUUID?: () => string;
};

export function generateTicketReference(
  dependencies: TicketReferenceDependencies = {},
): string {
  const now = dependencies.now?.() ?? new Date();
  const randomUUID = dependencies.randomUUID ?? nodeRandomUUID;
  const dateStamp = now.toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  return `KQT-${dateStamp}-${suffix}`;
}

export function isTicketReference(value: string): boolean {
  const match = TICKET_REFERENCE_PATTERN.exec(value);
  if (!match) return false;

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}
