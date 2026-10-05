---
created: 2026-10-05T09:00:00.000Z
title: Phase 15 prerequisites: merged UI review, licence go-live items, plan with co-worker
area: planning
resolves_phase: 15
source: working session 2026-10-05 (Phase 14 close-out, UI audit, UI prototype, pull of co-worker changes)
files:
  - .planning/audits/2026-10-05/UI-REVIEW-MERGED.md
  - .planning/audits/2026-10-05/UAT-FIXES-AND-ADDITIONS.md
  - .planning/phases/14-software-licence-deployment-control/14-VERIFICATION.md
  - .planning/phases/14-software-licence-deployment-control/14-UAT.md
  - .planning/phases/14-software-licence-deployment-control/14-REVIEW.md
---

## Why this exists

Decisions made on 2026-10-05 so they are not forgotten between sessions.

**Decision:** start Phase 15 with the UI/UX review INSIDE it (as its first plans), not as a separate
step before it, but only after a re-baseline of the UI on the current `develop` and a merge of the two
UI lists into one (this file's `UI-REVIEW-MERGED.md`).

## Rules for planning Phase 15

1. **Plan it together with the co-worker.** Their audit record says "Phase 15, to be planned with the
   co-worker". Do not plan or execute Phase 15 alone.
2. **UI work goes first**, driven by `UI-REVIEW-MERGED.md`. Do not redo what the co-worker already
   fixed (folding sidebar, staff and learner pop-up pickers, action confirmations, stepped forms,
   learner numbers). Their still-open items (U-02, U-05, U-07, U-09, U-11, U-12, U-16 and others) are
   part of the merged list.
3. **One owner at a time for shared UI parts** (ConfirmModal, ResourceForm, StaffShell, primitives,
   catalogue components). The co-worker changed these in the last pull; parallel edits will conflict.
4. **Never test against the shared Neon database.** Use the throwaway `licence_test` database in the
   Docker Postgres (port 5434) with a shell-level `DATABASE_URL` override.
5. **Commits only when the owner asks, per commit.**

## Go-live checklist additions (Phase 15 NFR and cutover)

The co-worker's "Before production" list names three Neon migrations. Add the missing fourth:

- [ ] Apply on Neon: `20261001120000_licence_deployment_control` (Phase 14, licence tables). Apply it
      BEFORE or with the deploy. Code live without these tables blocks guarded writes after 24 h only
      for a deployment known to be activated (review WR-01 was fixed to fail open otherwise).
- [ ] Licence production signing key: run the provider tool `keygen`, keep the private key offline, add
      the PUBLIC key to `PRODUCTION_TRUSTED_KEYS` in `src/server/licence/trust-set.ts` in a release,
      then issue and activate one real licence in production.
- [ ] Confirm the hourly Netlify `check-licence` scheduled function runs (docs/deployment/netlify-scheduled-functions.md).
- [ ] Regenerate the `.docx` twins of the PRD and PXR and align the commercial contract wording. The
      markdown copies in `docs/reference/` are gitignored, so the Phase 14 edits there are local only.
- [ ] Manual checks that no tool could do for Phase 14 screens: keyboard-only and screen-reader use,
      narrow widths and 200% zoom on the licence page, banner, activation dialog.
- [ ] Phase 14 itself is still `human_needed` in `14-VERIFICATION.md` and 14-UAT.md has open items
      (migration on a real database, production key, Netlify, docs). Close with `/gsd-verify-work 14`
      when those are done. Phase 14 is NOT marked complete in ROADMAP.md.

## Facts worth keeping

- Phase 14 reached `develop` as ONE commit, `39423b0`, 244 files, whose message ("add one-shot
  generator for schema-1 golden licence vectors") does not describe it. Already shared, so do not
  rewrite history; describe it in PR notes if needed.
- A UI prototype (single HTML file, axe-clean on 9 screens and 12 states) was built on 2026-10-04 in the
  Claude session scratchpad: `.../scratchpad/prototype/index.html`. It is in a temp folder; copy it
  into the repo (for example `design/ui-prototype/`) if it should be kept. Not yet done.
- The 2026-10-04 audit (before the pull) found these items NOT in the co-worker's lists, so re-check
  them on current `develop`: failed sign-in wipes the email and drops focus; phone sign-in and register
  push the form below the fold; public catalogue shows no price, button or value line; learner nav
  differs between pages; raw "Invalid input: expected string" text on the empty New course form;
  generic page titles; tiny table action links.

## Progress

- [x] Pulled and checked `develop`: Phase 14 present, licence safety tests 177/177, types clean.
- [x] Re-run the UI audit on current `develop` and write `UI-REVIEW-MERGED.md` (done 2026-10-05). Headline: the co-worker's new
      notification popup (`src/components/feedback/Toaster.tsx`, lines 120 to 122) adds 2 axe errors to all 31 screens; fix is
      `role="region"` on that div. Of my 14 distinct earlier findings: 2 fixed, 3 partly fixed, 9 still present.
- [x] UI fix implementation plan written: `.planning/audits/2026-10-05/UI-FIX-IMPLEMENTATION-PLAN.md` (12 tasks T1 to T13, real
      files and lines, tests to update, verification). The owner creates the branch (suggested `ui-fixes`, from `develop`); Claude
      then implements, no commits unless asked. Implement in the order given in section 1 of that plan.
- [x] Visual review page published (private Claude artifact, 16 items with before and after screenshots and a clickable
      prototype): https://claude.ai/artifact/Ncf9Fnc6TFNzEbpKEGjNMN . Source files are in the Claude session scratchpad
      (`review-page/`), which is temporary. Share it with the co-worker from the page's Share menu.
- [x] Owner approved (2026-10-05) the stepped form pattern with Review step and the three-dots row-actions menu. Added to the plan as T14 and T8 change. Prototype: https://claude.ai/artifact/EL7ZyGM7LyCfGLiYtUEyEj
- [x] Branch `UI-fix` created; Claude implemented T1-T12 and T14 (no commits). See the status section at the top of the implementation plan.
- [ ] Owner reviews the working-tree changes and asks for commits (one at a time).
- [ ] Decide T14 item 5 (money in naira/dollars), T13 (audit scripts into the repo), and Wave 3 with the co-worker.
- [ ] Talk to the co-worker (Toaster popup bug, file ownership), then `/gsd-discuss-phase 15` and `/gsd-plan-phase 15` with the merged list.
