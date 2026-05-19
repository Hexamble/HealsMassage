// heals-system-rebuild — Owner Salary Board (Task 14.1)
//
// Spreadsheet-style grid showing each staff member's daily commission
// and BALM bonus for the current pay cycle. Editable cells allow the
// owner to override/backfill historical data via ownerSetDayCommission.
//
// Layout per the workbook:
//   Row 1: day-of-week abbreviations (TUE, WED, ...)
//   Row 2: day numbers (21, 22, ...)
//   Per staff: commission row (bold name) + BALM row (lighter)
//   Right columns: TOTAL, TOTAL+BALM
//
// Sections: Kimberry → Bishop → Chulia (per-branch grouping by home branch)
//
// Validates: Requirements 9.1–9.7, 18.2.

import { cycleDates } from '@/domain/cycle'
import { getBusinessDate } from '@/domain/business-date'
import {
  BRANCHES,
  type Branch,
  type StaffMember,
  type TransactionRow,
} from '@/domain/types'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import SalaryGrid, {
  type BranchSectionData,
  type StaffRow,
  type StaffDayData,
} from './SalaryGrid'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function n(v: unknown): number {
  if (typeof v === 'number') return v
  if (v == null) return 0
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

function mapTx(r: Record<string, unknown>): TransactionRow {
  return {
    id: String(r.id ?? ''),
    branch: String(r.branch) as Branch,
    businessDate: String(r.business_date),
    cashierRowNumber: n(r.cashier_row_number),
    staff: String(r.staff ?? ''),
    course: String(r.course) as TransactionRow['course'],
    duration: n(r.duration) as TransactionRow['duration'],
    timeIn: r.time_in == null ? null : String(r.time_in),
    timeOut: r.time_out == null ? null : String(r.time_out),
    method: String(r.method ?? ''),
    addon: n(r.addon),
    baseCommission: n(r.base_commission),
    balmBonus: n(r.balm_bonus),
    bookingBonus: n(r.booking_bonus),
    totalCommission: n(r.total_commission),
    cash: n(r.cash),
    qr: n(r.qr),
    credit: n(r.credit),
    price: n(r.price),
    flags: String(r.flags ?? ''),
    comment: String(r.comment ?? ''),
    createdAt: String(r.created_at ?? ''),
    updatedAt: String(r.updated_at ?? ''),
    createdBy: r.created_by == null ? null : String(r.created_by),
  }
}

function mapStaff(r: Record<string, unknown>): StaffMember {
  return {
    id: String(r.id ?? ''),
    name: String(r.name ?? ''),
    homeBranch: String(r.home_branch) as Branch,
    isFreelance: Boolean(r.is_freelance),
    isActive: Boolean(r.is_active),
  }
}

const DAY_ABBREVS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

function getDayOfWeek(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  return DAY_ABBREVS[d.getUTCDay()]
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function SalaryBoardPage({
  searchParams,
}: {
  searchParams: { monthIdx?: string; year?: string }
}) {
  const sb = createServerSupabaseClient()

  // Load the configured pay-cycle start day (default 21).
  const { data: setting } = await sb
    .from('settings')
    .select('value')
    .eq('key', 'pay_cycle_start_day')
    .maybeSingle()
  const payCycleStartDay = Number(setting?.value ?? 21)

  // Default to the cycle containing today.
  const today = getBusinessDate(new Date())
  const todayDate = new Date(today + 'T00:00:00Z')
  const fallbackMonth = todayDate.getUTCMonth()
  const fallbackYear = todayDate.getUTCFullYear()

  const monthIdx = searchParams.monthIdx
    ? Math.max(0, Math.min(11, parseInt(searchParams.monthIdx, 10)))
    : fallbackMonth
  const year = searchParams.year
    ? parseInt(searchParams.year, 10)
    : fallbackYear

  const cycle = cycleDates(monthIdx, year, payCycleStartDay)

  // Fetch transactions + staff roster in parallel.
  const [txRes, staffRes] = await Promise.all([
    sb
      .from('transactions')
      .select('*')
      .gte('business_date', cycle.startDate)
      .lte('business_date', cycle.endDate),
    sb.from('staff').select('*'),
  ])
  const txns = ((txRes.data ?? []) as Record<string, unknown>[]).map(mapTx)
  const roster = ((staffRes.data ?? []) as Record<string, unknown>[]).map(
    mapStaff,
  )

  // Build roster lookup (active, non-freelance only for display).
  const rosterByName = new Map<string, StaffMember>()
  for (const s of roster) {
    rosterByName.set(s.name.trim().toLowerCase(), s)
  }

  // Group transactions by staff+date. For each staff+date we track:
  //   - sum of totalCommission (the daily commission cell)
  //   - sum of balmBonus (the BALM cell)
  //   - first transaction ID (for the edit action — edits the first tx of the day)
  type DayBucket = { commission: number; balm: number; txId: string }
  // staffLc → date → bucket
  const staffDays = new Map<string, Map<string, DayBucket>>()
  // staffLc → display name
  const staffDisplayNames = new Map<string, string>()

  // Filter out freelance rows
  for (const tx of txns) {
    if (tx.method.trim().toLowerCase() === 'freelance') continue

    const staffLc = tx.staff.trim().toLowerCase()
    if (!staffLc) continue

    if (!staffDisplayNames.has(staffLc)) {
      staffDisplayNames.set(staffLc, tx.staff.trim())
    }

    let dayMap = staffDays.get(staffLc)
    if (!dayMap) {
      dayMap = new Map()
      staffDays.set(staffLc, dayMap)
    }

    const existing = dayMap.get(tx.businessDate)
    if (existing) {
      existing.commission += n(tx.totalCommission)
      existing.balm += n(tx.balmBonus)
    } else {
      dayMap.set(tx.businessDate, {
        commission: n(tx.totalCommission),
        balm: n(tx.balmBonus),
        txId: tx.id,
      })
    }
  }

  // Build per-branch sections: group staff by home branch.
  const sections: BranchSectionData[] = []

  for (const branch of BRANCHES) {
    const branchStaff: StaffRow[] = []

    for (const [staffLc, dayMap] of Array.from(staffDays)) {
      const rosterEntry = rosterByName.get(staffLc)
      if (!rosterEntry) continue
      if (rosterEntry.isFreelance) continue
      if (!rosterEntry.isActive) continue
      if (rosterEntry.homeBranch !== branch) continue

      const days: Record<string, StaffDayData> = {}
      let totalCommission = 0
      let totalBalm = 0

      for (const [date, bucket] of Array.from(dayMap)) {
        days[date] = {
          txId: bucket.txId,
          commission: Math.round(bucket.commission * 100) / 100,
          balm: Math.round(bucket.balm * 100) / 100,
        }
        totalCommission += bucket.commission
        totalBalm += bucket.balm
      }

      branchStaff.push({
        name: staffDisplayNames.get(staffLc) ?? rosterEntry.name,
        days,
        totalCommission: Math.round(totalCommission * 100) / 100,
        totalBalm: Math.round(totalBalm * 100) / 100,
      })
    }

    // Sort by total descending, then name ascending.
    branchStaff.sort(
      (a, b) => b.totalCommission - a.totalCommission || a.name.localeCompare(b.name),
    )

    if (branchStaff.length > 0) {
      sections.push({ branch, staff: branchStaff })
    }
  }

  // Build day headers from cycle.days.
  const dayHeaders = cycle.days.map((d) => ({
    date: d,
    dayOfWeek: getDayOfWeek(d),
    dayNum: String(parseInt(d.slice(8), 10)), // strip leading zero
  }))

  // Prev/next cycle navigation.
  const prevMonthIdx = monthIdx === 0 ? 11 : monthIdx - 1
  const prevYear = monthIdx === 0 ? year - 1 : year
  const nextMonthIdx = monthIdx === 11 ? 0 : monthIdx + 1
  const nextYear = monthIdx === 11 ? year + 1 : year

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Salary Board</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Cycle: <span className="font-mono">{cycle.startDate}</span> →{' '}
            <span className="font-mono">{cycle.endDate}</span> · Day{' '}
            {payCycleStartDay} start
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`?monthIdx=${prevMonthIdx}&year=${prevYear}`}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50"
          >
            ← Prev
          </a>
          <a
            href={`?monthIdx=${nextMonthIdx}&year=${nextYear}`}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50"
          >
            Next →
          </a>
        </div>
      </header>

      <SalaryGrid sections={sections} dayHeaders={dayHeaders} today={today} />
    </div>
  )
}
