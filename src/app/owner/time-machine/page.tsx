// heals-system-rebuild — Owner Time Machine (Task 17.1)
//
// Pick any past business date and view all transactions + expenses
// across all three branches as the cashier table layout. Owner can
// drill into any branch's cashier route at that historical date for
// inline editing (writeTransaction allows owner historical backfill).
//
// This page is read-only by itself — edits happen on the cashier
// route which already supports owner historical writes.
//
// Validates: Requirements 13.1, 13.2, 13.3.

import Link from 'next/link'

import {
  BRANCHES,
  type Branch,
  type ExpenseRow,
  type TransactionRow,
} from '@/domain/types'
import { computeDayBranchIncome } from '@/domain/income-board'
import { createServerSupabaseClient } from '@/lib/supabase/server'

import BackfillRow from './BackfillRow'

export const dynamic = 'force-dynamic'

function n(v: unknown): number {
  if (typeof v === 'number') return v
  if (v == null) return 0
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

export default async function TimeMachinePage({
  searchParams,
}: {
  searchParams: { date?: string }
}) {
  const date = searchParams.date && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date)
    ? searchParams.date
    : ''

  const sb = createServerSupabaseClient()
  let txns: TransactionRow[] = []
  let expenses: ExpenseRow[] = []
  if (date) {
    const [txRes, expRes] = await Promise.all([
      sb
        .from('transactions')
        .select('*')
        .eq('business_date', date)
        .order('cashier_row_number', { ascending: true }),
      sb.from('expenses').select('*').eq('business_date', date),
    ])
    txns = ((txRes.data ?? []) as Record<string, unknown>[]).map(
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
    expenses = ((expRes.data ?? []) as Record<string, unknown>[]).map(
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
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl sm:text-3xl font-semibold">Time Machine</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Review or backfill any past business date across all three branches.
        </p>
      </header>

      <form className="flex flex-wrap items-end gap-3 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
        <div className="flex flex-col">
          <label
            htmlFor="date-picker"
            className="text-xs uppercase tracking-wide text-zinc-500 mb-1"
          >
            Business date
          </label>
          <input
            id="date-picker"
            name="date"
            type="date"
            defaultValue={date}
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-1.5 text-sm font-medium"
        >
          Load day
        </button>
        {date && (
          <Link
            href={`/cashier/Kimberry`}
            className="ml-auto rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            Open cashier (Kimberry today) →
          </Link>
        )}
      </form>

      {date ? (
        <div className="space-y-6">
          {BRANCHES.map((b) => {
            const branchTxns = txns
              .filter((t) => t.branch === b)
              .sort((a, b) => a.cashierRowNumber - b.cashierRowNumber)
            const summary = computeDayBranchIncome(txns, expenses, b, date)
            const branchExpenses = expenses.filter((e) => e.branch === b)
            return (
              <BranchDay
                key={b}
                branch={b}
                date={date}
                txns={branchTxns}
                expenses={branchExpenses}
                summary={summary}
              />
            )
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 text-sm text-zinc-500">
          Pick a date above to load all three branches.
        </div>
      )}
    </div>
  )
}

function BranchDay({
  branch,
  date,
  txns,
  expenses,
  summary,
}: {
  branch: Branch
  date: string
  txns: TransactionRow[]
  expenses: ExpenseRow[]
  summary: ReturnType<typeof computeDayBranchIncome>
}) {
  const nextRowNumber =
    txns.reduce((m, t) => Math.max(m, t.cashierRowNumber), 0) + 1
  return (
    <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      <header className="px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3 bg-zinc-50/60 dark:bg-zinc-950/40">
        <h2 className="text-base font-semibold">
          {branch} · {date}
        </h2>
        <span className="text-xs text-zinc-500 tabular-nums">
          Sales RM {summary.sales.toFixed(2)} · Net RM{' '}
          {summary.netIncome.toFixed(2)} · {summary.sessions} sessions
        </span>
      </header>
      <div className="overflow-x-auto">
        {txns.length === 0 ? (
          <p className="px-4 py-3 text-sm text-zinc-500">
            No transactions logged.
          </p>
        ) : (
          <table className="min-w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wide text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="px-2 py-1 text-right">#</th>
                <th className="px-2 py-1 text-left">Staff</th>
                <th className="px-2 py-1 text-left">Course</th>
                <th className="px-2 py-1 text-left">Dur</th>
                <th className="px-2 py-1 text-left">Method</th>
                <th className="px-2 py-1 text-right">Price</th>
                <th className="px-2 py-1 text-right">Total</th>
                <th className="px-2 py-1 text-left">Flags</th>
              </tr>
            </thead>
            <tbody>
              {txns.map((t) => (
                <tr
                  key={t.id}
                  className="border-b border-zinc-100 dark:border-zinc-800"
                >
                  <td className="px-2 py-1 text-right text-zinc-500">
                    {t.cashierRowNumber}
                  </td>
                  <td className="px-2 py-1 font-medium">{t.staff}</td>
                  <td className="px-2 py-1">{t.course}</td>
                  <td className="px-2 py-1">{t.duration}</td>
                  <td className="px-2 py-1">{t.method}</td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {t.price.toFixed(2)}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {t.totalCommission.toFixed(2)}
                  </td>
                  <td className="px-2 py-1 text-zinc-500">{t.flags}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {expenses.length > 0 && (
        <div className="border-t border-zinc-200 dark:border-zinc-800 px-4 py-2 text-xs text-zinc-600 dark:text-zinc-400">
          <span className="font-semibold">Expenses:</span>{' '}
          {expenses
            .map((e) => `${e.item} (RM ${e.amount.toFixed(2)})`)
            .join(', ')}
        </div>
      )}
      <BackfillRow branch={branch} date={date} nextRowNumber={nextRowNumber} />
    </section>
  )
}
