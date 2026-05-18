/**
 * heals-system-rebuild — Heals Thai Massage POS
 * Seed script for the `commission_rates` table.
 *
 * Inserts the regular and freelance commission rate rows that the rest of
 * the system reads when computing payouts (see `src/domain/commission.ts`,
 * design.md §"commission_rates", and Reqs 6.1, 6.5, 6.6, 18.4, 18.5,
 * 20.5).
 *
 * Branch grouping
 * ---------------
 * `branch_group = 'all'` is the only group seeded. The Bishop freelance FR
 * floor at RM 0 (Reqs 6.6 / 18.4) is enforced at *compute time* by the
 * commission domain logic; we only persist the Kimberry/Chulia base values
 * here so a single source-of-truth row covers every branch.
 *
 * Rate cards (round-number defaults — owner edits in-app later)
 * -------------------------------------------------------------
 * The numbers below are sensible starting values. The owner can update
 * them via the rate-management actions which insert a new row with a
 * later `effective_from` (see Req 6.7, Task 7.10).
 *
 * Idempotency
 * -----------
 * Uses `.upsert(..., { onConflict: 'course,duration,rate_type,branch_group,effective_from' })`
 * so re-running the script on the same day updates the existing row
 * rather than erroring. The matching UNIQUE index is created in
 * `002_indexes.sql` (`commission_rates_lookup_uidx`).
 *
 * Run from `c:\BILL\app\` via:
 *   npm run seed:rates
 *
 * Or directly:
 *   npx tsx -r dotenv/config scripts/seed-commission-rates.ts \
 *     dotenv_config_path=.env.local
 *
 * _Requirements: 6.1, 6.5, 6.6, 18.4, 18.5, 20.5_
 */

import { createClient } from '@supabase/supabase-js'
import { serverEnv } from '@/lib/env'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Course =
  | 'FR' | 'HS' | 'FNS' | 'BMT' | 'BAT' | 'DTM'
  | 'THC' | 'HOM' | 'PBA' | 'PBAC' | 'EAR'
  | 'PTF' | 'PAF' | 'PHL' | 'PHT'
type Duration = 30 | 60 | 90 | 120
type RateType = 'regular' | 'freelance'

interface RateRow {
  course: Course
  duration: Duration
  rate_type: RateType
  branch_group: 'all'
  amount: number
  effective_from: string // ISO date (YYYY-MM-DD)
}

interface CellByDuration {
  30?: number
  60?: number
  90?: number
  120?: number
}

// ---------------------------------------------------------------------------
// Rate cards
// ---------------------------------------------------------------------------
//
// Cells follow the same (course × duration) shape as the price table in
// seed-prices.ts so every priced cell gets a matching commission rate.
// Freelance ≈ 1.5× regular, rounded to whole RM.
//
//   FR (30/60/90/120)
//   HS,FNS,BMT,BAT,DTM,THC,HOM (60/90/120)
//   PBA,PBAC,PTF,PAF,PHL (90/120)   — premium courses
//   PHT (60/90)
//   EAR (30)                        — 30-minute add-on, treated like FR 30
//
// ---------------------------------------------------------------------------

const REGULAR_RATES: Record<Course, CellByDuration> = {
  FR:   { 30: 12, 60: 23, 90: 31,  120: 40  },
  HS:   {         60: 26, 90: 35,  120: 45  },
  FNS:  {         60: 26, 90: 35,  120: 45  },
  BMT:  {         60: 26, 90: 35,  120: 45  },
  BAT:  {         60: 28, 90: 38,  120: 48  },
  DTM:  {         60: 30, 90: 42,  120: 55  },
  THC:  {         60: 35, 90: 50,  120: 65  },
  HOM:  {         60: 36, 90: 52,  120: 66  },
  PBA:  {                 90: 60,  120: 75  },
  PBAC: {                 90: 65,  120: 78  },
  EAR:  { 30: 12                            },
  PTF:  {                 90: 36,  120: 45  },
  PAF:  {                 90: 38,  120: 48  },
  PHL:  {                 90: 45,  120: 56  },
  PHT:  {         60: 45, 90: 64           },
}

