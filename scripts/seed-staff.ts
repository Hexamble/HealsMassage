// heals-system-rebuild — Heals Thai Massage POS
// Task 3.8: Seed `staff` table with the active company roster.
//
// Each staff row is keyed by case-insensitive normalized name. Migration
// 002 creates `staff_name_normalized_uidx` as a UNIQUE functional index on
// `lower(trim(name))` (Req 20.4). The Supabase JS client cannot target a
// functional index in `.upsert(... { onConflict })` — `onConflict` must
// name a literal column or constraint, and there is no constraint here,
// only a functional index. We therefore implement idempotency in
// application code via a case-insensitive SELECT (`ilike`) followed by an
// `INSERT` or `UPDATE`. Same pattern as `seed-test-accounts.ts`. This is
// safe under the unique index because each staff is processed serially
// and the script is the only writer during a seed run. If two seeds race
// (they should not), the index still rejects duplicate inserts at the DB
// level.
//
// Seeded roster (starter set per spec instructions):
//   Kimberry  : Beer, Aom, Lin, Nan       (regular)
//   Bishop    : Pra, May, Ney             (regular)
//   Chulia    : Nana, Mint, Pim           (regular)
//   Freelance : Freelance A (Kimberry), Freelance B (Bishop)
//
// All rows are inserted with is_active=true. The owner can edit assignments
// later from `/app/owner/roster`.
//
// Run from `c:\BILL\app\` via:
//   npm run seed:staff
// or directly:
//   npx tsx -r dotenv/config scripts/seed-staff.ts dotenv_config_path=.env.local

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
// Roster definition
// -----------------------------------------------------------------------------

type Branch = 'Kimberry' | 'Bishop' | 'Chulia'

interface StaffSpec {
  name: string
  homeBranch: Branch
  isFreelance: boolean
}

// Req 14.1, 14.2 — every active staff has a home_branch and is_freelance flag.
const STAFF: StaffSpec[] = [
  // Kimberry (regular)
  { name: 'Beer', homeBranch: 'Kimberry', isFreelance: false },
  { name: 'Aom', homeBranch: 'Kimberry', isFreelance: false },
  { name: 'Lin', homeBranch: 'Kimberry', isFreelance: false },
  { name: 'Nan', homeBranch: 'Kimberry', isFreelance: false },
  // Bishop (regular)
  { name: 'Pra', homeBranch: 'Bishop', isFreelance: false },
  { name: 'May', homeBranch: 'Bishop', isFreelance: false },
  { name: 'Ney', homeBranch: 'Bishop', isFreelance: false },
  // Chulia (regular)
  { name: 'Nana', homeBranch: 'Chulia', isFreelance: false },
  { name: 'Mint', homeBranch: 'Chulia', isFreelance: false },
  { name: 'Pim', homeBranch: 'Chulia', isFreelance: false },
  // Freelance roster
  { name: 'Freelance A', homeBranch: 'Kimberry', isFreelance: true },
  { name: 'Freelance B', homeBranch: 'Bishop', isFreelance: true },
]

// -----------------------------------------------------------------------------
// Idempotent upsert (case-insensitive)
// -----------------------------------------------------------------------------

async function upsertStaff(s: StaffSpec): Promise<'inserted' | 'updated'> {
  // Case-insensitive lookup against the existing row, if any. ilike matches
  // by pattern; for an exact case-insensitive match we pass the raw name
  // with no wildcards.
  const { data: existing, error: selErr } = await sb
    .from('staff')
    .select('id')
    .ilike('name', s.name)
    .maybeSingle()
  if (selErr) {
    throw new Error(`select staff[${s.name}] failed: ${selErr.message}`)
  }

  if (existing) {
    const { error } = await sb
      .from('staff')
      .update({
        home_branch: s.homeBranch,
        is_freelance: s.isFreelance,
        is_active: true,
      })
      .eq('id', existing.id)
    if (error) {
      throw new Error(`update staff[${s.name}] failed: ${error.message}`)
    }
    return 'updated'
  }

  const { error } = await sb.from('staff').insert({
    name: s.name,
    home_branch: s.homeBranch,
    is_freelance: s.isFreelance,
    is_active: true,
  })
  if (error) {
    throw new Error(`insert staff[${s.name}] failed: ${error.message}`)
  }
  return 'inserted'
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`seeding staff into ${URL}`)

  let inserted = 0
  let updated = 0
  for (const s of STAFF) {
    const result = await upsertStaff(s)
    if (result === 'inserted') inserted++
    else updated++
    console.log(
      `  ${result === 'inserted' ? '+' : '~'} ${s.name.padEnd(14)} home=${s.homeBranch.padEnd(8)} freelance=${s.isFreelance}`,
    )
  }

  console.log('')
  console.log('=== staff seeded ===')
  console.log(`  total      : ${STAFF.length}`)
  console.log(`  inserted   : ${inserted}`)
  console.log(`  updated    : ${updated}`)
  console.log(`  by branch  :`)
  for (const branch of ['Kimberry', 'Bishop', 'Chulia'] as Branch[]) {
    const list = STAFF.filter((s) => s.homeBranch === branch)
    console.log(`    ${branch.padEnd(8)} (${list.length}): ${list.map((s) => s.name).join(', ')}`)
  }
  const freelancers = STAFF.filter((s) => s.isFreelance)
  console.log(`  freelance  (${freelancers.length}): ${freelancers.map((s) => s.name).join(', ')}`)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
