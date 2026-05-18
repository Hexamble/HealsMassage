# Heals Thai Massage POS — `salary-system-rebuild`

Next.js 14 + TypeScript + Supabase rebuild of the Heals Thai Massage point-of-sale system that powers three Kuala Lumpur branches (Kimberry, Bishop, Chulia). Replaces the legacy Google Sheets + Apps Script setup with a single source of truth in `transactions`, idempotent writes, and a fair-rotation queue board.

This subproject lives at `c:\BILL\app\`. All commands below should be run from a PowerShell window opened in that folder.

**Where things live**

- `c:\BILL\app\src\app\` — Next.js routes (cashier, owner dashboard, auth)
- `c:\BILL\app\src\domain\` — pure business logic (commission, business-date, EXTRA fallback, salary, queue)
- `c:\BILL\app\src\lib\` — shared utilities (Supabase clients, zod schemas, offline queue)
- `c:\BILL\app\supabase\migrations\` — SQL schema, RLS policies, seed data
- `c:\BILL\app\tests\integration\` — integration tests that talk to the local Supabase stack

## Setup

Install dependencies once after cloning, and any time `package.json` changes.

```powershell
cd c:\BILL\app
npm install
```

## Run dev

Boots the Next.js dev server. Open http://localhost:3000 in your browser; the page hot-reloads on save.

```powershell
cd c:\BILL\app
npm run dev
```

## Run tests

The full suite plus the focused subsets used during development. Run all of these green before deploying.

```powershell
cd c:\BILL\app
npm test
npm run test:domain
npm run test:integration
npm run test:property
npm run typecheck
```

## Run local Supabase

Spins up a local Postgres + Auth + Realtime stack on Docker. The Studio UI is at http://localhost:54323. Use `db reset` to re-apply every migration from scratch.

```powershell
cd c:\BILL\app
supabase start
supabase status
supabase db reset
supabase stop
```

## Migrate legacy CSV

Imports a `transactions_log.csv` exported from the legacy Apps Script system. Idempotent — re-running on the same file is a no-op. Replace the path with the actual CSV location.

```powershell
cd c:\BILL\app
npm run migrate -- --from C:\path\to\transactions-log.csv
```

## Deploy

Deploys the production build to Vercel. Make sure all tests above are green and the env vars in the Vercel project (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) point at the production Supabase project.

```powershell
cd c:\BILL\app
vercel --prod
```
## Soft-launch checklist

Run through these steps before moving any branch off the legacy Apps Script. Each step must be confirmed by the owner before the next branch is cut over.

1. Run the migration tool against the legacy CSV (production Supabase project) and confirm row counts match the export.
2. Diff check: compare per-staff cycle totals against the legacy salary board for the most recent closed cycle. Investigate any mismatch before proceeding.
3. Issue cashier accounts for each branch (Kimberry, Bishop, Chulia) and verify each one can only see its own branch.
4. Issue the `boss_view` account for read-only auditing and confirm it cannot write transactions or expenses.
5. Disable or archive the legacy Apps Script after seven days of parallel running with no diffs.

**Smoke test (record on each deploy):**

- Date: 2026-05-18
- Production URL: https://app-seven-phi-65.vercel.app (alias) — deployment `https://app-mozn9xn0b-jengladchado-6399s-projects.vercel.app`
- Build: succeeded (`vercel --prod --yes`, ready in 53 s)
- HTTP `/`: 307 → `/auth/sign-in` (expected redirect for unauthenticated users)
- HTTP `/auth/sign-in`: 200
- Hosted Supabase: `https://cpbvqxbyicbplsacmfad.supabase.co` — Epic 21 migrations pushed (drop_freelance_method, customer_balm, freelance_rates, daily_snapshots)
- Owner account seeded: `bill@heals.local` (password `heals1234`)
- Cashier account seeded: `cashier-kimberry@heals.local` (password `heals1234`, branch Kimberry)
- Kimberry staff roster: 1 active staff (`Beer`) — enough for the smoke session
- Epic 21 features deployed:
  - Freelance method removed from enum; freelance inferred from staff row.
  - `customer_balm` column on transactions (+10 suggested price, no commission).
  - `freelance_rates` table — owner-editable per (course, duration).
  - `daily_snapshots` table + `pg_cron` schedule (01:21 UTC) + manual re-snapshot action.
  - Salary board balm sub-rows (base / balm / total breakdown per staff per cycle).
