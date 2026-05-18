// heals-system-rebuild — Heals Thai Massage POS
// Task 3.9: Seed `settings` table with the two app-config keys the rest
// of the system reads at boot.
//
// Keys seeded:
//   - `pay_cycle_start_day` — integer 1..28 controlling the start day of
//     each pay cycle. Default 21 per Req 10.3.
//   - `branch_themes` — JSON map of per-branch theme tokens (primary +
//     accent hex colors) consumed by `src/lib/theming.ts`. Per Req 19:
//       Kimberry = teal, Bishop = gold, Chulia = coral.
//
// Idempotent: uses `.upsert(..., { onConflict: 'key' })` so re-running
// updates the existing row instead of erroring.
//
// Run from `c:\BILL\app\` via:
//   npm run seed:settings
// or directly:
//   npx tsx -r dotenv/config scripts/seed-settings.ts dotenv_config_path=.env.local

import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!URL || !KEY) {
  console.error(
    'Missing env. Source .env.local (or .env.production.local) with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
  )
  process.exit(2)
}

const sb = createClient(URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// -----------------------------------------------------------------------------
// Values
// -----------------------------------------------------------------------------

// Req 10.3 — default pay cycle start day.
const PAY_CYCLE_START_DAY = 21

// Req 19.1–19.3 — per-branch theme tokens. Stored as a single JSON map so the
// owner can update the whole theme block atomically via setTheme.
//   Kimberry = teal/green, Bishop = gold/amber, Chulia = coral/rose.
const BRANCH_THEMES = {
  Kimberry: { primary: '#0d9488', accent: '#14b8a6' },
  Bishop: { primary: '#d97706', accent: '#f59e0b' },
  Chulia: { primary: '#f43f5e', accent: '#fb7185' },
} as const

// -----------------------------------------------------------------------------
// Upsert helpers
// -----------------------------------------------------------------------------

interface SettingRow {
  key: string
  value: unknown
}

async function upsertSetting(row: SettingRow): Promise<void> {
  const { error } = await sb
    .from('settings')
    .upsert(
      { key: row.key, value: row.value, updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    )
  if (error) {
    throw new Error(`upsert settings[${row.key}] failed: ${error.message}`)
  }
  console.log(`upserted settings.${row.key}`)
}

async function main(): Promise<void> {
  console.log(`seeding settings into ${URL}`)

  await upsertSetting({ key: 'pay_cycle_start_day', value: PAY_CYCLE_START_DAY })
  await upsertSetting({ key: 'branch_themes', value: BRANCH_THEMES })

  console.log('')
  console.log('=== settings seeded ===')
  console.log(`  pay_cycle_start_day = ${PAY_CYCLE_START_DAY}`)
  console.log(`  branch_themes       = ${JSON.stringify(BRANCH_THEMES)}`)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
