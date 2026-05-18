'use client'

/**
 * heals-system-rebuild — FreelanceMiniSummary (Task 10.7)
 *
 * Side-panel showing freelance session totals separately from the
 * regular EarningsPanel. Freelance staff are paid outside the salary
 * board (Req 18.2), so their numbers live here for the cashier's
 * day-end reconciliation.
 *
 * Source: rows whose `method.toLowerCase().trim() === 'freelance'`.
 * Aggregated by staff name (case-insensitive).
 */

import { useMemo } from 'react'

import { useCashier } from '../CashierContext'
import PanelShell from './PanelShell'

export default function FreelanceMiniSummary() {
  const { transactions } = useCashier()

  const rows = useMemo(() => {
    const sums = new Map<string, { name: string; total: number; count: number }>()
    for (const tx of transactions) {
      if (String(tx.method).trim().toLowerCase() !== 'freelance') continue
      const lc = tx.staff.trim().toLowerCase()
      const cur = sums.get(lc)
      if (cur) {
        cur.total += Number(tx.totalCommission) || 0
        cur.count += 1
      } else {
        sums.set(lc, {
          name: tx.staff.trim(),
          total: Number(tx.totalCommission) || 0,
          count: 1,
        })
      }
    }
    return Array.from(sums.values()).sort(
      (a, b) => b.total - a.total || a.name.localeCompare(b.name),
    )
  }, [transactions])

  const grandTotal = rows.reduce((s, r) => s + r.total, 0)
  const sessions = rows.reduce((s, r) => s + r.count, 0)

  return (
    <PanelShell title="Freelance" icon="🤝" defaultOpen>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">No freelance sessions today.</p>
      ) : (
        <table className="min-w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            <tr>
              <th className="text-left font-medium py-1">Staff</th>
              <th className="text-right font-medium py-1">Sessions</th>
              <th className="text-right font-medium py-1">RM</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.name}
                className="border-t border-zinc-100 dark:border-zinc-800"
              >
                <td className="py-1">{r.name}</td>
                <td className="py-1 text-right tabular-nums">{r.count}</td>
                <td className="py-1 text-right tabular-nums">
                  {r.total.toFixed(2)}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-zinc-300 dark:border-zinc-700 font-semibold">
              <td className="py-1.5">Total</td>
              <td className="py-1.5 text-right tabular-nums">{sessions}</td>
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
