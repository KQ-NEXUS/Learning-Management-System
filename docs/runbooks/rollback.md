# Rollback runbook

How to undo a bad production deploy on Netlify. Read [deployment](deployment.md) first; it explains the migrations-first order this runbook relies on.

## Decide quickly

Roll back when a deploy makes a core path fail for many people (sign-in, lessons, checkout, grading, certificates) and a fix is not minutes away. Do not wait for a perfect diagnosis: publishing the previous deploy is fast and does not touch data.

Write down the time the problem started and the deploy ID that caused it. You need both for the incident record.

## Roll back the code

1. Open **Netlify > Deploys**.
2. Find the last deploy that worked (the one before the bad deploy).
3. Open it and choose **Publish deploy**. Netlify switches traffic to it within seconds. No rebuild is needed.
4. Check `GET /api/health` returns 200 with `{"status":"ok"}` and the uptime monitor is green.
5. Open **Operations status** (`/staff/operations`) and check nothing new is failing.
6. Lock auto-publishing (**Deploys > Lock to stop auto publishing**) until the fix is ready, so the next merge does not republish the bad code.

The previous deploy carries its own build of the scheduled functions, so the functions roll back with the site.

## Migrations are forward-only

Prisma migrations only move forward. There is no down migration, and none should be written in a hurry during an incident. So:

- If the bad deploy applied **no** migration, the code rollback above is complete.
- If it applied a migration that is **additive** (a new table, a new nullable column, a new index), the previous code keeps working against the new schema. Roll back the code and leave the schema as it is. The next fixed release builds on that schema.
- If it applied a migration the previous code **cannot run against** (a dropped or renamed column, a new NOT NULL column without a default that old code does not fill), rolling back the code alone will break the site. Choose one:
  1. **Roll forward**: ship a fix release that works with the new schema. Usually the safer choice.
  2. **Restore**: follow [restore](restore.md) to recover the database as it was before the migration, then publish the previous deploy. You lose writes made since the restore point, so this is a decision for the owner.

The rule in [deployment](deployment.md) "Before you deploy", step 3, exists so the third case does not happen: a breaking schema change is split across two releases.

Never edit the `_prisma_migrations` table by hand to "undo" a migration, and never run `prisma migrate reset` against production.

## People with open tabs

After any deploy or rollback, users who had the site open may see a failed button or form submit (the page in their browser refers to the build that was replaced) until they reload. Tell staff to reload before they report a fault. Keeping `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` stable across deploys reduces this, but a reload is still the fix.

## When to restore instead

Restore the database (see [restore](restore.md)) only when data itself is damaged or lost, for example:

- a migration or a bug deleted or overwrote rows;
- a script ran against production by mistake;
- the database cannot start or is corrupt.

A code rollback never fixes damaged data, and a restore always loses the writes made after the restore point. When in doubt, roll back the code first, stop the damage, then decide on a restore with the owner.

## After a rollback

1. Record the incident: start time, detection time, the bad deploy ID, the rollback time and who did it (see [incident and secrets](incident-and-secrets.md)).
2. Unlock auto-publishing only when the fix release has passed CI.
3. Re-run any scheduled job that may have failed during the incident (see [job recovery](job-recovery.md)).
