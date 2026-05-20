// heals-system-rebuild — Heals Thai Massage POS
// Cashier landing page (Server Component).
//
// Fetches every snapshot the cashier needs at first paint:
//   - Today's `transactions` for this branch (sorted by cashier_row_number).
//   - Today's `expenses` for this branch.
//   - Active staff roster (branch staff + freelancers from any branch).
//   - Full price table.
//   - Regular + freelance commission rate tables (effective_from versioned).
//
// Hands it all to the `<CashierProvider>` client tree which then takes
// over with realtime subscriptions, optimistic updates, the offline
// drain worker, and morning-reset polling. The provider is the single
// place where state goes after this server-side fetch.
//
// Layout:
//   ┌────────────────────────────────────────────────────────────┐
//   │  Header (branch + Connection + Pending sync badge)         │
//   ├────────────────────────────────────────────────────────────┤
//   │  RosterPanel — today's queue order + roster manager         │
//   ├──────────────────────────┬─────────────────────────────────┤
//   │  SessionTable            │  QueueBoard                      │
//   │  (the main editable      │  (live queue, who serves next)   │
//   │   spreadsheet)           │                                  │
//   ├──────────────────────────┴─────────────────────────────────┤
//   │  ExpenseBlock                                                │
//   ├────────────────────────────────────────────────────────────┤
//   │  Summary | Earnings | Freelance — three panels side-by-side │
//   └────────────────────────────────────────────────────────────┘
//
// `dynamic = 'force-dynamic'` opts out of static caching so every page
// view reads the freshest snapshot from Postgres before realtime takes
// over.

import { notFound } from 'next/navigation'
import Link from 'next/link'

import {
  BRANCHES,
  type Branch,
  type ExpenseRow,
  type StaffMember,
  type TransactionRow,
} from '@/domain/types'
import type {
  FreelanceRateRow,
  PriceRow,
  RegularRateRow,
} from '@/domain/commission'
import { getBusinessDate } from '@/domain/business-date'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/profile'
import ThemeToggle from '@/components/ThemeToggle'

import { CashierProvider } from './CashierContext'
import ConnectionIndicator from './ConnectionIndicator'
import ExpenseBlock from './ExpenseBlock'
import PendingSyncBadge from './PendingSyncBadge'
import QueueBoard from './QueueBoard'
import RosterPanel from './RosterPanel'
import SessionTable from './SessionTable'
import EarningsPanel from './panels/EarningsPanel'
import FreelanceMiniSummary from './panels/FreelanceMiniSummary'
import SummaryPanel from './panels/SummaryPanel'
import Toaster from '@/components/cashier/Toaster'
import RefreshButton from '@/components/cashier/RefreshButton'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// Row-mapping helpers (snake_case → heals camelCase)
// ---------------------------------------------------------------------------

