/**
 * heals-system-rebuild — Heals Thai Massage POS
 * Task 3.10: Schema verification script.
 *
 * Smoke-tests that the database schema produced by migrations 001–005 is in
 * place by:
 *   1. Connecting with the service-role key (bypasses RLS so a missing table
 *      surfaces as a "relation does not exist" error rather than a silent
 *      empty result set).
 *   2. Probing every user table named in design.md §"Table Definitions"
 *      with `.select('*').limit(1)`. A 42P01 (undefined_table) error means
 *      the table is missing; any other error is reported but still flags
 *      the check as a failure.
 *   3. Probing the `write_transaction` RPC (migration 005) by issuing an
 *      intentionally-malformed call. A 42883 (undefined_function) error
 *      means the RPC is missing; any other error means the function exists
 *      and rejected the bad payload, which is what we want.
 *
 * Why this is a smoke test, not a deep schema audit:
 *   The Supabase JS client does not expose raw SQL execution, so we cannot
 *   directly query `information_schema.tables`, `pg_indexes`, `pg_policies`,
 *   or `pg_trigger` to assert each unique index, RLS policy, or audit
 *   trigger is in place. The migrations themselves (001_init_schema.sql,
 *   002_indexes.sql, 003_rls_policies.sql, 004_audit_trigger.sql,
 *   005_write_transaction_rpc.sql) are the source of truth for those
 *   structural details; this script verifies the migrations actually ran
 *   by confirming each downstream object is reachable through the public
 *   API surface. Running the migration set is what guarantees the
 *   indexes/policies/triggers exist; this script catches the case where a
 *   migration was never applied.
 *
 * Output:
 *   - One PASS/FAIL line per check.
 *   - A summary block with totals.
 *   - Exit code 0 when every check passes; exit code 1 on any failure.
 *
 * Run from `c:\BILL\app\` via:
 *   npm run verify:schema
 *
 * Or directly:
 *   npx tsx -r dotenv/config scripts/verify-schema.ts \
 *     dotenv_config_path=.env.local
 *
 * _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7_
 */

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
// Tables to verify (design.md §"Table Definitions" / migration 001)
// -----------------------------------------------------------------------------

const TABLES = [
  'profiles',
  'staff',
  'transactions',
  'expenses',
  'daily_roster',
  'commission_rates',
  'prices',
  'settings',
  'audit_log',
] as const

type CheckResult = {
  name: string
  ok: boolean
  detail: string
}

// -----------------------------------------------------------------------------
// Probes
// -----------------------------------------------------------------------------

async function checkTable(table: string): Promise<CheckResult> {
  // Service-role client sees through RLS, so an empty table returns []
  // (success) and a missing table returns a Postgres 42P01 error.
  const { error } = await sb.from(table).select('*').limit(1)
  if (!error) {
    return { name: `table.${table}`, ok: true, detail: 'queryable' }
  }
  // 42P01 = undefined_table. Anything else (e.g. 42501 permission denied)
  // is also a failure but we want the operator to see the real cause.
  const code = error.code ?? '<no-code>'
  const msg = error.message || String(error)
  return {
    name: `table.${table}`,
    ok: false,
    detail: code === '42P01' ? 'missing (42P01)' : `error ${code}: ${msg}`,
  }
}

async function checkWriteTransactionRpc(): Promise<CheckResult> {
  // The RPC requires a valid payload to actually persist a row; we send an
  // intentionally empty object so the call returns *some* error from inside
  // the function body (NOT NULL violation, type cast failure, etc.). The
  // failure mode we care about is 42883 (undefined_function), which only
  // fires when the function itself is missing.
  const { error } = await sb.rpc('write_transaction', { payload: {} })
  if (!error) {
    // Surprising but not a failure: the RPC returned cleanly. Treat as PASS.
    return {
      name: 'rpc.write_transaction',
      ok: true,
      detail: 'callable (returned ok)',
    }
  }
  const code = error.code ?? '<no-code>'
  if (code === '42883') {
    return {
      name: 'rpc.write_transaction',
      ok: false,
      detail: 'missing (42883)',
    }
  }
  // Any other error means the RPC exists and rejected the bogus payload,
  // which is exactly what we wanted to confirm.
  return {
    name: 'rpc.write_transaction',
    ok: true,
    detail: `callable (rejected probe with ${code})`,
  }
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`verifying schema against ${URL}`)
  console.log('')

  const results: CheckResult[] = []

  for (const table of TABLES) {
    results.push(await checkTable(table))
  }
  results.push(await checkWriteTransactionRpc())

  // Per-check lines.
  for (const r of results) {
    const tag = r.ok ? 'PASS' : 'FAIL'
    console.log(`  [${tag}] ${r.name.padEnd(28)} ${r.detail}`)
  }

  const passed = results.filter((r) => r.ok).length
  const failed = results.length - passed

  console.log('')
  console.log('=== schema verification ===')
  console.log(`  total  : ${results.length}`)
  console.log(`  passed : ${passed}`)
  console.log(`  failed : ${failed}`)

  if (failed > 0) {
    console.log('')
    console.log('Failures:')
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`  - ${r.name}: ${r.detail}`)
    }
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
