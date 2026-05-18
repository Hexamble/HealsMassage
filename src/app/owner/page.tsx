// heals-system-rebuild — Owner Command Center (Task 16.1)
//
// Today-at-a-glance overview of all three branches plus a group total.
// Shows Sales / Cash / QR / Credit / Sessions per branch and a recent
// activity feed. Aggregates are computed server-side on every render;
// a client-side `<OwnerLiveRefresh />` triggers a router refresh on
// every realtime event so the numbers update within ~5s of any cashier
// write (Req 12.3, 8.2).
//
// Validates: Requirements 12.1, 12.2, 12.3, 12.4.

import Link from 'next/link'

import { getBusinessDate } from '@/domain/business-date'
import { computeDayBranchIncome } from '@/domain/income-board'
import {
  BRANCHES,
  type Branch,
  type ExpenseRow,
  type TransactionRow,
} from '@/domain/types'
import { createServerSupabaseClient } from '@/lib/supabase/server'

import OwnerLiveRefresh from './OwnerLiveRefresh'

export const dynamic = 'force-dynamic'

interface RecentTxRow {
  id: string
  branch: Branch
  staff: string
  course: string
  method: string
  time_in: string | null
  time_out: string | null
  created_at: string
}

function n(v: unknown): number {
  if (typeof v === 'number') return v
  if (v == null) return 0
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

export default async function CommandCenterPage() {
  const today = getBusinessDate(new Date())
  const sb = createServerSupabaseClient()

  const [txRes, expRes, recentRes] = await Promise.all([
    sb.from('transactions').select('*').eq('business_date', today),
    sb.from('expenses').select('*').eq('business_date', today),
    sb
      .from('transactions')
      .select(
        'id, branch, staff, course, method, time_in, time_out, created_at',
      )
      .eq('business_date', today)
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  // Map snake_case rows into the heals camelCase shape the income-board
  // helper expects.
  const txns: TransactionRow[] = ((txRes.data ?? []) as Record<
    string,
    unknown
  >[]).map((r) => ({
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
  }))
  const expenses: ExpenseRow[] = ((expRes.data ?? []) as Record<
    string,
    unknown
  >[]).map((r) => ({
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
  }))
  const recent = (recentRes.data ?? []) as RecentTxRow[]

  const perBranch = Object.fromEntries(
    BRANCHES.map((b) => [b, computeDayBranchIncome(txns, expenses, b, today)]),
  ) as Record<Branch, ReturnType<typeof computeDayBranchIncome>>

  const groupTotal = BRANCHES.reduce(
    (acc, b) => {
      const c = perBranch[b]
      return {
        sales: acc.sales + c.sales,
        cash: acc.cash + c.cash,
        qr: acc.qr + c.qr,
        credit: acc.credit + c.credit,
        sessions: acc.sessions + c.sessions,
        netIncome: acc.netIncome + c.netIncome,
      }
    },
    { sales: 0, cash: 0, qr: 0, credit: 0, sessions: 0, netIncome: 0 },
  )

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-semibold">
              Command Center
            </h1>
            <OwnerLiveRefresh />
          </div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Business date: <span className="font-mono">{today}</span>
          </p>
        </div>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {BRANCHES.map((b) => (
          <BranchCard
            key={b}
            title={b}
            sales={perBranch[b].sales}
            cash={perBranch[b].cash}
            qr={perBranch[b].qr}
            credit={perBranch[b].credit}
            sessions={perBranch[b].sessions}
            netIncome={perBranch[b].netIncome}
            href={`/cashier/${b}`}
          />
        ))}
        <BranchCard
          title="All branches"
          sales={groupTotal.sales}
          cash={groupTotal.cash}
          qr={groupTotal.qr}
          credit={groupTotal.credit}
          sessions={groupTotal.sessions}
          netIncome={groupTotal.netIncome}
          highlight
        />
      </section>

      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
        <h2 className="text-sm uppercase tracking-wide text-zinc-500 mb-3">
          Recent activity
        </h2>
        {recent.length === 0 ? (
          <p className="text-sm text-zinc-500 italic">
            No transactions logged today yet.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {recent.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
              >
                <span className="inline-flex items-center rounded-md bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs font-medium uppercase tracking-wide">
                  {r.branch}
                </span>
                <span className="font-medium capitalize">{r.staff}</span>
                <span className="text-zinc-500">{r.course}</span>
                <span className="text-zinc-500">{r.method}</span>
                <span className="ml-auto font-mono text-xs text-zinc-500">
                  {r.time_in ?? r.time_out ?? formatHHmm(r.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function BranchCard({
  title,
  sales,
  cash,
  qr,
  credit,
  sessions,
  netIncome,
  highlight,
  href,
}: {
  title: string
  sales: number
  cash: number
  qr: number
  credit: number
  sessions: number
  netIncome: number
  highlight?: boolean
  href?: string
}) {
  const cls = [
    'block rounded-2xl border p-5 transition-colors',
    highlight
      ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900'
      : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900',
    href ? 'hover:shadow-sm' : '',
  ].join(' ')

  const body = (
    <>
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <h3 className="text-2xl font-bold truncate">{title}</h3>
        <span className="text-xs uppercase tracking-wide opacity-60">
          {sessions} {sessions === 1 ? 'session' : 'sessions'}
        </span>
      </div>
      <div className="mb-4">
        <div className="text-xs uppercase tracking-wide opacity-60">Sales</div>
        <div className="text-4xl font-semibold tabular-nums leading-tight">
          {sales.toFixed(2)}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <Cell label="Cash" v={cash} />
        <Cell label="QR" v={qr} />
        <Cell label="Credit" v={credit} />
        <Cell label="Net" v={netIncome} bold />
      </dl>
    </>
  )

  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}

function Cell({
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
      <dt className="text-xs uppercase tracking-wide opacity-60">{label}</dt>
      <dd
        className={`tabular-nums text-lg ${bold ? 'font-semibold' : ''}`}
      >
        {v.toFixed(2)}
      </dd>
    </div>
  )
}

function formatHHmm(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Kuala_Lumpur',
    })
  } catch {
    return ''
  }
}
