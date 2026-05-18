'use client'

/**
 * heals-system-rebuild — EarningsPanel (Task 10.6)
 *
 * Per-staff today's commission breakdown for the current branch.
 * Excludes freelance rows entirely (those go in the FreelanceMini
 * panel instead).
 *
 * Uses the canonical-view algorithm from `salary-board` so EXTRA
 * fallback / coverage rules apply identically to the salary board
 * the boss sees — keeping the cashier-side preview honest with the
 * day's eventual payout numbers.
 */

import { useMemo } from 'react'

import {
  buildCanonicalView,
  type CanonicalEntry,
} from '@/domain/salary-board'
import { useCashier } from '../CashierContext'
import PanelShell from './PanelShell'

interface EarningRow {
  staff: string
  total: number
}

export default function EarningsPanel() {
  const { transactions, branch } = useCashier()

  const rows = useMemo<EarningRow[]>(() => {
    const canonical = buildCanonicalView(transactions)
    // Aggregate only the entries attributed to THIS branch — we want
    // the cashier to see what they're paying out today at this shop,
    // not other branches' fallback shares.
    const sums = new Map<string, { name: string; total: number }>()
    for (const e of canonical as CanonicalEntry[]) {
      if (e.branch !== branch) continue
      const cur = sums.get(e.staffLc)
      if (cur) cur.total += e.total
      else sums.set(e.staffLc, { name: e.staffDisplay, total: e.total })
    }
    return Array.from(sums.values())
      .map((v) => ({ staff: v.name, total: v.total }))
      .sort((a, b) => b.total - a.total || a.staff.localeCompare(b.staff))
  }, [transactions, branch])

  const grandTotal = rows.reduce((s, r) => s + r.total, 0)

  return (
    <PanelShell title="Earnings (today)" icon="💰" defaultOpen>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">No earnings yet today.</p>
      ) : (
        <table className="min-w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            <tr>
              <th className="text-left font-medium py-1">Staff</th>
              <th className="text-right font-medium py-1">RM</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.staff}
                className="border-t border-zinc-100 dark:border-zinc-800"
              >
                <td className="py-1">{r.staff}</td>
                <td className="py-1 text-right tabular-nums">
                  {r.total.toFixed(2)}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-zinc-300 dark:border-zinc-700 font-semibold">
              <td className="py-1.5">Total</td>
              <td className="py-1.5 text-right tabular-nums">
                {grandTotal.toFixed(2)}
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </PanelShell>
  )
}
