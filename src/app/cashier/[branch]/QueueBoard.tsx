'use client'

/**
 * heals-system-rebuild — QueueBoard (Task 10.3)
 *
 * Renders the live queue order for the day. The cashier reads this
 * to decide who serves the next walk-in.
 *
 * Queue logic comes from `buildQueue` in `@/domain/queue`:
 *   1. Anyone with zero today-earnings → top (new for the day)
 *   2. Otherwise sort by today-earnings ascending (less earned = up)
 *   3. Tie → sort by yesterday-earnings ascending (the swap rule —
 *      whoever earned LESS yesterday goes higher today)
 *   4. Final tie → name ascending (deterministic)
 *   5. Busy staff (currently in a session) held at position 0 until
 *      their time_out
 *
 * The "today's roster" is exactly the staff whose names appear in the
 * top-7 rows of the SessionTable (per the user's workflow). We derive
 * it locally rather than reading `daily_roster` so the board updates
 * the moment the cashier types a name in the table.
 *
 * Updates every second via `setInterval` so countdowns tick and busy
 * staff transition to free at exactly their `time_out`.
 */

import { useEffect, useMemo, useState } from 'react'

import { buildQueue, type QueueEntry } from '@/domain/queue'
import type { TransactionRow } from '@/domain/types'
import { useCashier } from './CashierContext'

const TOP_ROSTER_SIZE = 7

function formatCountdown(busyUntil: string | undefined, nowKL: string): string {
  if (!busyUntil) return ''
  // HH:mm strings — convert to minutes since midnight for a quick diff.
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map((x) => parseInt(x, 10))
    if (!Number.isFinite(h) || !Number.isFinite(m)) return 0
    return h * 60 + m
  }
  const diff = toMin(busyUntil) - toMin(nowKL)
  if (diff <= 0) return 'free in 0m'
  return `${diff}m left`
}

/** Return current KL HH:mm. We keep this client-side; the salary
 *  attribution doesn't depend on this — only the visual countdown. */
function nowKL(): string {
  const d = new Date()
  // Asia/Kuala_Lumpur is UTC+8 with no DST; computing offset locally
  // keeps the bundle clean of date-fns-tz here.
  const kl = new Date(d.getTime() + (8 * 60 - -d.getTimezoneOffset()) * 60 * 1000)
  // The math above intentionally constructs a Date whose UTC fields
  // match KL wall-clock; .getUTCHours()/.getUTCMinutes() then read
  // the KL hour/minute regardless of the host machine's timezone.
  const hh = String(kl.getUTCHours()).padStart(2, '0')
  const mm = String(kl.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

export default function QueueBoard() {
  const { transactions, yesterdayTransactions, dailyRoster, businessDate, branch } =
    useCashier()

  // Source of truth for "who is working today":
  //   1. Saved daily_roster (managed via the RosterPanel modal).
  //   2. Otherwise the first 7 distinct staff names typed in the
  //      table — supports the legacy Sheet workflow where you set the
  //      queue order by typing names in the top of the table.
  const todayRoster = useMemo(() => {
    if (dailyRoster.length > 0) return dailyRoster
    const seen = new Set<string>()
    const names: string[] = []
    const sorted = [...transactions].sort(
      (a, b) => a.cashierRowNumber - b.cashierRowNumber,
    )
    for (const tx of sorted) {
      const name = tx.staff.trim()
      if (!name) continue
      const lc = name.toLowerCase()
      if (seen.has(lc)) continue
      seen.add(lc)
      names.push(name)
      if (names.length >= TOP_ROSTER_SIZE) break
    }
    return names
  }, [transactions, dailyRoster])

  // Yesterday's rows feed the secondary tie-break ("whoever earned
  // less yesterday goes higher today" — the swap rule). The page
  // server-fetches them and threads them through context; if the
  // backfill fails (empty array), the queue degrades to name-ASC
  // tie-break which is still deterministic.
  const yesterdayRows = useMemo(
    () => yesterdayTransactions,
    [yesterdayTransactions],
  )

  const [now, setNow] = useState(nowKL())
  useEffect(() => {
    const id = setInterval(() => setNow(nowKL()), 1000)
    return () => clearInterval(id)
  }, [])

  const queue = useMemo<QueueEntry[]>(() => {
    if (todayRoster.length === 0) return []
    return buildQueue({
      branch,
      businessDate,
      todayRows: transactions.map(toQueueRow),
      yesterdayRows: yesterdayRows.map(toQueueRow),
      todayRoster,
      nowKL: now,
    })
  }, [todayRoster, transactions, yesterdayRows, businessDate, branch, now])

  if (queue.length === 0) {
    return (
      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 text-sm text-zinc-500">
        Set today&apos;s roster (top-right of the page) or type staff names in
        the table to start the queue.
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      <header className="px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/40">
        <h2 className="text-sm font-semibold uppercase tracking-wide">
          Queue
        </h2>
      </header>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {queue.map((entry) => (
          <li
            key={entry.staff}
            className={[
              'flex items-center gap-3 px-4 py-2 text-sm',
              entry.status === 'busy'
                ? 'bg-amber-50/60 dark:bg-amber-950/20'
                : entry.position === 1
                ? 'bg-[var(--theme-accent)]/15'
                : '',
            ].join(' ')}
          >
            <span
              className={[
                'inline-flex items-center justify-center h-7 w-7 rounded-full font-bold text-xs',
                entry.status === 'busy'
                  ? 'bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100'
                  : 'bg-[var(--theme-primary)] text-[var(--theme-primary-foreground)]',
              ].join(' ')}
            >
              {entry.status === 'busy' ? '⏱' : entry.position}
            </span>
            <span className="font-medium flex-1">{entry.staff}</span>
            <span className="text-xs text-zinc-500 tabular-nums">
              {entry.status === 'busy'
                ? `${entry.course ?? ''} (${entry.duration ?? ''}m) ${entry.timeIn ?? ''} → ${entry.busyUntil ?? ''} · ${formatCountdown(entry.busyUntil, now)}`
                : 'Free'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Project a `TransactionRow` (heals contract) into the `QueueRow`
 * shape `buildQueue` expects (salary-system-rebuild contract). The
 * queue engine pre-dates the heals row shape — projection keeps the
 * one-line bridge here so neither side has to change.
 */
function toQueueRow(tx: TransactionRow) {
  return {
    staff: tx.staff,
    branch: tx.branch,
    businessDate: tx.businessDate,
    method: tx.method,
    commission: tx.totalCommission,
    timeIn: tx.timeIn,
    timeOut: tx.timeOut,
    duration: tx.duration,
    course: tx.course,
  }
}
