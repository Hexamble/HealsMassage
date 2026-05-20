// Boss HQ — Shop Income Board (Google Sheets edition)
//
// Per-day per-branch income view. Reads directly from the
// Cashier_POS Google Sheet via the Visualization API.

import Link from 'next/link'

import { getBusinessDate } from '@/domain/business-date'
import { BRANCHES, type Branch } from '@/domain/types'
import { fetchAllBranches, type CashierRow } from '@/lib/sheets'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isFreelance(method: string): boolean {
  return method.trim().toLowerCase() === 'freelance'
}

interface DayBranchCell {
  sales: number
  cash: number
  qr: number
  credit: number
  collected: number
  freelance: number
  netIncome: number
  sessions: number
}

function emptyCell(): DayBranchCell {
  return { sales: 0, cash: 0, qr: 0, credit: 0, collected: 0, freelance: 0, netIncome: 0, sessions: 0 }
}

function computeIncome(
  rows: CashierRow[],
  branch: Branch,
  date: string,
): DayBranchCell {
  const cell = emptyCell()

  for (const r of rows) {
    if (r.branch !== branch) continue
    if (r.businessDate !== date) continue

    if (isFreelance(r.method)) {
      cell.freelance += r.commission
      continue
    }

    cell.sales += r.price
    cell.cash += r.cash
    cell.qr += r.qr
    cell.credit += r.credit
    cell.sessions += 1
  }

  cell.collected = cell.cash + cell.qr
  cell.netIncome = cell.collected - cell.freelance
  return cell
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

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function ShopIncomePage({
  searchParams,
}: {
  searchParams: { year?: string; month?: string }
}) {
  const today = getBusinessDate(new Date())
  const todayDate = new Date(today + 'T00:00:00Z')
  const year = searchParams.year
    ? parseInt(searchParams.year, 10)
    : todayDate.getUTCFullYear()
  const monthIdx = searchParams.month
    ? Math.max(0, Math.min(11, parseInt(searchParams.month, 10)))
    : todayDate.getUTCMonth()

  const days = buildMonthDays(year, monthIdx)

  // Fetch all branches from Google Sheets
  const allRows = await fetchAllBranches()

  // Build the grid: date → branch → cell
  const grid: Record<string, Record<Branch, DayBranchCell>> = {}
  for (const d of days) {
    const perBranch = {} as Record<Branch, DayBranchCell>
    for (const b of BRANCHES) {
      perBranch[b] = computeIncome(allRows, b, d)
    }
    grid[d] = perBranch
  }

  // Monthly totals
  const monthlyTotals = days.reduce(
    (acc, d) => {
      for (const b of BRANCHES) {
        const c = grid[d][b]
        acc.sales += c.sales
        acc.collected += c.collected
        acc.freelance += c.freelance
        acc.netIncome += c.netIncome
      }
      return acc
    },
    { sales: 0, collected: 0, freelance: 0, netIncome: 0 },
  )

  const prevMonth = monthIdx === 0 ? 11 : monthIdx - 1
  const prevYear = monthIdx === 0 ? year - 1 : year
  const nextMonth = monthIdx === 11 ? 0 : monthIdx + 1
  const nextYear = monthIdx === 11 ? year + 1 : year

  const monthLabel = new Date(Date.UTC(year, monthIdx, 1)).toLocaleDateString(
    'en-GB',
    { month: 'long', year: 'numeric', timeZone: 'UTC' },
  )

  const now = new Date().toLocaleString('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    dateStyle: 'medium',
    timeStyle: 'short',
  })

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
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
            Last refreshed: {now} ·{' '}
            <Link
              href={`/owner/income?year=${year}&month=${monthIdx}`}
              className="underline hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              ⟳ Refresh
            </Link>
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

      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <Stat label="Total sales" v={monthlyTotals.sales} />
        <Stat label="Collected" v={monthlyTotals.collected} />
        <Stat label="Freelance" v={monthlyTotals.freelance} />
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
                <th
                  key={b}
                  colSpan={5}
                  className="px-2 py-2 text-center border-l border-zinc-200 dark:border-zinc-800"
                >
                  {b}
                </th>
              ))}
            </tr>
            <tr>
              <th className="px-2 py-1 text-left sticky left-0 bg-white dark:bg-zinc-900 z-10" />
              {BRANCHES.map((b) => (
                <SubHeaders key={b} />
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((d) => {
              const hasData = BRANCHES.some((b) => grid[d][b].sessions > 0)
              if (!hasData) return null
              return (
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
                      <BranchCells key={`${d}-${b}`} cell={c} />
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SubHeaders() {
  return (
    <>
      <th className="px-2 py-1 text-right border-l border-zinc-200 dark:border-zinc-800">
        Sales
      </th>
      <th className="px-2 py-1 text-right">Cash</th>
      <th className="px-2 py-1 text-right">QR</th>
      <th className="px-2 py-1 text-right">Credit</th>
      <th className="px-2 py-1 text-right">Net</th>
    </>
  )
}

function BranchCells({ cell }: { cell: DayBranchCell }) {
  return (
    <>
      <td className="px-2 py-1.5 text-right tabular-nums border-l border-zinc-200 dark:border-zinc-800">
        {cell.sales === 0 ? '·' : cell.sales.toFixed(2)}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums">
        {cell.cash === 0 ? '·' : cell.cash.toFixed(2)}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums">
        {cell.qr === 0 ? '·' : cell.qr.toFixed(2)}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums">
        {cell.credit === 0 ? '·' : cell.credit.toFixed(2)}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums font-semibold">
        {cell.netIncome === 0 ? '·' : cell.netIncome.toFixed(2)}
      </td>
    </>
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
