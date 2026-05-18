// heals-system-rebuild — Owner CSV export route handler.
//
// Generates RFC 4180 CSV for the four owner reports:
//   - top-earners
//   - payouts
//   - expenses
//   - uncovered-extras
//
// Auth: owner-only. Returns 401 / 403 for cashiers and unauthenticated.
//
// Query params:
//   ?cycle=<monthIdx>-<year>     — cycle to report on (default: current)
//   &kind=<top-earners|payouts|expenses|uncovered-extras>
//
// Validates: Requirement 22.4 (CSV export).

import { NextResponse, type NextRequest } from 'next/server'

import { cycleDates } from '@/domain/cycle'
import { getBusinessDate } from '@/domain/business-date'
import {
  expenseBreakdown,
  payoutReport,
  topEarners,
  uncoveredExtras,
} from '@/domain/reports'
import {
  BRANCHES,
  type Branch,
  type ExpenseRow,
  type StaffMember,
  type TransactionRow,
} from '@/domain/types'
import { toCSV, type CSVColumn } from '@/lib/csv'
import { getCurrentProfile } from '@/lib/profile'
import { createServerSupabaseClient } from '@/lib/supabase/server'

function n(v: unknown): number {
  if (typeof v === 'number') return v
  if (v == null) return 0
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

export async function GET(req: NextRequest) {
  const profile = await getCurrentProfile()
  if (!profile) {
    return new NextResponse('unauthenticated', { status: 401 })
  }
  if (profile.role !== 'owner') {
    return new NextResponse('forbidden', { status: 403 })
  }

  const url = new URL(req.url)
  const kind = url.searchParams.get('kind') ?? 'top-earners'
  const cycleParam = url.searchParams.get('cycle') ?? ''
  const sb = createServerSupabaseClient()

  const { data: setting } = await sb
    .from('settings')
    .select('value')
    .eq('key', 'pay_cycle_start_day')
    .maybeSingle()
  const payCycleStartDay = Number(setting?.value ?? 21)

  const today = getBusinessDate(new Date())
  const todayDate = new Date(today + 'T00:00:00Z')
  let monthIdx = todayDate.getUTCMonth()
  let year = todayDate.getUTCFullYear()
  const m = /^(\d+)-(\d{4})$/.exec(cycleParam)
  if (m) {
    monthIdx = Math.max(0, Math.min(11, parseInt(m[1], 10)))
    year = parseInt(m[2], 10)
  }
  const cycle = cycleDates(monthIdx, year, payCycleStartDay)

  const [txRes, expRes, staffRes] = await Promise.all([
    sb
      .from('transactions')
      .select('*')
      .gte('business_date', cycle.startDate)
      .lte('business_date', cycle.endDate),
    sb
      .from('expenses')
      .select('*')
      .gte('business_date', cycle.startDate)
      .lte('business_date', cycle.endDate),
    sb.from('staff').select('*'),
  ])

  const txns: TransactionRow[] = ((txRes.data ?? []) as Record<
    string,
    unknown
  >[]).map(
    (r): TransactionRow => ({
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
    }),
  )
  const expenses: ExpenseRow[] = ((expRes.data ?? []) as Record<
    string,
    unknown
  >[]).map(
    (r): ExpenseRow => ({
      id: String(r.id ?? ''),
      branch: String(r.branch) as Branch,
      businessDate: String(r.business_date),
      item: String(r.item ?? ''),
      amount: n(r.amount),
      method: String(r.method) as ExpenseRow['method'],
      note: String(r.note ?? ''),
      source: String(r.source) as ExpenseRow['source'],
      createdAt: String(r.created_at ?? ''),
      createdBy: r.created_by == null ? null : String(r.created_by),
    }),
  )
  const roster: StaffMember[] = ((staffRes.data ?? []) as Record<
    string,
    unknown
  >[]).map(
    (r): StaffMember => ({
      id: String(r.id ?? ''),
      name: String(r.name ?? ''),
      homeBranch: String(r.home_branch) as Branch,
      isFreelance: Boolean(r.is_freelance),
      isActive: Boolean(r.is_active),
    }),
  )

  let csv: string
  let filename: string

  if (kind === 'top-earners') {
    const rows = topEarners(txns, cycle).map((r, i) => ({
      rank: i + 1,
      name: r.name,
      total: r.total.toFixed(2),
    }))
    const cols: CSVColumn<(typeof rows)[number]>[] = [
      { key: 'rank', header: 'Rank' },
      { key: 'name', header: 'Staff' },
      { key: 'total', header: 'Total RM' },
    ]
    csv = toCSV(rows, cols)
    filename = `top-earners-${cycle.startDate}_to_${cycle.endDate}.csv`
  } else if (kind === 'payouts') {
    const report = payoutReport(txns, roster, cycle)
    const flat = BRANCHES.flatMap((b) =>
      report[b].map((p) => ({
        branch: b,
        staff: p.staff,
        total: p.total.toFixed(2),
      })),
    )
    const cols: CSVColumn<(typeof flat)[number]>[] = [
      { key: 'branch', header: 'Branch' },
      { key: 'staff', header: 'Staff' },
      { key: 'total', header: 'Total RM' },
    ]
    csv = toCSV(flat, cols)
    filename = `payouts-${cycle.startDate}_to_${cycle.endDate}.csv`
  } else if (kind === 'expenses') {
    const rollup = expenseBreakdown(expenses, cycle, [...BRANCHES])
    const flat = rollup.flatMap((e) =>
      e.items.map((it) => ({
        branch: e.branch,
        item: it.item,
        amount: it.total.toFixed(2),
      })),
    )
    const cols: CSVColumn<(typeof flat)[number]>[] = [
      { key: 'branch', header: 'Branch' },
      { key: 'item', header: 'Item' },
      { key: 'amount', header: 'Amount RM' },
    ]
    csv = toCSV(flat, cols)
    filename = `expenses-${cycle.startDate}_to_${cycle.endDate}.csv`
  } else if (kind === 'uncovered-extras') {
    const rows = uncoveredExtras(txns).map((r) => ({
      date: r.businessDate,
      sourceBranch: r.branch,
      staff: r.staff,
      course: r.course,
      duration: r.duration,
      method: r.method,
      commission: r.totalCommission.toFixed(2),
    }))
    const cols: CSVColumn<(typeof rows)[number]>[] = [
      { key: 'date', header: 'Business date' },
      { key: 'sourceBranch', header: 'Source branch' },
      { key: 'staff', header: 'Staff' },
      { key: 'course', header: 'Course' },
      { key: 'duration', header: 'Duration' },
      { key: 'method', header: 'Method' },
      { key: 'commission', header: 'Commission RM' },
    ]
    csv = toCSV(rows, cols)
    filename = `uncovered-extras-${cycle.startDate}_to_${cycle.endDate}.csv`
  } else {
    return new NextResponse('unknown kind', { status: 400 })
  }

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
