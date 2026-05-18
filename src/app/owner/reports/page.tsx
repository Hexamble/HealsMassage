// heals-system-rebuild — Owner Reports & Exports (Task 20.1)
//
// Server-rendered tables for the four reports: per-cycle payout, top
// earners, expense breakdown, EXTRA reconciliation. Each table also
// has a "Download CSV" link that points at a route handler which
// streams the CSV.

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
import { createServerSupabaseClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

function n(v: unknown): number {
  if (typeof v === 'number') return v
  if (v == null) return 0
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: { monthIdx?: string; year?: string }
}) {
  const sb = createServerSupabaseClient()
  const { data: setting } = await sb
    .from('settings')
    .select('value')
    .eq('key', 'pay_cycle_start_day')
    .maybeSingle()
  const payCycleStartDay = Number(setting?.value ?? 21)

  const today = getBusinessDate(new Date())
  const todayDate = new Date(today + 'T00:00:00Z')
  const monthIdx = searchParams.monthIdx
    ? Math.max(0, Math.min(11, parseInt(searchParams.monthIdx, 10)))
    : todayDate.getUTCMonth()
  const year = searchParams.year
    ? parseInt(searchParams.year, 10)
    : todayDate.getUTCFullYear()
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

  const txns: TransactionRow[] = ((txRes.data ?? []) as Record<string, unknown>[]).map(
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
  const expenses: ExpenseRow[] = ((expRes.data ?? []) as Record<string, unknown>[]).map(
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
  const roster: StaffMember[] = ((staffRes.data ?? []) as Record<string, unknown>[]).map(
    (r): StaffMember => ({
      id: String(r.id ?? ''),
      name: String(r.name ?? ''),
      homeBranch: String(r.home_branch) as Branch,
      isFreelance: Boolean(r.is_freelance),
      isActive: Boolean(r.is_active),
    }),
  )

  const top = topEarners(txns, cycle).slice(0, 25)
  const uncovered = uncoveredExtras(txns)
  const expenseRollup = expenseBreakdown(expenses, cycle, [...BRANCHES])
  const payouts = payoutReport(txns, roster, cycle)

  const csvBase = `/api/reports?cycle=${monthIdx}-${year}`

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold">Reports</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Cycle <span className="font-mono">{cycle.startDate}</span> →{' '}
            <span className="font-mono">{cycle.endDate}</span>
          </p>
        </div>
      </header>

      <ReportSection
        title="Top earners"
        href={`${csvBase}&kind=top-earners`}
      >
        <table className="min-w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2 text-left">Rank</th>
              <th className="px-3 py-2 text-left">Staff</th>
              <th className="px-3 py-2 text-right">Total RM</th>
            </tr>
          </thead>
          <tbody>
            {top.map((r, i) => (
              <tr
                key={r.name}
                className="border-t border-zinc-100 dark:border-zinc-800"
              >
                <td className="px-3 py-1.5 text-right">{i + 1}</td>
                <td className="px-3 py-1.5">{r.name}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {r.total.toFixed(2)}
                </td>
              </tr>
            ))}
            {top.length === 0 && (
              <tr>
                <td
                  colSpan={3}
                  className="px-3 py-6 text-center text-zinc-500"
                >
                  No earnings in this cycle yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ReportSection>

      <ReportSection
        title="Per-branch payouts"
        href={`${csvBase}&kind=payouts`}
      >
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 p-3">
          {BRANCHES.map((b) => (
            <div
              key={b}
              className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3"
            >
              <h3 className="text-sm font-semibold mb-2">{b}</h3>
              {payouts[b].length === 0 ? (
                <p className="text-xs text-zinc-500">No payouts.</p>
              ) : (
                <ul className="text-sm divide-y divide-zinc-100 dark:divide-zinc-800">
                  {payouts[b].map((p) => (
                    <li
                      key={p.staff}
                      className="flex items-center justify-between py-1"
                    >
                      <span>{p.staff}</span>
                      <span className="tabular-nums">
                        {p.total.toFixed(2)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </ReportSection>

      <ReportSection
        title="Expense breakdown"
        href={`${csvBase}&kind=expenses`}
      >
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 p-3">
          {expenseRollup.map((e) => (
            <div
              key={e.branch}
              className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3"
            >
              <h3 className="text-sm font-semibold mb-2">
                {e.branch}{' '}
                <span className="text-zinc-500 font-normal text-xs">
                  RM {e.total.toFixed(2)}
                </span>
              </h3>
              {e.items.length === 0 ? (
                <p className="text-xs text-zinc-500">No expenses.</p>
              ) : (
                <ul className="text-sm divide-y divide-zinc-100 dark:divide-zinc-800">
                  {e.items.map((it) => (
                    <li
                      key={it.item}
                      className="flex items-center justify-between py-1"
                    >
                      <span>{it.item}</span>
                      <span className="tabular-nums">
                        {it.total.toFixed(2)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </ReportSection>

      <ReportSection
        title="EXTRA reconciliation"
        href={`${csvBase}&kind=uncovered-extras`}
      >
        {uncovered.length === 0 ? (
          <p className="px-4 py-6 text-sm text-center text-zinc-500">
            No uncovered EXTRA rows in this cycle.
          </p>
        ) : (
          <table className="min-w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wide text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="px-2 py-1 text-left">Date</th>
                <th className="px-2 py-1 text-left">Source branch</th>
                <th className="px-2 py-1 text-left">Staff</th>
                <th className="px-2 py-1 text-left">Course/Dur</th>
                <th className="px-2 py-1 text-left">Method</th>
                <th className="px-2 py-1 text-right">Commission</th>
              </tr>
            </thead>
            <tbody>
              {uncovered.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-zinc-100 dark:border-zinc-800"
                >
                  <td className="px-2 py-1 font-mono">{r.businessDate}</td>
                  <td className="px-2 py-1">{r.branch}</td>
                  <td className="px-2 py-1">{r.staff}</td>
                  <td className="px-2 py-1">
                    {r.course} / {r.duration}
                  </td>
                  <td className="px-2 py-1">{r.method}</td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {r.totalCommission.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ReportSection>
    </div>
  )
}

function ReportSection({
  title,
  href,
  children,
}: {
  title: string
  href: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      <header className="px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/40 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide">
          {title}
        </h2>
        <a
          href={href}
          className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800"
        >
          Download CSV
        </a>
      </header>
      <div className="overflow-x-auto">{children}</div>
    </section>
  )
}