function asNum(v: unknown): number {
  if (typeof v === 'number') return v
  if (v == null) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
function asStr(v: unknown): string {
  return v == null ? '' : String(v)
}
function asNullStr(v: unknown): string | null {
  return v == null ? null : String(v)
}

function mapTxRow(row: Record<string, unknown>): TransactionRow {
  return {
    id: asStr(row.id),
    branch: asStr(row.branch) as Branch,
    businessDate: asStr(row.business_date),
    cashierRowNumber: asNum(row.cashier_row_number),
    staff: asStr(row.staff),
    course: asStr(row.course) as TransactionRow['course'],
    duration: asNum(row.duration) as TransactionRow['duration'],
    timeIn: asNullStr(row.time_in),
    timeOut: asNullStr(row.time_out),
    method: asStr(row.method),
    addon: asNum(row.addon),
    baseCommission: asNum(row.base_commission),
    balmBonus: asNum(row.balm_bonus),
    bookingBonus: asNum(row.booking_bonus),
    totalCommission: asNum(row.total_commission),
    cash: asNum(row.cash),
    qr: asNum(row.qr),
    credit: asNum(row.credit),
    price: asNum(row.price),
    flags: asStr(row.flags),
    comment: asStr(row.comment),
    createdAt: asStr(row.created_at),
    updatedAt: asStr(row.updated_at),
    createdBy: asNullStr(row.created_by),
  }
}

function mapExpense(row: Record<string, unknown>): ExpenseRow {
  return {
    id: asStr(row.id),
    branch: asStr(row.branch) as Branch,
    businessDate: asStr(row.business_date),
    item: asStr(row.item),
    amount: asNum(row.amount),
    method: asStr(row.method) as ExpenseRow['method'],
    note: asStr(row.note),
    source: asStr(row.source) as ExpenseRow['source'],
    createdAt: asStr(row.created_at),
    createdBy: asNullStr(row.created_by),
  }
}

function mapStaff(row: Record<string, unknown>): StaffMember {
  return {
    id: asStr(row.id),
    name: asStr(row.name),
    homeBranch: asStr(row.home_branch) as Branch,
    isFreelance: Boolean(row.is_freelance),
    isActive: Boolean(row.is_active),
  }
}

function mapPrice(row: Record<string, unknown>): PriceRow {
  return {
    course: asStr(row.course) as PriceRow['course'],
    duration: asNum(row.duration) as PriceRow['duration'],
    branch: asStr(row.branch) as Branch,
    price: asNum(row.price),
  }
}

function mapRate(
  row: Record<string, unknown>,
): RegularRateRow & FreelanceRateRow {
  // The two interfaces share the same shape; the route call below
  // splits them by rate_type after the fetch.
  return {
    course: asStr(row.course) as RegularRateRow['course'],
    duration: asNum(row.duration) as RegularRateRow['duration'],
    branchGroup: asStr(row.branch_group),
    amount: asNum(row.amount),
    effectiveFrom: asStr(row.effective_from),
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function CashierPage({
  params,
}: {
  params: { branch: string }
}) {
  if (!(BRANCHES as readonly string[]).includes(params.branch)) {
    notFound()
  }
  const branch = params.branch as Branch
  const businessDate = getBusinessDate(new Date())
  const sb = createServerSupabaseClient()
  const profile = await getCurrentProfile()
  const isOwner = profile?.role === 'owner'
  const isCrossBranchPeek =
    profile?.role === 'cashier' && profile.branch !== branch

  // Pure UTC date arithmetic for yesterday — no DST/TZ bias.
  const [y, m, d] = businessDate.split('-').map((p) => parseInt(p, 10))
  const yesterdayObj = new Date(Date.UTC(y, m - 1, d))
  yesterdayObj.setUTCDate(yesterdayObj.getUTCDate() - 1)
  const yyy = yesterdayObj.getUTCFullYear()
  const mm = String(yesterdayObj.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(yesterdayObj.getUTCDate()).padStart(2, '0')
  const yesterday = `${yyy}-${mm}-${dd}`

  // Parallel fetch — every panel needs at least one of these.
  const [
    txRes,
    expRes,
    staffRes,
    priceRes,
    rateRes,
    yesterdayRes,
    rosterRes,
  ] = await Promise.all([
    sb
      .from('transactions')
      .select('*')
      .eq('branch', branch)
      .eq('business_date', businessDate)
      .order('cashier_row_number', { ascending: true }),
    sb
      .from('expenses')
      .select('*')
      .eq('branch', branch)
      .eq('business_date', businessDate),
    sb
      .from('staff')
      .select('*')
      .eq('is_active', true)
      .order('name'),
    sb.from('prices').select('*'),
    sb
      .from('commission_rates')
      .select(
        'course, duration, rate_type, branch_group, amount, effective_from',
      ),
    sb
      .from('transactions')
      .select('*')
      .eq('branch', branch)
      .eq('business_date', yesterday),
    sb
      .from('daily_roster')
      .select('staff_id, staff:staff_id(name)')
      .eq('branch', branch)
      .eq('business_date', businessDate),
  ])

  const initialTransactions = (
    (txRes.data ?? []) as Record<string, unknown>[]
  ).map(mapTxRow)
  const initialYesterdayTransactions = (
    (yesterdayRes.data ?? []) as Record<string, unknown>[]
  ).map(mapTxRow)
  const initialExpenses = (
    (expRes.data ?? []) as Record<string, unknown>[]
  ).map(mapExpense)
  const initialRoster = (
    (staffRes.data ?? []) as Record<string, unknown>[]
  ).map(mapStaff)
  const initialPrices = (
    (priceRes.data ?? []) as Record<string, unknown>[]
  ).map(mapPrice)

  const allRates = ((rateRes.data ?? []) as Record<string, unknown>[]).map(
    (r) => ({ ...mapRate(r), rateType: asStr(r.rate_type) }),
  )
  const initialRegularRates: RegularRateRow[] = allRates
    .filter((r) => r.rateType === 'regular')
    .map(({ rateType: _t, ...rest }) => rest)
  const initialFreelanceRates: FreelanceRateRow[] = allRates
    .filter((r) => r.rateType === 'freelance')
    .map(({ rateType: _t, ...rest }) => rest)

  // Saved daily roster names (from `daily_roster` table). The
  // QueueBoard uses these — when the cashier picks staff in the
  // roster modal, those names appear in the queue immediately,
  // before any session row has been entered.
  const initialDailyRoster: string[] = (
    (rosterRes.data ?? []) as Array<{ staff?: { name?: string } | null }>
  )
    .map((r) => r.staff?.name ?? '')
    .filter((n) => n.length > 0)

  return (
    <CashierProvider
      branch={branch}
      businessDate={businessDate}
      initialTransactions={initialTransactions}
      initialExpenses={initialExpenses}
      initialRoster={initialRoster}
      initialPrices={initialPrices}
      initialRegularRates={initialRegularRates}
      initialFreelanceRates={initialFreelanceRates}
      initialYesterdayTransactions={initialYesterdayTransactions}
      initialDailyRoster={initialDailyRoster}
      readOnly={isCrossBranchPeek}
    >
      <div className="mx-auto max-w-[1600px] space-y-3 p-3 sm:p-4">
        <header className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-2 border-l-8 border-l-[var(--theme-primary)]">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-semibold flex items-center gap-2">
              <span
                aria-hidden
                className="inline-block h-3 w-3 rounded-full bg-[var(--theme-primary)]"
              />
              {branch}
            </h1>
            <p className="text-xs text-zinc-500 font-mono">{businessDate}</p>
          </div>
          <div className="flex items-center gap-2">
            <PendingSyncBadge />
            <ConnectionIndicator />
            <RefreshButton />
            {isCrossBranchPeek && (
              <span className="text-[10px] bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 rounded-full px-2 py-0.5 font-medium">
                👁 View only
              </span>
            )}
            {isOwner && (
              <Link
                href="/owner"
                className="text-xs rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                title="Back to Boss HQ"
              >
                ← Boss HQ
              </Link>
            )}
            {(['Kimberry', 'Bishop', 'Chulia'] as const)
              .filter((b) => b !== branch)
              .map((b) => (
                <Link
                  key={b}
                  href={`/cashier/${b}`}
                  className="text-[10px] rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                  title={`Peek at ${b}`}
                >
                  {b.slice(0, 3)}
                </Link>
              ))}
            <ThemeToggle />
            <form action="/auth/sign-out" method="post">
              <button
                type="submit"
                className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 px-2"
              >
                Sign out
              </button>
            </form>
            <span className="text-[9px] text-zinc-400 font-mono" title="Build version">v8</span>
          </div>
        </header>

        <RosterPanel />

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-3">
          <SessionTable />
          <QueueBoard />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <SummaryPanel />
          <EarningsPanel />
          <FreelanceMiniSummary />
          <ExpenseBlock />
        </div>
      </div>
      <Toaster />
    </CashierProvider>
  )
}
