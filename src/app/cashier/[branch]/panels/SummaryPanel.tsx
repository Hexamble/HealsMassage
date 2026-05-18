'use client'

/**
 * heals-system-rebuild — SummaryPanel (Task 10.5)
 *
 * Today's totals at a glance for the current branch:
 *   - Sales (sum of price for non-freelance rows)
 *   - Cash / QR / Credit subtotals
 *   - Sessions count (excluding freelance)
 *
 * All values come from `useCashier().transactions`, which the
 * provider keeps in sync with the DB via realtime + optimistic
 * updates.
 */

import { useMemo } from 'react'

import { computeDayBranchIncome } from '@/domain/income-board'
import { useCashier } from '../CashierContext'
import PanelShell from './PanelShell'

export default function SummaryPanel() {
  const { transactions, expenses, branch, businessDate } = useCashier()
  const summary = useMemo(
    () =>
      computeDayBranchIncome(transactions, expenses, branch, businessDate),
    [transactions, expenses, branch, businessDate],
  )

  return (
    <PanelShell title="Summary" icon="📊" defaultOpen>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm tabular-nums">
        <Row label="Sales" value={summary.sales} bold />
        <Row label="Sessions" value={summary.sessions} integer />
        <Row label="Cash" value={summary.cash} />
        <Row label="QR" value={summary.qr} />
        <Row label="Credit" value={summary.credit} />
        <Row label="Collected (cash+qr)" value={summary.collected} />
        <Row label="Freelance" value={summary.freelance} />
        <Row label="Expenses" value={summary.expenses} />
        <Row label="Net income" value={summary.netIncome} bold />
      </dl>
    </PanelShell>
  )
}

function Row({
  label,
  value,
  bold,
  integer,
}: {
  label: string
  value: number
  bold?: boolean
  integer?: boolean
}) {
  return (
    <>
      <dt className="text-zinc-600 dark:text-zinc-400">{label}</dt>
      <dd
        className={[
          'text-right',
          bold ? 'font-semibold' : '',
        ].join(' ')}
      >
        {integer ? value : value.toFixed(2)}
      </dd>
    </>
  )
}