const FREELANCE_RATES: Record<Course, CellByDuration> = {
  FR:   { 30: 18, 60: 35, 90: 47,  120: 60  },
  HS:   {         60: 39, 90: 53,  120: 68  },
  FNS:  {         60: 39, 90: 53,  120: 68  },
  BMT:  {         60: 39, 90: 53,  120: 68  },
  BAT:  {         60: 42, 90: 57,  120: 72  },
  DTM:  {         60: 45, 90: 63,  120: 83  },
  THC:  {         60: 53, 90: 75,  120: 98  },
  HOM:  {         60: 54, 90: 78,  120: 99  },
  PBA:  {                 90: 90,  120: 113 },
  PBAC: {                 90: 98,  120: 117 },
  EAR:  { 30: 18                            },
  PTF:  {                 90: 54,  120: 68  },
  PAF:  {                 90: 57,  120: 72  },
  PHL:  {                 90: 68,  120: 84  },
  PHT:  {         60: 68, 90: 96           },
}

// ---------------------------------------------------------------------------
// Row builder
// ---------------------------------------------------------------------------

function todayIso(): string {
  // YYYY-MM-DD in local time. Matches the DATE column shape exactly.
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function buildAllRows(): RateRow[] {
  const rows: RateRow[] = []
  const effectiveFrom = todayIso()
  const durations: Duration[] = [30, 60, 90, 120]

  const tables: Array<[RateType, Record<Course, CellByDuration>]> = [
    ['regular', REGULAR_RATES],
    ['freelance', FREELANCE_RATES],
  ]

  for (const [rateType, table] of tables) {
    for (const course of Object.keys(table) as Course[]) {
      const cells = table[course]
      for (const dur of durations) {
        const amount = cells[dur]
        if (amount === undefined) continue
        rows.push({
          course,
          duration: dur,
          rate_type: rateType,
          branch_group: 'all',
          amount,
          effective_from: effectiveFrom,
        })
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
  const effectiveFrom = rows[0]?.effective_from ?? todayIso()
  console.log(
    `seeding commission_rates: ${rows.length} rows ` +
      `(effective_from=${effectiveFrom}) → ${url}`,
  )

  // Pre-fetch existing rows for today so we can report inserts vs updates.
  // The upsert call itself does not distinguish between the two.
  const { data: existing, error: fetchErr } = await sb
    .from('commission_rates')
    .select('course, duration, rate_type, branch_group, effective_from')
    .eq('effective_from', effectiveFrom)

  if (fetchErr) {
    console.error('Failed to read existing commission_rates:', fetchErr.message)
    process.exit(1)
  }

  const existingKeys = new Set(
    (existing ?? []).map(
      (r: {
        course: string
        duration: number
        rate_type: string
        branch_group: string
        effective_from: string
      }) =>
        `${r.course}|${r.duration}|${r.rate_type}|${r.branch_group}|${r.effective_from}`,
    ),
  )

  let inserts = 0
  let updates = 0
  let regular = 0
  let freelance = 0
  for (const r of rows) {
    const k = `${r.course}|${r.duration}|${r.rate_type}|${r.branch_group}|${r.effective_from}`
    if (existingKeys.has(k)) updates++
    else inserts++
    if (r.rate_type === 'regular') regular++
    else freelance++
  }

  const { error: upsertErr } = await sb
    .from('commission_rates')
    .upsert(rows, {
      onConflict: 'course,duration,rate_type,branch_group,effective_from',
      ignoreDuplicates: false,
    })

  if (upsertErr) {
    console.error('Upsert failed:', upsertErr.message)
    process.exit(1)
  }

  console.log('')
  console.log('=== commission_rates seeded ===')
  console.log(`  total          ${rows.length}`)
  console.log(`  regular        ${regular}`)
  console.log(`  freelance      ${freelance}`)
  console.log(`  inserts        ${inserts}`)
  console.log(`  updates        ${updates}`)
  console.log(`  effective_from ${effectiveFrom}`)
  console.log(`  branch_group   all (Bishop FR floor enforced at compute time)`)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
