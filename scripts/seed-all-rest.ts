/**
 * heals-system-rebuild — Seed everything via Supabase REST.
 *
 * Runs all 5 seeds in order (prices, rates, settings, staff, users)
 * against the Supabase REST + Admin APIs using the service role key.
 * No direct DB connection needed — works against any hosted Supabase
 * project once the schema (tables) exists.
 *
 * Usage:
 *   npm run seed:all
 *
 * Env:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { spawnSync } from 'node:child_process'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(2)
}

const SEEDS = [
  ['prices', 'scripts/seed-prices.ts'],
  ['rates', 'scripts/seed-commission-rates.ts'],
  ['staff', 'scripts/seed-staff.ts'],
  ['settings', 'scripts/seed-settings.ts'],
  ['users', 'scripts/seed-users.ts'],
] as const

console.log(`Seeding all reference data into ${URL}`)
console.log('')

for (const [name, script] of SEEDS) {
  console.log(`>>> ${name}`)
  const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsx', script], {
    stdio: 'inherit',
    env: process.env,
  })
  if (r.status !== 0) {
    console.error(`Seed ${name} failed`)
    process.exit(1)
  }
  console.log('')
}

console.log('All seeds complete.')
