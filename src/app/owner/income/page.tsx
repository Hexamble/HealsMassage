// heals-system-rebuild — Shop Income Board (Task 15.1)
//
// Monthly income view per branch per day. Sales / Cash / QR / Credit /
// Collected / Freelance / Expenses / NetIncome computed via
// `computeMonthIncomeBoard`. Defaults to the calendar month containing
// today; `?year=2026&month=4` overrides.
//
// Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 17.5, 18.3.

import { computeMonthIncomeBoard } from '@/domain/income-board'
import {
  BRANCHES,
  type Branch,
  type ExpenseRow,
  type TransactionRow,
} from '@/domain/types'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

function n(v: unknown): number {
  if (typeof v === 'number') return v
  if (v == null) return 0
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

function buildMonthDays(year: number, monthIdx: number): string[] {
  const out: string[] = []
  const last = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate()
  for (let d = 1; d <= last; d++) {
    const mm = String(monthIdx + 1).padStart(2, '0')
    const dd = String(d).padStart(2, '0')
    out.push(`${year}-${mm}-${dd}`)
  }
  return out
}

export default async function ShopIncomePage({
  searchParams,
}: {
  searchParams: { year?: string; month?: string }
}) {
  const now = new Date()
  const year = searchParams.year
    ? parseInt(searchParams.year, 10)
    : now.getUTCFullYear()
  const monthIdx = searchParams.month
    ? Math.max(0, Math.min(11, parseInt(searchParams.month, 10)))
    : now.getUTCMonth()

  const days = buildMonthDays(year, monthIdx)
  const sb = createServerSupabaseClient()
  const [txRes, expRes] = await Promise.all([
    sb
      .from('transactions')
      .select('*')
      .gte('business_date', days[0])
      .lte('business_date', days[days.length - 1]),
    sb
      .from('expenses')
      .select('*')
      .gte('business_date', days[0])
      .lte('business_date', days[days.length - 1]),
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
  const grid = computeMonthIncomeBoard(txns, expenses, BRANCHES, days)

  // Month-level totals row for quick eyeballing.
  const monthlyTotals = days.reduce(
    (acc, d) => {
      for (const b of BRANCHES) {
        const c = grid[d][b]
        acc.sales += c.sales
        acc.collected += c.collected
        acc.freelance += c.freelance
        acc.expenses += c.expenses
        acc.netIncome += c.netIncome
      }
      return acc
    },
    { sales: 0, collected: 0, freelance: 0, expenses: 0, netIncome: 0 },
  )

  const prevMonth = monthIdx === 0 ? 11 : monthIdx - 1
  const prevYear = monthIdx === 0 ? year - 1 : year
  const nextMonth = monthIdx === 11 ? 0 : monthIdx + 1
  const nextYear = monthIdx === 11 ? year + 1 : year

  const monthLabel = new Date(Date.UTC(year, monthIdx, 1)).toLocaleDateString(
    'en-GB',
    { month: 'long', year: 'numeric', timeZone: 'UTC' },
  )

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold">
            Shop Income — {monthLabel}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Sales / Cash / QR / Credit / Net per branch per day
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`?year=${prevYear}&month=${prevMonth}`}
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            ← Prev
          </a>
          <a
            href={`?year=${nextYear}&month=${nextMonth}`}
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            Next →
          </a>
        </div>
      </header>

      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
        <Stat label="Total sales" v={monthlyTotals.sales} />
        <Stat label="Collected" v={monthlyTotals.collected} />
        <Stat label="Freelance" v={monthlyTotals.freelance} />
        <Stat label="Expenses" v={monthlyTotals.expenses} />
        <Stat label="Net income" v={monthlyTotals.netIncome} bold />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <table className="min-w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th className="px-2 py-2 text-left sticky left-0 bg-white dark:bg-zinc-900 z-10">
                Date
              </th>
              {BRANCHES.map((b) => (
                <th key={b} colSpan={5} className="px-2 py-2 text-center border-l border-zinc-200 dark:border-zinc-800">
                  {b}
                </th>
              ))}
            </tr>
            <tr>
              <th className="px-2 py-1 text-left sticky left-0 bg-white dark:bg-zinc-900 z-10"></th>
              {BRANCHES.map((b) => (
                <>
                  <th key={`${b}-sales`} className="px-2 py-1 text-right border-l border-zinc-200 dark:border-zinc-800">Sales</th>
                  <th key={`${b}-cash`} className="px-2 py-1 text-right">Cash</th>
                  <th key={`${b}-qr`} className="px-2 py-1 text-right">QR</th>
                  <th key={`${b}-credit`} className="px-2 py-1 text-right">Credit</th>
                  <th key={`${b}-net`} className="px-2 py-1 text-right">Net</th>
                </>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr
                key={d}
                className="border-b border-zinc-100 dark:border-zinc-800"
              >
                <td className="px-2 py-1.5 font-mono sticky left-0 bg-white dark:bg-zinc-900">
                  {d.slice(8)}
                </td>
                {BRANCHES.map((b) => {
                  const c = grid[d][b]
                  return (
                    <>
                      <td key={`${d}-${b}-s`} className="px-2 py-1.5 text-right tabular-nums border-l border-zinc-200 dark:border-zinc-800">
                        {c.sales === 0 ? '·' : c.sales.toFixed(2)}
                      </td>
                      <td key={`${d}-${b}-c`} className="px-2 py-1.5 text-right tabular-nums">
                        {c.cash === 0 ? '·' : c.cash.toFixed(2)}
                      </td>
                      <td key={`${d}-${b}-q`} className="px-2 py-1.5 text-right tabular-nums">
                        {c.qr === 0 ? '·' : c.qr.toFixed(2)}
                      </td>
                      <td key={`${d}-${b}-cr`} className="px-2 py-1.5 text-right tabular-nums">
                        {c.credit === 0 ? '·' : c.credit.toFixed(2)}
                      </td>
                      <td key={`${d}-${b}-n`} className="px-2 py-1.5 text-right tabular-nums font-semibold">
                        {c.netIncome === 0 ? '·' : c.netIncome.toFixed(2)}
                      </td>
                    </>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Stat({
  label,
  v,
  bold,
}: {
  label: string
  v: number
  bold?: boolean
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div
        className={`tabular-nums text-2xl ${bold ? 'font-semibold' : ''}`}
      >
        {v.toFixed(2)}
      </div>
    </div>
  )
}
