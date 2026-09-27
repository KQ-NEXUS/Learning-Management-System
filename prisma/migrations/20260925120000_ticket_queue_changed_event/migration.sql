-- Staff queue moves are attributed chronology entries (SUP-03, D-15).
ALTER TYPE "TicketEventType" ADD VALUE IF NOT EXISTS 'QUEUE_CHANGED';
