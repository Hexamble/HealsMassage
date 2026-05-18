/**
 * One-shot seed script for local Supabase.
 *
 * Creates:
 *   - bill@heals.local                — role: owner
 *   - cashier-kimberry@heals.local    — role: cashier, branch: Kimberry
 *   - cashier-bishop@heals.local      — role: cashier, branch: Bishop
 *   - cashier-chulia@heals.local      — role: cashier, branch: Chulia
 * All four accounts use password 'heals1234' and are auto-confirmed.
 *
 * Also seeds:
 *   - The May 15 2026 dataset (24 transactions) so dashboards have data
 *     immediately on first sign-in.
 *   - Active staff roster covering every fixture name.
 *   - Today's branch_roster for each branch so the queue board renders.
 *
 * Idempotent — re-running is safe; existing users are updated, not
 * duplicated, and existing transactions overwrite via row_id.
 *
 * Run from `c:\BILL\app\` via:
 *   npx tsx -r dotenv/config scripts/seed-test-accounts.ts dotenv_config_path=.env.local
 */

import { createClient } from '@supabase/supabase-js'
import { getBusinessDate } from '@/domain/business-date'
import type { Branch } from '@/domain/row-id'
import type { Course, Duration } from '@/domain/commission'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const PASSWORD = 'heals1234'

if (!URL || !KEY) {
  console.error('Missing env. Source .env.local first.')
  process.exit(2)
}

const sb = createClient(URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

interface AccountSpec {
  email: string
  role: 'owner' | 'cashier' | 'boss_view'
  branch?: Branch
}

const ACCOUNTS: AccountSpec[] = [
  { email: 'bill@heals.local', role: 'owner' },
  { email: 'cashier-kimberry@heals.local', role: 'cashier', branch: 'Kimberry' },
  { email: 'cashier-bishop@heals.local', role: 'cashier', branch: 'Bishop' },
  { email: 'cashier-chulia@heals.local', role: 'cashier', branch: 'Chulia' },
]

async function ensureUser(spec: AccountSpec): Promise<void> {
  // List existing users to check if this email already exists.
  const { data: list, error: listErr } = await sb.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  })
  if (listErr) throw listErr

  const existing = list.users.find((u) => u.email?.toLowerCase() === spec.email.toLowerCase())

  const appMetadata: Record<string, unknown> = { role: spec.role }
  if (spec.branch) appMetadata.branch = spec.branch
  else appMetadata.branch = null

  if (existing) {
    const { error } = await sb.auth.admin.updateUserById(existing.id, {
      password: PASSWORD,
      email_confirm: true,
      app_metadata: appMetadata,
    })
    if (error) throw error
    console.log(`updated ${spec.email}  (role=${spec.role}${spec.branch ? `, branch=${spec.branch}` : ''})`)
  } else {
    const { error } = await sb.auth.admin.createUser({
      email: spec.email,
      password: PASSWORD,
      email_confirm: true,
      app_metadata: appMetadata,
    })
    if (error) throw error
    console.log(`created ${spec.email}  (role=${spec.role}${spec.branch ? `, branch=${spec.branch}` : ''})`)
  }
}

interface RosterStaff {
  name: string
  homeBranch: Branch
  isFreelance: boolean
}

const FIXTURE_STAFF: RosterStaff[] = [
  { name: 'Beer', homeBranch: 'Kimberry', isFreelance: false },
  { name: 'Ney', homeBranch: 'Kimberry', isFreelance: false },
  { name: 'Nana', homeBranch: 'Kimberry', isFreelance: false },
  { name: 'Lin', homeBranch: 'Kimberry', isFreelance: false },
  { name: 'Nan', homeBranch: 'Kimberry', isFreelance: false },
  { name: 'Pra', homeBranch: 'Kimberry', isFreelance: false },
  { name: 'Yui', homeBranch: 'Bishop', isFreelance: false },
]

async function ensureStaffRoster(): Promise<void> {
  for (const s of FIXTURE_STAFF) {
    const { data: existing } = await sb.from('staff').select('id').ilike('name', s.name).maybeSingle()
    if (existing) {
      await sb.from('staff').update({ home_branch: s.homeBranch, is_freelance: s.isFreelance, active: true }).eq('id', existing.id)
    } else {
      await sb.from('staff').insert({ name: s.name, home_branch: s.homeBranch, is_freelance: s.isFreelance, active: true })
    }
  }
  console.log(`staff roster: ${FIXTURE_STAFF.length} entries ensured`)
}

