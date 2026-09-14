---
phase: "7"
slug: "multi-gateway-payments-paystack-manual-refunds"
status: complete
nyquist_compliant: true
wave_0_complete: true
created: "2026-09-12"
task1_reconciled: "2026-09-13"
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Seeded from
> `07-RESEARCH.md`'s Validation Architecture section before planning — the planner assigns
> exact Task IDs/waves per `07-RESEARCH.md`'s Task-by-Task Drift Reconciliation mapping
> (Tasks 1-9, carried forward from `docs/superpowers/plans/2026-09-11-dual-currency-fee-splitting.md`).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest `^4.1.11` |
| **Config file** | `vitest.config.mts` (root) |
| **Quick run command** | `npx vitest run <file1> <file2> ...` (per-task focused command) |
| **Full suite command** | `npm test` (= `vitest run --no-file-parallelism`) |
| **Estimated runtime** | Phase 6's comparable full suite ran in the multi-minute range (boundary.test.ts alone: ~200s) — full-suite runtime for Phase 7 is expected to be similar order of magnitude given the added integration test count below |

---

## Sampling Rate

- **After every task commit:** Run the task's own focused `npx vitest run <files>` command (per-task commands specified in the superpowers plan and echoed in the Requirement Map below)
- **After every plan wave:** Run `npm test` (full suite)
- **Before `/gsd-verify-work`:** Full suite must be green; additionally `npm run lint` and `npm run build` (Task 9 Step 3)
- **Max feedback latency:** ~210 seconds (bounded by the slowest existing focused command, `boundary.test.ts`'s ~200s import/transform cost)

---

## Per-Requirement Verification Map

*Task ID / Plan / Wave assigned 2026-09-12 when the source 9-task plan was decomposed into 12 GSD
plans across 8 waves. Requirement IDs and commands below are locked from `07-RESEARCH.md`'s own
Phase Requirements → Test Map; where a Docker-dependent integration file was the only listed proof,
a Docker-independent unit file is named alongside it, because STATE.md records Docker as unavailable
throughout every Phase 6 execution sandbox.*

*Reconciled 2026-09-13 (07-12 Task 1): Docker WAS available in this execution sandbox — every
Wave-0 file below exists and every listed automated command was actually run this session (either
directly inside the full `npm test` pass, or via an isolated `npx vitest run <file>` re-run to
settle a transient Docker container-lifecycle disruption — see the session note below the table).
No file is Docker-BLOCKED. Task/Plan/Wave column extended with the specific task number that
delivered each requirement, drawn from each `07-NN-SUMMARY.md`'s own Task Commits section.*

| Req ID | Behavior | Test Type | Automated Command | Task / Plan / Wave | File Exists? | Status |
|--------|----------|-----------|-------------------|-------------|-------------|--------|
| COH-02 | Dual NGN/USD price validation, publish blocked on missing enabled-rail price | unit | `npx vitest run tests/cohort-service.test.ts tests/cohort-readiness.test.ts tests/cohort-actions.test.ts tests/checkout-phase-invariants.test.ts` | 07-02 Task 2 / wave 1 (schema); 07-05 Task 2 / wave 3 (dual-price service + per-rail readiness); 07-11 Task 1 / wave 7 (legacy-reference AST invariant) | Existing, extended | ✅ green |
| PAY-08 | NGN→Paystack, USD→Stripe server-derived routing; client cannot override | unit | `npx vitest run tests/payment-routing.test.ts tests/checkout-service.test.ts tests/components/cohort-cards.test.tsx` | 07-03 Task 3 / wave 1 (routing.ts); enforced at the call sites in 07-04 Task 1 / wave 2 and 07-06 Task 2 / wave 3 (crossed-rail refusal); dual-currency offer-card branches in 07-09 Task 1 / wave 6 | Existing, created wave 1 | ✅ green |
| PAY-15 | 1.5% platform fee exact, integer, of base not total | unit | `npx vitest run tests/payment-pricing.test.ts` | 07-03 Task 2 / wave 1 | Existing, created wave 1 | ✅ green |
| PAY-16 | Gateway gross-up from versioned schedule, reproducible after config change | unit + integration | `npx vitest run tests/payment-pricing.test.ts tests/schema-payment-split.test.ts` | 07-02 Task 2 / wave 1 (schedule model), 07-03 Task 2 / wave 1 (formula), 07-04 Task 1 / wave 2 (order-creation snapshot) | Existing, created wave 1 | ✅ green |
| PAY-09 (regression, generalized) | No Paystack-specific type/import outside its adapter directory | unit (AST scan) | `npx vitest run tests/checkout-phase-invariants.test.ts` | 07-04 Task 3 / wave 2 (generalizes the scan to Paystack); extended by 07-08 Task 3 / wave 5 (refund adapters), 07-11 Task 1 / wave 7 (legacy-price invariant) | Existing, extended by 07-04 | ✅ green |
| PAY-10 (regression) | Exactly one module writes `Order.status="PAID"` | unit (AST scan) | `npx vitest run tests/checkout-phase-invariants.test.ts` | re-asserted by 07-04 Task 3 / wave 2, 07-07 Task 2 / wave 4, 07-08 Task 2 / wave 5 | Existing, already covers this | ✅ green |
| PAY-07 / PAY-11 | Idempotent webhook processing, no duplicate paid effect | unit + integration | `npx vitest run tests/checkout-webhook-system-service.test.ts tests/paystack-provider.test.ts tests/paystack-webhook.integration.test.ts tests/payment-reconciliation.integration.test.ts tests/reconcile-payments-task.test.ts tests/netlify-reconcile-payments.test.ts` | 07-04 Task 2 / wave 2 (Paystack webhook idempotency + Verify-Transaction cross-check), 07-07 Task 2-3 / wave 4 (reconciliation idempotency + scheduled sweep) | Created wave 2 and wave 4 | ✅ green |
| PAY-03 / PAY-04 | Manual confirmation, one audit + one enrolment effect, duplicate rejected | unit + integration | `npx vitest run tests/manual-payment-service.test.ts tests/manual-payment.integration.test.ts tests/components/payment-detail.test.tsx tests/staff-payments-actions.test.ts` | 07-08 Task 2 / wave 5 (service), 07-10 Task 3 / wave 6 (Finance dialog + Server Action surface) | Created wave 5 and wave 6 | ✅ green |
| PAY-05 / PAY-13 | Refund capped at eligible value, routes to original provider, auditable | unit + integration | `npx vitest run tests/refund-service.test.ts tests/refund.integration.test.ts tests/components/payment-detail.test.tsx tests/staff-payments-actions.test.ts` | 07-01 Task 2 / wave 1 (reversal policy decision), 07-08 Task 3 / wave 5 (service + Order-row-lock TOCTOU fix), 07-10 Task 3 / wave 6 (surface) | Created wave 5 and wave 6 | ✅ green |
| PAY-17 | Provider-native split settlement, expected-vs-actual reconcilable | unit + integration + real provider | `npx vitest run tests/paystack-provider.test.ts tests/checkout-service.test.ts tests/payment-reconciliation.integration.test.ts tests/checkout-webhook.integration.test.ts` | 07-04 Task 1 / wave 2 (Paystack split), 07-06 Task 2-3 / wave 3 (Stripe Connect destination charge + settlement evidence), 07-07 Task 2 / wave 4 (reconciliation), 07-12 Task 2 (real-provider UAT) | Created wave 2, 3 and 4 | ✅ green — Paystack and Stripe test-mode fund flows confirmed in `07-UAT.md` |
| PAY-14 | Gateway credentials/webhook secrets stay server-side only | unit + static | `npx vitest run tests/payments-settlement-config.test.ts tests/components/checkout-summary.test.tsx tests/components/payment-detail.test.tsx` | 07-01 Task 3 / wave 1 (fail-closed reader), 07-09 Task 2 / wave 6 + 07-10 Task 2 / wave 6 (no-secret render cases), 07-11 Task 3 / wave 7 (README deployment-config docs review) | Existing, created wave 1 | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

### Final session note — 2026-09-14

The final full `npm test` executed all 141 files: 137 passed, 1,882 tests passed and 47 were skipped;
the four non-passing files failed only because Docker Desktop stopped their Testcontainers containers
with HTTP 409. There were no assertion failures. Each affected file was then accounted for in a clean
isolated run:

- `tests/paystack-webhook.integration.test.ts` passed as part of the five-file affected regression run (109/109 total).
- `tests/continuity-concurrency.integration.test.ts` passed 14/14.
- `tests/publish.integration.test.ts` passed 15/15.
- `tests/schema-payment-split.test.ts` passed 38/38.

The two failures this document previously called pre-existing are now fixed: stale cohort publication
returns `StaleOrderError`, and the Docker email fixtures provide `AUTH_SECRET`. The final lint run exited
0 with 10 warnings and no errors. The final Next.js 16.3.4 production build exited 0 after compilation,
TypeScript, page-data collection and all 28 static pages.

The closing live-server audit also found a checkout countdown hydration mismatch caused by separate
server/browser `Date.now()` initializers. A server-render/hydrate regression reproduced it before the
fix; `tests/components/checkout-summary.test.tsx` now passes 27/27, and a brand-new live checkout rendered
its countdown with zero hydration errors. The post-fix lint/build result is recorded in `07-12-SUMMARY.md`.

---

## Wave 0 Requirements

Each row names the GSD plan that creates the file and the wave it lands in.
**Reconciled 2026-09-13: all eighteen items below confirmed present on disk and passing (directly
in the full `npm test` run or via isolated re-run — see the session note above the requirement
map).**

- [x] `tests/payments-settlement-config.test.ts` — new, 07-01, wave 1
- [x] `tests/schema-payment-split.test.ts` — new, 07-02, wave 1
- [x] `tests/payment-pricing.test.ts` — new, 07-03, wave 1
- [x] `tests/payment-routing.test.ts` — new, 07-03, wave 1
- [x] `tests/paystack-provider.test.ts` — new, 07-04, wave 2
- [x] `tests/paystack-webhook.integration.test.ts` — new, 07-04, wave 2
- [x] `tests/checkout-phase-invariants.test.ts` provider-isolation scan generalized for Paystack — extension of an existing file, 07-04, wave 2 (a third legacy-price invariant is added by 07-11, wave 7)
- [x] `tests/payment-reconciliation.integration.test.ts` — new, 07-07, wave 4
- [x] `tests/reconcile-payments-task.test.ts` — new, 07-07, wave 4
- [x] `tests/netlify-reconcile-payments.test.ts` — new, 07-07, wave 4
- [x] `tests/manual-payment-service.test.ts` — new, 07-08, wave 5 (Docker-independent proof)
- [x] `tests/refund-service.test.ts` — new, 07-08, wave 5 (Docker-independent proof)
- [x] `tests/manual-payment.integration.test.ts` — new, 07-08, wave 5
- [x] `tests/refund.integration.test.ts` — new, 07-08, wave 5
- [x] `tests/components/payment-detail.test.tsx` — new, 07-10, wave 6
- [x] `tests/payment-read-service.test.ts` — new, 07-10, wave 6
- [x] `tests/staff-payments-actions.test.ts` — new, 07-10, wave 6
- [x] Framework install: none — Vitest is already fully configured; no new test infrastructure needed.

---

## Manual Provider Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real Paystack test-mode split payment against a live subaccount | PAY-08, PAY-17, D-03 | Requires real test-mode credentials and hosted checkout | ✅ Complete — transaction `6554394136`; actual Paystack split recorded in `07-UAT.md` item 1 |
| Real Stripe Connect destination charge against a test-mode connected account | PAY-17, D-04 | Requires a real test-mode connected account and hosted checkout | ✅ Complete — real PaymentIntent/Transfer/balance transaction recorded in `07-UAT.md` item 2 |
| Docker-dependent real-Postgres integration tests (`.integration.test.ts` files) | PAY-07, PAY-11, PAY-03/04, PAY-05/13, PAY-17 | Requires Docker/Testcontainers | ✅ Complete — affected integrations passed alone; full-run Docker 409s are enumerated in the final session note |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 210s (per-task focused commands; the full-suite batch run itself takes
      ~15-16 minutes end to end, which is expected for a 141-file/Docker-backed suite run as a
      whole and is not the per-task feedback path this line measures)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** Complete 2026-09-14. Automated acceptance, the ten-item provider/UI UAT record and
phase-record reconciliation are complete. No reproducible assertion failure remains. Docker's
full-run HTTP 409 container stops are preserved above together with the successful isolated reruns;
they are not summarized away as application passes.
