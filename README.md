This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## File storage and scheduled maintenance

- Production files live in a private Cloudflare R2 bucket (MinIO in local Docker).
- Authorized browsers upload with short-lived presigned `PUT` URLs straight to storage; downloads use short-lived presigned `GET` URLs.
- The application verifies and finalizes each upload before it becomes available — nothing is scanned.
- Netlify Scheduled Functions release expired seat holds (`release-expired-holds`, every 5 minutes) and clean abandoned uploads (`cleanup-stale-uploads`, hourly).
- Configure R2 CORS for the production site and `http://localhost:3000`; no ClamAV variables or worker process are required.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Multi-gateway payments (Paystack + Stripe Connect)

- NGN checkout routes to Paystack; USD checkout routes to Stripe — fixed server-side, never chosen by the client.
- Deployment-managed secrets (never exposed in the browser, exports, or any staff UI — read only through `src/server/payments/settlement-config.ts` and `src/server/payments/providers/stripe/client.ts`):
  - `PAYSTACK_SECRET_KEY` — Paystack Dashboard → Settings → API Keys & Webhooks → Secret Key.
  - `PAYSTACK_SUBACCOUNT_CODE` — Paystack Dashboard → Settings → Subaccounts → the school's subaccount (`ACCT_...`). Created outside this app; the app only ever reads it.
  - `STRIPE_CONNECTED_ACCOUNT_ID` — Stripe Dashboard → Connect → Accounts → the school's onboarded connected account (`acct_...`). Also created outside this app.
  - `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` — the platform account's own Stripe keys (unchanged from the original Stripe-only checkout).
- Register both provider webhooks so settlement events reach this deployment:
  - Paystack: Dashboard → Settings → API Keys & Webhooks → Webhook URL → `{BASE_URL}/api/webhooks/paystack`.
  - Stripe: Dashboard → Developers → Webhooks → Add endpoint → `{BASE_URL}/api/webhooks/stripe`.
- A Netlify Scheduled Function, `reconcile-payments` (every 15 minutes), sweeps settled payments and records each provider's actual settlement evidence against the platform's own expected snapshot, flagging a variance for Finance when the two disagree.
- Gateway fee schedules (the percentage/fixed/cap rates used to estimate the learner-paid processing fee) are seeded, versioned rows — see `prisma/seed.ts`. The seeded rates are worked examples, not a deployment's actual negotiated rates; a real deployment should insert its own `GatewayFeeSchedule` rows with its own effective-dated rates rather than editing the seed defaults in place.
- The legacy single-price `Cohort.priceMinor`/`currency` columns are currently deprecated but still present in the schema — Phase 7 migrated every Cohort to the dual `priceNgnMinor`/`priceUsdMinor` columns and no application code reads the legacy pair anymore (enforced by a build-time check in `tests/checkout-phase-invariants.test.ts`). Dropping the legacy columns was deliberately deferred; see that phase's planning notes before removing them.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
