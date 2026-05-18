// heals-system-rebuild — Heals Thai Massage POS
// Task 3.11: Post-seed verification script.
//
// Connects with the service-role client and asserts that the four
// configuration tables are populated to the minimum thresholds the rest
// of the system relies on:
//
//   prices            > 100 rows  (3 branches × ~38 priced cells)
//   commission_rates  >  50 rows  (regular + freelance × priced cells)
//   staff             >   5 rows  (starter roster across 3 branches)
//   settings          >=  2 rows  (pay_cycle_start_day + branch_themes)
//
// For `settings` we also check the two specific keys are present (Reqs
// 10.3, 19.x) since "two arbitrary rows" would not actually unblock the
// app at boot.
//
// Output is one line per table: `PASS` / `FAIL` plus the observed count.
// Exit code is 0 only when every check passes; otherwise 1, so this
// script can gate a deploy step or post-migration smoke test.
//
// Run from `c:\BILL\app\` via:
//   npm run verify:seed
// or directly:
//   npx tsx -r dotenv/config scripts/verify-seed.ts dotenv_config_path=.env.local
//
// _Requirements: 6.1, 10.3, 14.1, 20.5, 20.6_

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!URL || !KEY) {
  console.error(
    'Missing env. Source .env.local (or .env.production.local) with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
  )
  process.exit(2)
}

const sb: SupabaseClient = createClient(URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// -----------------------------------------------------------------------------
// Check definitions
// -----------------------------------------------------------------------------

interface CheckResult {
  table: string
  count: number
  threshold: string
  passed: boolean
  detail?: string
}

async function countRows(table: string): Promise<number> {
  const { count, error } = await sb
    .from(table)
    .select('*', { count: 'exact', head: true })
  if (error) {
    throw new Error(`count ${table} failed: ${error.message}`)
  }
  return count ?? 0
}

async function checkPrices(): Promise<CheckResult> {
  const count = await countRows('prices')
  return {
    table: 'prices',
    count,
    threshold: '> 100',
    passed: count > 100,
  }
}

async function checkCommissionRates(): Promise<CheckResult> {
  const count = await countRows('commission_rates')
  return {
    table: 'commission_rates',
    count,
    threshold: '> 50',
    passed: count > 50,
  }
}

async function checkStaff(): Promise<CheckResult> {
  const count = await countRows('staff')
  return {
    table: 'staff',
    count,
    threshold: '> 5',
    passed: count > 5,
  }
}

async function checkSettings(): Promise<CheckResult> {
  // settings is a tiny key/value table; count is cheap and we additionally
  // verify the two specific keys the app reads at boot (Reqs 10.3, 19.x).
  const count = await countRows('settings')

  const { data, error } = await sb
    .from('settings')
    .select('key')
    .in('key', ['pay_cycle_start_day', 'branch_themes'])
  if (error) {
    throw new Error(`select settings keys failed: ${error.message}`)
  }
  const keys = new Set((data ?? []).map((r: { key: string }) => r.key))
  const missing = ['pay_cycle_start_day', 'branch_themes'].filter(
    (k) => !keys.has(k),
  )

  return {
    table: 'settings',
    count,
    threshold: '>= 2 (incl. pay_cycle_start_day, branch_themes)',
    passed: count >= 2 && missing.length === 0,
    detail: missing.length ? `missing keys: ${missing.join(', ')}` : undefined,
  }
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`verifying seed data in ${URL}`)
  console.log('')

  const checks: CheckResult[] = [
    await checkPrices(),
    await checkCommissionRates(),
    await checkStaff(),
    await checkSettings(),
  ]

  const tableW = Math.max(...checks.map((c) => c.table.length))
  for (const c of checks) {
    const status = c.passed ? 'PASS' : 'FAIL'
    const line =
      `  ${status}  ${c.table.padEnd(tableW)}  ` +
      `count=${String(c.count).padStart(4)}  expected ${c.threshold}`
    console.log(line)
    if (c.detail) console.log(`         ${c.detail}`)
  }

  const failed = checks.filter((c) => !c.passed)
  console.log('')
  if (failed.length === 0) {
    console.log(`=== verify-seed: PASS (${checks.length}/${checks.length}) ===`)
    process.exit(0)
  } else {
    console.log(
      `=== verify-seed: FAIL (${failed.length}/${checks.length} failed: ${failed
        .map((c) => c.table)
        .join(', ')}) ===`,
    )
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
