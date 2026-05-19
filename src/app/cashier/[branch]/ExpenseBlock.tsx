'use client'

/**
 * heals-system-rebuild — ExpenseBlock (Task 10.1)
 *
 * Today's expense entry table for the current branch. Same editable-
 * spreadsheet feel as SessionTable but simpler — only Item, Amount,
 * Method, Note. New rows submit via `writeExpense`; existing rows can
 * be deleted via `deleteExpense`.
 *
 * Validates: Requirements 17.1, 17.2, 17.3, 17.5.
 */

import { useState } from 'react'

import { writeExpense } from '@/app/actions/writeExpense'
import { deleteExpense } from '@/app/actions/deleteExpense'
import type { ExpenseRow } from '@/domain/types'

import { useCashier } from './CashierContext'

const METHOD_OPTIONS = ['CASH', 'QR', 'CREDIT', 'Other'] as const

export default function ExpenseBlock() {
  const {
    expenses,
    branch,
    readOnly,
    addOptimisticExpense,
    replaceOptimisticExpense,
    removeOptimisticExpense,
  } = useCashier()

  const [draftItem, setDraftItem] = useState('')
  const [draftAmount, setDraftAmount] = useState('')
  const [draftMethod, setDraftMethod] =
    useState<(typeof METHOD_OPTIONS)[number]>('CASH')
  const [draftNote, setDraftNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (readOnly) return
    if (!draftItem.trim()) return
    const amount = Number(draftAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Amount must be a positive number')
      return
    }
    setError(null)
    setSaving(true)
    try {
      const result = await writeExpense({
        item: draftItem,
        amount,
        method: draftMethod,
        note: draftNote,
      })
      if (result.ok) {
        addOptimisticExpense(result.row)
        setDraftItem('')
        setDraftAmount('')
        setDraftNote('')
      } else {
        setError(`${result.code}: ${result.message}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function onDelete(row: ExpenseRow) {
    if (readOnly) return
    removeOptimisticExpense(row.id)
    try {
      const result = await deleteExpense({ id: row.id })
      if (!result.ok) {
        // Restore the row.
        replaceOptimisticExpense(row)
        setError(`${result.code}: ${result.message}`)
      }
    } catch (err) {
      replaceOptimisticExpense(row)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const totalAmount = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0)

  return (
    <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      <header className="px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/40 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide">
          Expenses — {branch}
        </h2>
        <div className="text-xs text-zinc-500 tabular-nums">
          Total: RM {totalAmount.toFixed(2)}
        </div>
      </header>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th className="px-2 py-2 text-left">Item</th>
              <th className="px-2 py-2 text-right">Amount</th>
              <th className="px-2 py-2 text-left">Method</th>
              <th className="px-2 py-2 text-left">Note</th>
              <th className="px-2 py-2 text-left">Source</th>
              <th className="px-2 py-2"> </th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((e) => (
              <tr
                key={e.id}
                className="border-b border-zinc-100 dark:border-zinc-800"
              >
                <td className="px-2 py-1.5">{e.item}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {Number(e.amount).toFixed(2)}
                </td>
                <td className="px-2 py-1.5">{e.method}</td>
                <td className="px-2 py-1.5">{e.note}</td>
                <td className="px-2 py-1.5 text-xs text-zinc-500">
                  {e.source}
                </td>
                <td className="px-2 py-1.5 text-right">
                  {!readOnly && (
                    <button
                      type="button"
                      aria-label={`Delete expense ${e.item}`}
                      onClick={() => onDelete(e)}
                      className="text-zinc-400 hover:text-red-600 px-2 py-1"
                    >
                      ×
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {/* Inline-add row */}
            {!readOnly && (
              <tr className="bg-zinc-50/50 dark:bg-zinc-800/30">
                <td className="px-2 py-1.5">
                  <input
                    type="text"
                    aria-label="Expense item"
                    placeholder="Bottled water"
                    value={draftItem}
                    onChange={(e) => setDraftItem(e.target.value)}
                    className="w-full bg-transparent border-0 outline-0 px-2 py-1 text-sm focus:ring-2 focus:ring-[var(--theme-primary)] focus:rounded"
                  />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label="Amount"
                    placeholder="0.00"
                    value={draftAmount}
                    onChange={(e) => setDraftAmount(e.target.value)}
                    className="w-[80px] bg-transparent border-0 outline-0 px-2 py-1 text-sm text-right tabular-nums focus:ring-2 focus:ring-[var(--theme-primary)] focus:rounded"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <select
                    aria-label="Expense method"
                    value={draftMethod}
                    onChange={(e) =>
                      setDraftMethod(
                        e.target.value as (typeof METHOD_OPTIONS)[number],
                      )
                    }
                    className="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 border border-zinc-300 dark:border-zinc-700 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]"
                  >
                    {METHOD_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="text"
                    aria-label="Note"
                    placeholder="Optional"
                    value={draftNote}
                    onChange={(e) => setDraftNote(e.target.value)}
                    className="w-full bg-transparent border-0 outline-0 px-2 py-1 text-sm focus:ring-2 focus:ring-[var(--theme-primary)] focus:rounded"
                  />
                </td>
                <td className="px-2 py-1.5 text-xs text-zinc-400">Cashier</td>
                <td className="px-2 py-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => void submit()}
                    disabled={saving}
                    className="rounded-md bg-[var(--theme-primary)] text-[var(--theme-primary-foreground)] px-3 py-1 text-xs font-medium disabled:opacity-50"
                  >
                    {saving ? '…' : 'Add'}
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {error && (
        <div className="px-4 py-2 text-xs text-red-700 bg-red-50 dark:bg-red-950/30 border-t border-red-200 dark:border-red-900">
          {error}
        </div>
      )}
    </section>
  )
}
