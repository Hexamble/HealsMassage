// heals-system-rebuild — Owner Salary Board (Task 14.1)
//
// Per-branch + multi-branch summary of staff commissions for a pay
// cycle, with the EXTRA fallback rule applied so a Kimberry-home
// staff who works at Bishop sees their commission credited correctly
// regardless of whether each branch logged the row.
//
// Pay-cycle navigation:
//   - The page accepts `?monthIdx=4&year=2026` to view any cycle.
//   - When unset, it defaults to the cycle that contains today.
//   - The cycle start day is read from `settings.pay_cycle_start_day`.
//
// Historical backfill: the cashier-side page allows owner historical
// edits, but the salary board itself is read-only (the owner edits
// individual cells via the cashier route or the Time Machine).
//
// Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 18.2.

import { cycleDates } from '@/domain/cycle'
import { getBusinessDate } from '@/domain/business-date'
import { buildSalaryBoard } from '@/domain/salary-board'
import {
  BRANCHES,
  type Branch,
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

  // Fetch every transaction in the cycle window, plus the staff roster
  // (active + inactive — we still want to render historical staff).
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

  const board = buildSalaryBoard(txns, roster, cycle)

  // Build prev/next cycle links so the owner can paginate.
  const prevMonthIdx = monthIdx === 0 ? 11 : monthIdx - 1
  const prevYear = monthIdx === 0 ? year - 1 : year
  const nextMonthIdx = monthIdx === 11 ? 0 : monthIdx + 1
  const nextYear = monthIdx === 11 ? year + 1 : year

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold">Salary Board</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Cycle: <span className="font-mono">{cycle.startDate}</span> →{' '}
            <span className="font-mono">{cycle.endDate}</span> · Day{' '}
            {payCycleStartDay} start
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`?monthIdx=${prevMonthIdx}&year=${prevYear}`}
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            ← Prev cycle
          </a>
          <a
            href={`?monthIdx=${nextMonthIdx}&year=${nextYear}`}
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            Next cycle →
          </a>
        </div>
      </header>

      {BRANCHES.map((b) => {
        const sec = board.perBranch[b]
        if (!sec) return null
        return (
          <BranchSection
            key={b}
            title={b}
            staff={sec.staff}
            total={sec.total}
            days={cycle.days}
            today={today}
          />
        )
      })}

      {board.multiBranch.staff.length > 0 && (
        <BranchSection
          title="Multi-branch summary"
          staff={board.multiBranch.staff}
          total={board.multiBranch.total}
          days={cycle.days}
          today={today}
        />
      )}

      {Object.keys(board.perBranch).length === 0 &&
        board.multiBranch.staff.length === 0 && (
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 text-sm text-zinc-500">
            No transactions in this cycle yet.
          </div>
        )}
    </div>
  )
}

function BranchSection({
  title,
  staff,
  total,
  days,
  today,
}: {
  title: string
  staff: ReadonlyArray<{ name: string; daily: Record<string, number>; total: number }>
  total: number
  days: ReadonlyArray<string>
  today: string
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      <header className="px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/40 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide">
          {title}
        </h2>
        <span className="text-xs text-zinc-500 tabular-nums">
          Total: RM {total.toFixed(2)}
        </span>
      </header>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th className="px-2 py-2 text-left sticky left-0 bg-white dark:bg-zinc-900 z-10">
                Staff
              </th>
              {days.map((d) => (
                <th
                  key={d}
                  className={`px-2 py-2 text-right tabular-nums ${
                    d === today
                      ? 'bg-[var(--theme-accent)]/15 text-zinc-900 dark:text-zinc-50'
                      : ''
                  }`}
                  title={d}
                >
                  {d.slice(8)}
                </th>
              ))}
              <th className="px-2 py-2 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr
                key={s.name}
                className="border-b border-zinc-100 dark:border-zinc-800"
              >
                <td className="px-2 py-1.5 font-medium sticky left-0 bg-white dark:bg-zinc-900">
                  {s.name}
                </td>
                {days.map((d) => {
                  const v = s.daily[d] ?? 0
                  return (
                    <td
                      key={d}
                      className={`px-2 py-1.5 text-right tabular-nums ${
                        d === today ? 'bg-[var(--theme-accent)]/15' : ''
                      } ${v === 0 ? 'text-zinc-300 dark:text-zinc-700' : ''}`}
                    >
                      {v === 0 ? '·' : v.toFixed(2)}
                    </td>
                  )
                })}
                <td className="px-2 py-1.5 text-right font-semibold tabular-nums">
                  {s.total.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