async function setTodayBranchRoster(): Promise<void> {
  const today = getBusinessDate(new Date())
  for (const branch of ['Kimberry', 'Bishop', 'Chulia'] as const) {
    await sb.from('branch_roster').delete().eq('branch', branch).eq('business_date', today)
    const todayStaff = FIXTURE_STAFF.filter((s) => s.homeBranch === branch).map((s) => ({
      branch,
      business_date: today,
      staff_name: s.name,
    }))
    if (todayStaff.length > 0) {
      await sb.from('branch_roster').insert(todayStaff)
    }
  }
  console.log(`branch_roster for today (${today}): seeded for all branches`)
}

interface FixtureRow {
  branch: Branch
  rowNum: number
  staff: string
  course: Course
  duration: Duration
  timeIn: string
  timeOut: string
  method: string
  price: number
  cash: number
  qr: number
  credit: number
  commission: number
}

const MAY15 = '2026-05-15'

const may15Fixture: FixtureRow[] = [
  { branch: 'Kimberry', rowNum: 1, staff: 'Ney', course: 'DTM', duration: 60, timeIn: '11:10', timeOut: '12:10', method: 'CREDIT', price: 98, cash: 0, qr: 0, credit: 98, commission: 31 },
  { branch: 'Kimberry', rowNum: 2, staff: 'Beer', course: 'FR', duration: 60, timeIn: '11:10', timeOut: '12:10', method: 'CASH', price: 70, cash: 70, qr: 0, credit: 0, commission: 23 },
  { branch: 'Kimberry', rowNum: 3, staff: 'Nana', course: 'DTM', duration: 60, timeIn: '11:25', timeOut: '12:25', method: 'CREDIT', price: 98, cash: 0, qr: 0, credit: 98, commission: 31 },
  { branch: 'Kimberry', rowNum: 4, staff: 'Lin', course: 'FNS', duration: 60, timeIn: '11:20', timeOut: '12:20', method: 'CREDIT', price: 80, cash: 0, qr: 0, credit: 80, commission: 26 },
  { branch: 'Kimberry', rowNum: 5, staff: 'Nan', course: 'DTM', duration: 60, timeIn: '13:10', timeOut: '14:10', method: 'CREDIT', price: 98, cash: 0, qr: 0, credit: 98, commission: 31 },
  { branch: 'Kimberry', rowNum: 6, staff: 'Pra', course: 'DTM', duration: 60, timeIn: '14:05', timeOut: '15:05', method: 'CREDIT', price: 98, cash: 0, qr: 0, credit: 98, commission: 31 },
  { branch: 'Kimberry', rowNum: 7, staff: 'Ney', course: 'FR', duration: 90, timeIn: '14:15', timeOut: '15:45', method: 'QR', price: 100, cash: 0, qr: 100, credit: 0, commission: 31 },
  { branch: 'Kimberry', rowNum: 8, staff: 'Beer', course: 'FR', duration: 90, timeIn: '14:15', timeOut: '15:45', method: 'QR', price: 100, cash: 0, qr: 100, credit: 0, commission: 31 },
  { branch: 'Kimberry', rowNum: 9, staff: 'Nana', course: 'FR', duration: 60, timeIn: '16:20', timeOut: '17:20', method: 'EXTRA BS', price: 0, cash: 0, qr: 0, credit: 0, commission: 23 },
  { branch: 'Kimberry', rowNum: 10, staff: 'Lin', course: 'FR', duration: 60, timeIn: '16:20', timeOut: '17:20', method: 'EXTRA BS', price: 0, cash: 0, qr: 0, credit: 0, commission: 23 },
  { branch: 'Kimberry', rowNum: 11, staff: 'Nan', course: 'FR', duration: 60, timeIn: '17:05', timeOut: '18:05', method: 'EXTRA BS', price: 0, cash: 0, qr: 0, credit: 0, commission: 23 },
  { branch: 'Kimberry', rowNum: 12, staff: 'Pra', course: 'FR', duration: 60, timeIn: '17:05', timeOut: '18:05', method: 'EXTRA BS', price: 0, cash: 0, qr: 0, credit: 0, commission: 23 },
  { branch: 'Kimberry', rowNum: 13, staff: 'Ney', course: 'HOM', duration: 60, timeIn: '19:25', timeOut: '20:25', method: 'EXTRA BS', price: 0, cash: 0, qr: 0, credit: 0, commission: 34 },
  { branch: 'Kimberry', rowNum: 14, staff: 'Beer', course: 'FR', duration: 90, timeIn: '22:15', timeOut: '23:45', method: 'EXTRA CL', price: 0, cash: 0, qr: 0, credit: 0, commission: 31 },
  { branch: 'Kimberry', rowNum: 15, staff: 'Nana', course: 'FNS', duration: 90, timeIn: '22:15', timeOut: '23:45', method: 'EXTRA CL', price: 0, cash: 0, qr: 0, credit: 0, commission: 35 },
  { branch: 'Kimberry', rowNum: 16, staff: 'Lin', course: 'FNS', duration: 90, timeIn: '22:20', timeOut: '23:50', method: 'EXTRA CL', price: 0, cash: 0, qr: 0, credit: 0, commission: 35 },
  { branch: 'Kimberry', rowNum: 17, staff: 'Nan', course: 'BMT', duration: 60, timeIn: '23:50', timeOut: '00:50', method: 'EXTRA CL', price: 0, cash: 0, qr: 0, credit: 0, commission: 26 },
  { branch: 'Kimberry', rowNum: 18, staff: 'Beer', course: 'BMT', duration: 60, timeIn: '23:50', timeOut: '00:50', method: 'EXTRA CL', price: 0, cash: 0, qr: 0, credit: 0, commission: 26 },
  { branch: 'Bishop', rowNum: 1, staff: 'Nana', course: 'FR', duration: 60, timeIn: '16:20', timeOut: '17:20', method: 'CREDIT', price: 68, cash: 0, qr: 0, credit: 68, commission: 23 },
  { branch: 'Bishop', rowNum: 2, staff: 'Lin', course: 'FR', duration: 60, timeIn: '16:30', timeOut: '17:30', method: 'CREDIT', price: 68, cash: 0, qr: 0, credit: 68, commission: 23 },
  { branch: 'Bishop', rowNum: 3, staff: 'Yui', course: 'FR', duration: 60, timeIn: '16:30', timeOut: '17:30', method: 'CREDIT', price: 68, cash: 0, qr: 0, credit: 68, commission: 23 },
  { branch: 'Bishop', rowNum: 4, staff: 'Nan', course: 'FR', duration: 60, timeIn: '17:05', timeOut: '18:05', method: 'CASH', price: 68, cash: 68, qr: 0, credit: 0, commission: 23 },
  { branch: 'Bishop', rowNum: 5, staff: 'Pra', course: 'FR', duration: 60, timeIn: '17:05', timeOut: '18:05', method: 'QR', price: 68, cash: 0, qr: 68, credit: 0, commission: 23 },
  { branch: 'Bishop', rowNum: 6, staff: 'Ney', course: 'HOM', duration: 60, timeIn: '19:25', timeOut: '20:25', method: 'CREDIT', price: 115, cash: 0, qr: 0, credit: 115, commission: 34 },
]

