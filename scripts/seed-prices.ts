/**
 * heals-system-rebuild — Heals Thai Massage POS
 * Seed script for the `prices` table.
 *
 * Inserts a price row for every (course × duration × branch) cell defined
 * in the legacy price tables (see SYSTEM_SPEC.md §4.1, cashier.txt
 * `buildPriceTable`, and design.md). Bishop FR 60/90/120 are RM 2 cheaper
 * than Kimberry/Chulia (Req 2.7); Bishop matches Kimberry/Chulia on every
 * other cell, including FR 30.
 *
 * Idempotent: uses `.upsert(..., { onConflict: 'course,duration,branch' })`
 * so re-running updates existing rows in place. The `prices` table primary
 * key is `(course, duration, branch)`.
 *
 * Run from `c:\BILL\app\` via:
 *   npm run seed:prices
 *
 * Or directly:
 *   npx tsx -r dotenv/config scripts/seed-prices.ts \
 *     dotenv_config_path=.env.local
 *
 * _Requirements: 2.7, 6.1, 20.5_
 */

import { createClient } from '@supabase/supabase-js'
import { serverEnv } from '@/lib/env'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Branch = 'Kimberry' | 'Bishop' | 'Chulia'
type Course =
  | 'FR' | 'HS' | 'FNS' | 'BMT' | 'BAT' | 'DTM'
  | 'THC' | 'HOM' | 'PBA' | 'PBAC' | 'EAR'
  | 'PTF' | 'PAF' | 'PHL' | 'PHT'
type Duration = 30 | 60 | 90 | 120

interface PriceRow {
  course: Course
  duration: Duration
  branch: Branch
  price: number
}

interface CellByDuration {
  30?: number
  60?: number
  90?: number
  120?: number
}

// ---------------------------------------------------------------------------
// Legacy price data — Kimberry & Chulia share these values.
// Bishop matches except for FR 60/90/120 (RM 2 cheaper). FR 30 is the same.
// Source: SYSTEM_SPEC.md §4.1 + cashier.txt::buildPriceTable.
// ---------------------------------------------------------------------------

const KC_PRICES: Record<Course, CellByDuration> = {
  FR:   { 30: 40, 60: 70,  90: 100, 120: 135 },
  HS:   {         60: 85,  90: 120, 120: 160 },
  FNS:  {         60: 80,  90: 115, 120: 155 },
  BMT:  {         60: 80,  90: 115, 120: 155 },
  BAT:  {         60: 90,  90: 125, 120: 165 },
  DTM:  {         60: 98,  90: 140, 120: 183 },
  THC:  {         60: 110, 90: 165, 120: 215 },
  HOM:  {         60: 115, 90: 170, 120: 220 },
  PBA:  {                  90: 195, 120: 239 },
  PBAC: {                  90: 210, 120: 250 },
  EAR:  { 30: 45                            },
  PTF:  {                  90: 118, 120: 145 },
  PAF:  {                  90: 125, 120: 155 },
  PHL:  {                  90: 145, 120: 180 },
  PHT:  {         60: 145, 90: 205          },
}

const BISHOP_FR_DISCOUNT_DURATIONS: Duration[] = [60, 90, 120]
const BISHOP_FR_DISCOUNT = 2

function bishopPriceFor(course: Course, duration: Duration, kcPrice: number): number {
  if (course === 'FR' && BISHOP_FR_DISCOUNT_DURATIONS.includes(duration)) {
    return kcPrice - BISHOP_FR_DISCOUNT
  }
  return kcPrice
}

function buildAllRows(): PriceRow[] {
  const rows: PriceRow[] = []
  const branches: Branch[] = ['Kimberry', 'Bishop', 'Chulia']
  const durations: Duration[] = [30, 60, 90, 120]

  for (const course of Object.keys(KC_PRICES) as Course[]) {
    const cells = KC_PRICES[course]
    for (const dur of durations) {
      const kcPrice = cells[dur]
      if (kcPrice === undefined) continue
      for (const branch of branches) {
        const price =
          branch === 'Bishop' ? bishopPriceFor(course, dur, kcPrice) : kcPrice
        rows.push({ course, duration: dur, branch, price })
      }
    }
  }
  return rows
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const url = serverEnv.NEXT_PUBLIC_SUPABASE_URL
  const key = serverEnv.SUPABASE_SERVICE_ROLE_KEY

  const sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const rows = buildAllRows()
  console.log(`seeding prices: ${rows.length} rows total → ${url}`)

  // Pre-fetch existing rows so we can report inserts vs updates accurately.
  // The upsert call itself does not distinguish between the two.
  const { data: existing, error: fetchErr } = await sb
    .from('prices')
    .select('course, duration, branch')

  if (fetchErr) {
    console.error('Failed to read existing prices:', fetchErr.message)
    process.exit(1)
  }

  const existingKeys = new Set(
    (existing ?? []).map(
      (r: { course: string; duration: number; branch: string }) =>
        `${r.course}|${r.duration}|${r.branch}`,
    ),
  )

  let inserts = 0
  let updates = 0
  for (const r of rows) {
    if (existingKeys.has(`${r.course}|${r.duration}|${r.branch}`)) updates++
    else inserts++
  }

  const { error: upsertErr } = await sb
    .from('prices')
    .upsert(rows, {
      onConflict: 'course,duration,branch',
      ignoreDuplicates: false,
    })

  if (upsertErr) {
    console.error('Upsert failed:', upsertErr.message)
    process.exit(1)
  }

  console.log(
    `Seeded ${rows.length} prices (${inserts} new, ${updates} updated)`,
  )
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
