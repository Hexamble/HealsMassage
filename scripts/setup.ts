/**
 * heals-system-rebuild — One-shot setup script.
 *
 * Bootstraps a fresh Supabase project end-to-end:
 *   1. Applies migrations 001-005 in order via the service-role client.
 *   2. Runs the four reference-data seeds (prices, rates, settings, staff).
 *   3. Creates the four default Auth users + linked profiles.
 *   4. Runs verify-schema and verify-seed as a smoke test.
 *
 * One command — `npm run setup` — and the DB is ready.
 *
 * Idempotent: every step uses ON CONFLICT or pre-existence checks, so
 * re-running is safe.
 *
 * Required env (in `.env.local`):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Optional:
 *   OWNER_EMAIL / OWNER_PASSWORD  + per-cashier overrides (see seed-users.ts)
 *
 * IMPORTANT: applying SQL through the Supabase REST + service-role
 * route requires the `pg-meta` RPC. Standard Supabase projects have a
 * `query` RPC for arbitrary SQL but it's only available in the
 * dashboard, not via the API. So this script uses a Postgres client
 * (`postgres` npm package) connecting directly to the database.
 *
 * Connection string is built from the SUPABASE_URL: project ref
 * extracted from the host, password is SUPABASE_SERVICE_ROLE_KEY.
 *
 * Wait — that won't work either; service role key isn't the postgres
 * password. The only reliable cross-environment paths are:
 *   (a) `psql` against the connection string the user pastes in (local
 *       Supabase: `postgres://postgres:postgres@127.0.0.1:54322/postgres`,
 *       hosted: from the dashboard's Connection Settings → URI).
 *   (b) the supabase CLI (`supabase db push`), if installed.
 *
 * So this script delegates SQL execution to whichever option the user
 * has available, and prints clear instructions when neither is found.
 * The seeds + users still run via the JS Supabase client (those are
 * REST-API operations).
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const DB_URL = process.env.SUPABASE_DB_URL // postgres connection string

if (!URL || !KEY) {
  console.error(
    'Missing env. Source .env.local with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
  )
  process.exit(2)
}

// ---------------------------------------------------------------------------
// Migration application
// ---------------------------------------------------------------------------

const MIGRATIONS = [
  '001_init_schema.sql',
  '002_indexes.sql',
  '003_rls_policies.sql',
  '004_audit_trigger.sql',
  '005_write_transaction_rpc.sql',
] as const

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations')

function which(cmd: string): boolean {
  // Cross-platform "is the command available" check.
  const probe = spawnSync(
    process.platform === 'win32' ? 'where' : 'which',
    [cmd],
    { stdio: 'ignore' },
  )
  return probe.status === 0
}

function tryApplyMigrationsViaPsql(): boolean {
  if (!DB_URL) {
    console.warn(
      '  SUPABASE_DB_URL not set — skipping psql migration path.',
    )
    return false
  }
  if (!which('psql')) {
    console.warn(
      '  psql command not found — skipping psql migration path.',
    )
    return false
  }
  console.log('  Applying migrations via psql…')
  for (const file of MIGRATIONS) {
    const path = join(MIGRATIONS_DIR, file)
    if (!existsSync(path)) {
      console.error(`  Missing migration file: ${path}`)
      return false
    }
    const sql = readFileSync(path, 'utf-8')
    const result = spawnSync('psql', [DB_URL, '-v', 'ON_ERROR_STOP=1'], {
      input: sql,
      encoding: 'utf-8',
    })
    if (result.status !== 0) {
      console.error(`  Migration ${file} failed:`)
      console.error(result.stderr)
      return false
    }
    console.log(`    ✓ ${file}`)
  }
  return true
}

function tryApplyMigrationsViaSupabaseCli(): boolean {
  if (!which('supabase')) {
    console.warn(
      '  supabase CLI not found — skipping supabase-cli migration path.',
    )
    return false
  }
  console.log('  Applying migrations via supabase CLI…')
  const result = spawnSync('supabase', ['db', 'push', '--db-url', DB_URL ?? ''], {
    stdio: 'inherit',
  })
  return result.status === 0
}

function printManualMigrationInstructions(): void {
  console.log('')
  console.log('=================================================================')
  console.log('Could not apply migrations automatically.')
  console.log('Pick ONE of the following options:')
  console.log('')
  console.log('  Option A: install psql (PostgreSQL client) and set SUPABASE_DB_URL')
  console.log('    - Hosted Supabase: dashboard → Project Settings → Database')
  console.log('      → Connection string → URI. Copy that into .env.local as')
  console.log('      SUPABASE_DB_URL=postgres://postgres:[YOUR-PASSWORD]@…')
  console.log('    - Local Supabase (`supabase start`):')
  console.log('      SUPABASE_DB_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres')
  console.log('    Then re-run: npm run setup')
  console.log('')
  console.log('  Option B: install Supabase CLI (`npm i -g supabase`) and re-run')
  console.log('    npm run setup')
  console.log('')
  console.log('  Option C: paste each migration SQL file into the Supabase')
  console.log('    dashboard → SQL Editor manually, in order:')
  for (const file of MIGRATIONS) {
    console.log(`      - app/supabase/migrations/${file}`)
  }
  console.log('    Then re-run: npm run setup')
  console.log('=================================================================')
  console.log('')
}

// ---------------------------------------------------------------------------
// Seed runners (delegate to existing scripts)
// ---------------------------------------------------------------------------

const SEEDS = [
  { name: 'prices', script: 'scripts/seed-prices.ts' },
  { name: 'rates', script: 'scripts/seed-commission-rates.ts' },
  { name: 'staff', script: 'scripts/seed-staff.ts' },
  { name: 'settings', script: 'scripts/seed-settings.ts' },
  { name: 'users', script: 'scripts/seed-users.ts' },
] as const

function runSeed(name: string, script: string): boolean {
  console.log(`  Running ${name} seed…`)
  // tsx must already be installed (devDep). Pass dotenv path through env
  // since spawnSync doesn't inherit the .env.local loader by default.
  const result = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['tsx', '-r', 'dotenv/config', script, 'dotenv_config_path=.env.local'],
    { stdio: 'inherit' },
  )
  if (result.status !== 0) {
    console.error(`  ${name} seed failed.`)
    return false
  }
  return true
}

function runVerify(name: string, script: string): boolean {
  console.log(`  Verifying ${name}…`)
  const result = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['tsx', '-r', 'dotenv/config', script, 'dotenv_config_path=.env.local'],
    { stdio: 'inherit' },
  )
  return result.status === 0
}

// ---------------------------------------------------------------------------
// Pre-flight: can we even reach Supabase?
// ---------------------------------------------------------------------------

async function preflight(): Promise<boolean> {
  console.log('Pre-flight check: connecting to Supabase…')
  const sb = createClient(URL!, KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await sb.from('non_existent_smoke_test').select('*').limit(1)
  // We expect a 42P01 (relation does not exist). Any 401/403 means our
  // service-role key is wrong; any network error means URL is wrong.
  if (error && error.code === '42P01') {
    console.log(`  ✓ Connected to ${URL}`)
    return true
  }
  if (error) {
    if (error.code === '404' || error.message.includes('not found')) {
      console.log(`  ✓ Connected to ${URL} (table not found is expected)`)
      return true
    }
    console.error(`  ✗ Connection check failed: ${error.message}`)
    return false
  }
  console.log(`  ✓ Connected to ${URL}`)
  return true
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('=== Heals POS — One-shot setup ===')
  console.log(`Supabase URL: ${URL}`)
  console.log('')

  const ok = await preflight()
  if (!ok) {
    console.error('Pre-flight failed. Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')
    process.exit(1)
  }

  // STEP 1: migrations.
  console.log('Step 1/4: applying migrations…')
  let migrated = tryApplyMigrationsViaSupabaseCli()
  if (!migrated) {
    migrated = tryApplyMigrationsViaPsql()
  }
  if (!migrated) {
    printManualMigrationInstructions()
    process.exit(1)
  }
  console.log('  All migrations applied.')
  console.log('')

  // STEP 2: data seeds.
  console.log('Step 2/4: seeding reference data…')
  for (const seed of SEEDS) {
    if (!runSeed(seed.name, seed.script)) {
      process.exit(1)
    }
  }
  console.log('  All seeds completed.')
  console.log('')

  // STEP 3: verify schema + seed.
  console.log('Step 3/4: verifying schema + seed…')
  if (!runVerify('schema', 'scripts/verify-schema.ts')) {
    console.error('  Schema verification failed.')
    process.exit(1)
  }
  if (!runVerify('seed', 'scripts/verify-seed.ts')) {
    console.error('  Seed verification failed.')
    process.exit(1)
  }
  console.log('  All verifications passed.')
  console.log('')

  // STEP 4: print follow-ups.
  console.log('Step 4/4: ready to roll.')
  console.log('')
  console.log('Next steps:')
  console.log('  1. Start the dev server:    npm run dev')
  console.log('  2. Open the sign-in page:   http://localhost:3100/auth/sign-in')
  console.log('  3. Default credentials:')
  console.log('       Owner:    owner@heals.local / changeme')
  console.log('       Cashier:  cashier.kimberry@heals.local / changeme')
  console.log('                 cashier.bishop@heals.local   / changeme')
  console.log('                 cashier.chulia@heals.local   / changeme')
  console.log('     Change passwords IMMEDIATELY after first sign-in.')
  console.log('')
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