async function seedMay15(): Promise<void> {
  await sb.from('transactions').delete().eq('business_date', MAY15)
  for (const r of may15Fixture) {
    const { error } = await sb.rpc('write_transaction', {
      payload: {
        row_id: `${r.branch}|${MAY15}|${r.rowNum}`,
        branch: r.branch,
        business_date: MAY15,
        row_num: r.rowNum,
        staff: r.staff,
        course: r.course,
        duration: r.duration,
        time_in: r.timeIn,
        time_out: r.timeOut,
        addon: 0,
        commission: r.commission,
        method: r.method,
        cash: r.cash,
        qr: r.qr,
        credit: r.credit,
        price: r.price,
        note: '',
        updated_by: null,
      },
    })
    if (error) throw new Error(`seed failed for row ${r.rowNum}: ${error.message}`)
  }
  console.log(`May 15 fixture: ${may15Fixture.length} rows seeded`)
}

async function main(): Promise<void> {
  for (const a of ACCOUNTS) {
    await ensureUser(a)
  }
  await ensureStaffRoster()
  await setTodayBranchRoster()
  await seedMay15()

  console.log('')
  console.log('=== Test accounts (all use password "heals1234") ===')
  for (const a of ACCOUNTS) {
    console.log(`  ${a.email}  ${a.role}${a.branch ? ` ${a.branch}` : ''}`)
  }
  console.log('')
  console.log('Sign in at http://localhost:8080/auth/sign-in')
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
