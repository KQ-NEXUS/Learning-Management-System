---
created: 2026-09-25T18:00:00.000Z
title: Move staff support queue filtering, counts and paging into SQL
area: support
source: Phase 12 review (12-07 deviation 1)
files:
  - src/server/services/ticket-staff-queue-service.ts
---

## Problem

`getStaffQueue` runs `client.ticket.findMany` with no `where`, `take` or `orderBy`
and does tab counts, filters, search, sorting and the 20-row page slice in
JavaScript. Every queue page load reads the whole ticket table. It selects
summary fields only (no message bodies or attachments), so this is a scaling
issue, not a privacy or correctness one.

Accepted for v1 (bounded by learner count). Revisit when the ticket table
reaches roughly 2,000 rows, or if queue page load exceeds about 1 second.

## Fix sketch

Push category/priority/queue/owner/text filters and sorting into a Prisma
`where` / `orderBy` / `skip` / `take`, and compute the five tab counts and the
health strip with `count` / `groupBy` queries. Keep the existing queue tests and
`staff-support.integration.test.ts` as the safety net. No other module depends
on the in-memory row shape.
