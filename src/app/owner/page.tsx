// Boss HQ — Command Center (Google Sheets edition)
//
// Today's snapshot across all branches. Reads directly from the
// Cashier_POS Google Sheet via the Visualization API.

import Link from 'next/link'

import { getBusinessDate } from '@/domain/business-date'
import { BRANCHES, type Branch } from '@/domain/types'
import { fetchAllBranches, type CashierRow } from '@/lib/sheets'

export const dynamic = 'force-dynamic'

function isFreelance(method: string): boolean {
  return method.trim().toLowerCase() === 'freelance'
}

interface BranchStats {
  sales: number
  cash: number
  qr: number
  credit: number
  sessions: number
  freelance: number
}

function computeBranchStats(
  rows: CashierRow[],
  branch: Branch,
  today: string,
): BranchStats {
  const stats: BranchStats = {
    sales: 0,
    cash: 0,
    qr: 0,
    credit: 0,
    sessions: 0,
    freelance: 0,
  }

  for (const r of rows) {
    if (r.branch !== branch) continue
    if (r.businessDate !== today) continue

    if (isFreelance(r.method)) {
      stats.freelance += r.commission
      continue
    }

    stats.sales += r.price
    stats.cash += r.cash
    stats.qr += r.qr
    stats.credit += r.credit
    stats.sessions += 1
  }

  return stats
}

export default async function CommandCenterPage() {
  const today = getBusinessDate(new Date())
  const allRows = await fetchAllBranches()

  // Filter to today's rows only
  const todayRows = allRows.filter((r) => r.businessDate === today)

  const perBranch = Object.fromEntries(
    BRANCHES.map((b) => [b, computeBranchStats(allRows, b, today)]),
  ) as Record<Branch, BranchStats>

  const groupTotal = BRANCHES.reduce(
    (acc, b) => {
      const c = perBranch[b]
      return {
        sales: acc.sales + c.sales,
        cash: acc.cash + c.cash,
        qr: acc.qr + c.qr,
        credit: acc.credit + c.credit,
        sessions: acc.sessions + c.sessions,
        freelance: acc.freelance + c.freelance,
      }
    },
    { sales: 0, cash: 0, qr: 0, credit: 0, sessions: 0, freelance: 0 },
  )

  // Recent activity: last 10 rows across all branches
  const recent = todayRows.slice(-10).reverse()

  const now = new Date().toLocaleString('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold">
            Command Center
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Business date: <span className="font-mono">{today}</span>
          </p>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
            Last refreshed: {now} ·{' '}
            <Link
              href="/owner"
              className="underline hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              ⟳ Refresh
            </Link>
          </p>
        </div>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {BRANCHES.map((b) => (
          <BranchCard
            key={b}
            title={b}
            stats={perBranch[b]}
          />
        ))}
        <BranchCard title="All branches" stats={groupTotal} highlight />
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
            {recent.map((r, i) => (
              <li
                key={`${r.branch}-${r.rowNum}-${i}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
              >
                <span className="inline-flex items-center rounded-md bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs font-medium uppercase tracking-wide">
                  {r.branch}
                </span>
                <span className="font-medium capitalize">{r.staff}</span>
                <span className="text-zinc-500">{r.course}</span>
                <span className="text-zinc-500">{r.method}</span>
                <span className="ml-auto font-mono text-xs text-zinc-500">
                  {r.timeIn || r.timeOut || '—'}
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
  stats,
  highlight,
}: {
  title: string
  stats: BranchStats
  highlight?: boolean
}) {
  const cls = [
    'block rounded-2xl border p-5',
    highlight
      ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900'
      : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900',
  ].join(' ')

  return (
    <div className={cls}>
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <h3 className="text-2xl font-bold truncate">{title}</h3>
        <span className="text-xs uppercase tracking-wide opacity-60">
          {stats.sessions} {stats.sessions === 1 ? 'session' : 'sessions'}
        </span>
      </div>
      <div className="mb-4">
        <div className="text-xs uppercase tracking-wide opacity-60">Sales</div>
        <div className="text-4xl font-semibold tabular-nums leading-tight">
          {stats.sales.toFixed(2)}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <Cell label="Cash" v={stats.cash} />
        <Cell label="QR" v={stats.qr} />
        <Cell label="Credit" v={stats.credit} />
        <Cell label="Freelance" v={stats.freelance} />
      </dl>
    </div>
  )
}

function Cell({ label, v }: { label: string; v: number }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide opacity-60">{label}</dt>
      <dd className="tabular-nums text-lg">{v.toFixed(2)}</dd>
    </div>
  )
}
