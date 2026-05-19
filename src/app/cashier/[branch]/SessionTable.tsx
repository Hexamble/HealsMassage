'use client'

/**
 * heals-system-rebuild — SessionTable (Task 9.4)
 *
 * The cashier's main work surface: a wide editable table that mirrors
 * the Google Sheet workflow the shop has used for years. Every column
 * is a combobox with free-text fallback (Staff, Course, Duration,
 * Method, Flags) so a cashier can pick from a list OR type anything
 * the shop has never seen before — borrowed staff, walk-in
 * freelancer, custom flag.
 *
 * Layout rules straight from the user:
 *   - Page opens with **20 empty rows**. The cashier fills the first
 *     7 staff names down the left column to set the queue order
 *     (those 7 names ARE the day's roster).
 *   - "+ Add 5 rows" button below the table appends 5 more whenever
 *     the day gets busy. No upper limit.
 *   - Empty rows save nothing — a row only persists once staff +
 *     course + duration + method are all filled.
 *   - Already-saved rows are editable inline; every blur autosaves
 *     via `writeTransaction` (optimistic UI; offline queue fallback
 *     when the network is unreachable).
 *   - Delete button per saved row calls `deleteTransaction({rowId})`.
 *
 * Save semantics:
 *   - Optimistic insert into `useCashier()` state right away.
 *   - Server result replaces the optimistic row by id.
 *   - On retryable network failure, enqueue to the IndexedDB offline
 *     queue (`@/lib/offline-queue`); the offline-sync worker drains
 *     when online again.
 *   - On terminal validation failure (UNKNOWN_STAFF, INVALID_INPUT,
 *     etc.), the row stays in the local list with `saveError` set so
 *     the cashier can fix it — but nothing lands in the DB.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.8, 2.10,
 *            7.1, 7.2, 7.3, 7.5, 14.4, 14.5, 21.3, 23.3.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  buildRowId,
} from '@/domain/row-id'
import type { Branch, TransactionRow } from '@/domain/types'
import { writeTransaction } from '@/app/actions/writeTransaction'
import { deleteTransaction } from '@/app/actions/deleteTransaction'
import { enqueue } from '@/lib/offline-queue'
import { toast } from '@/components/cashier/Toaster'

import { useCashier } from './CashierContext'
import SessionRow, {
  blankDraft,
  isSaveable,
  rowToDraft,
  type DraftRow,
} from './SessionRow'

const INITIAL_BLANK_ROWS = 20
const ADD_BATCH = 5

// Errors we treat as terminal: surfacing them to the cashier as a
// row-level error rather than retrying forever.
const TERMINAL_CODES = new Set<string>([
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'INVALID_INPUT',
  'BRANCH_MISMATCH',
  'UNKNOWN_STAFF',
  'STAFF_NOT_ON_ROSTER',
])

function isNetworkError(code: string): boolean {
  return code === 'NETWORK_ERROR' || code === 'DB_ERROR'
}

/**
 * Convert an editable draft into the payload `writeTransaction`
 * expects. Empty strings become `undefined` so the server can fall
 * back to its own auto-fills (price, commission components).
 */
function draftToPayload(d: DraftRow, branch: Branch): Record<string, unknown> {
  const num = (s: string) => {
    const n = Number(s)
    return Number.isFinite(n) ? n : 0
  }
  return {
    branch,
    cashierRowNumber: d.cashierRowNumber,
    staff: d.staff,
    course: d.course,
    duration: num(d.duration),
    method: d.method,
    timeIn: d.timeIn || null,
    timeOut: d.timeOut || null,
    cash: num(d.cash),
    qr: num(d.qr),
    credit: num(d.credit),
    // Pass price + commission components through ONLY when the
    // cashier overrode them — otherwise the server auto-fills from
    // the same lookup tables we use for the live preview.
    ...(d.overrides.price ? { price: num(d.price) } : {}),
    addon: num(d.addon),
    ...(d.overrides.base ? { baseCommission: num(d.baseCommission) } : {}),
    ...(d.overrides.balm ? { balmBonus: num(d.balmBonus) } : {}),
    ...(d.overrides.book ? { bookingBonus: num(d.bookingBonus) } : {}),
    ...(d.overrides.total ? { totalCommission: num(d.totalCommission) } : {}),
    flags: d.flags,
    comment: d.comment,
    staffBalm: d.flags.toLowerCase().includes('staff balm'),
    booking: d.flags.toLowerCase().includes('booking'),
  }
}

/**
 * Build the initial draft list: persisted rows from context + N blank
 * placeholders to fill out 20 visible slots. Persisted rows always
 * occupy their `cashierRowNumber` slot; blanks fill the gaps and
 * extend past the highest persisted number.
 */
function buildInitialDrafts(
  saved: ReadonlyArray<TransactionRow>,
  visibleRowCount: number,
): DraftRow[] {
  const byNum = new Map<number, DraftRow>()
  for (const r of saved) {
    byNum.set(r.cashierRowNumber, rowToDraft(r))
  }
  const highest = saved.reduce(
    (acc, r) => Math.max(acc, r.cashierRowNumber),
    0,
  )
  const target = Math.max(visibleRowCount, highest)
  const list: DraftRow[] = []
  for (let i = 1; i <= target; i++) {
    list.push(byNum.get(i) ?? blankDraft(i))
  }
  return list
}

export default function SessionTable() {
  const ctx = useCashier()
  const {
    branch,
    businessDate,
    transactions,
    roster,
    prices,
    regularRates,
    freelanceRates,
    readOnly,
    addOptimistic,
    replaceOptimistic,
    removeOptimistic,
  } = ctx

  // The number of "visible slots" — saved rows always show; we pad
  // up to this count with blanks. Cashiers extend with "Add 5".
  const [visibleRowCount, setVisibleRowCount] = useState(INITIAL_BLANK_ROWS)

  // Local drafts mirror persisted rows but allow edit-in-flight state.
  const [drafts, setDrafts] = useState<DraftRow[]>(() =>
    buildInitialDrafts(transactions, INITIAL_BLANK_ROWS),
  )

  // Reconcile drafts with persisted state when the context updates
  // (realtime events, post-server-save replacements, morning reset).
  useEffect(() => {
    setDrafts((prev) => {
      const byNum = new Map<number, DraftRow>()
      // Carry over any in-flight edits that haven't resolved.
      for (const d of prev) {
        if (d.saving || d.saveError) byNum.set(d.cashierRowNumber, d)
      }
      // Persisted rows from context win when there's no in-flight edit.
      for (const r of transactions) {
        if (!byNum.has(r.cashierRowNumber)) {
          byNum.set(r.cashierRowNumber, rowToDraft(r))
        }
      }
      const highest = transactions.reduce(
        (acc, r) => Math.max(acc, r.cashierRowNumber),
        0,
      )
      const target = Math.max(visibleRowCount, highest)
      const next: DraftRow[] = []
      for (let i = 1; i <= target; i++) {
        next.push(byNum.get(i) ?? blankDraft(i))
      }
      return next
    })
  }, [transactions, visibleRowCount])

  function updateDraft(idx: number, next: DraftRow) {
    setDrafts((prev) => {
      const copy = [...prev]
      copy[idx] = next
      return copy
    })
  }

  const persistRow = useCallback(
    async (rowToSave: DraftRow) => {
      const payload = draftToPayload(rowToSave, branch)
      const rowId = buildRowId(branch, businessDate, rowToSave.cashierRowNumber)

      // Optimistic projection — push a synthetic TransactionRow into
      // context so the table, panels, and queue all see the row right
      // away.
      const optimistic: TransactionRow = {
        id: rowToSave.id || rowId,
        branch,
        businessDate,
        cashierRowNumber: rowToSave.cashierRowNumber,
        staff: rowToSave.staff,
        course: rowToSave.course as TransactionRow['course'],
        duration: Number(rowToSave.duration) as TransactionRow['duration'],
        timeIn: rowToSave.timeIn || null,
        timeOut: rowToSave.timeOut || null,
        method: rowToSave.method,
        addon: Number(rowToSave.addon) || 0,
        baseCommission: Number(rowToSave.baseCommission) || 0,
        balmBonus: Number(rowToSave.balmBonus) || 0,
        bookingBonus: Number(rowToSave.bookingBonus) || 0,
        totalCommission: Number(rowToSave.totalCommission) || 0,
        cash: Number(rowToSave.cash) || 0,
        qr: Number(rowToSave.qr) || 0,
        credit: Number(rowToSave.credit) || 0,
        price: Number(rowToSave.price) || 0,
        flags: rowToSave.flags,
        comment: rowToSave.comment,
        createdAt: '',
        updatedAt: '',
        createdBy: null,
      }
      addOptimistic(optimistic)

      // Mark the draft "saving" so the row UI shows a spinner.
      setDrafts((prev) =>
        prev.map((d) =>
          d.cashierRowNumber === rowToSave.cashierRowNumber
            ? { ...d, saving: true, saveError: undefined }
            : d,
        ),
      )

      try {
        const result = await writeTransaction(payload)
        if (result.ok) {
          // Map the persisted server row into the context shape and
          // replace the optimistic projection. The action returns
          // its own camelCase projection that's almost identical to
          // `TransactionRow` — coerce the few that differ.
          const r = result.row
          const persistedRow: TransactionRow = {
            id: r.id,
            branch: r.branch,
            businessDate: r.businessDate,
            cashierRowNumber: r.cashierRowNumber,
            staff: r.staff,
            course: r.course,
            duration: r.duration,
            timeIn: r.timeIn,
            timeOut: r.timeOut,
            method: r.method,
            addon: r.addon,
            baseCommission: r.baseCommission,
            balmBonus: r.balmBonus,
            bookingBonus: r.bookingBonus,
            totalCommission: r.totalCommission,
            cash: r.cash,
            qr: r.qr,
            credit: r.credit,
            price: r.price,
            flags: r.flags,
            comment: r.comment,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            createdBy: r.createdBy,
          }
          replaceOptimistic(persistedRow)
          setDrafts((prev) =>
            prev.map((d) =>
              d.cashierRowNumber === rowToSave.cashierRowNumber
                ? { ...rowToDraft(persistedRow), overrides: rowToSave.overrides }
                : d,
            ),
          )
          return
        }
        // Failure path. Decide between terminal vs queue-for-retry.
        if (TERMINAL_CODES.has(result.code)) {
          setDrafts((prev) =>
            prev.map((d) =>
              d.cashierRowNumber === rowToSave.cashierRowNumber
                ? {
                    ...d,
                    saving: false,
                    saveError: `${result.code}: ${result.message}`,
                  }
                : d,
            ),
          )
          // DO NOT roll back the optimistic row. The cashier needs to
          // see the row stay put with an error indicator so they can
          // fix it (e.g. add payment) and the autosave retries on
          // the next blur. Removing it on every terminal error caused
          // the "I typed a name and it disappeared" bug.
          return
        }
        if (isNetworkError(result.code)) {
          // Queue for the offline worker to drain later.
          await enqueue({
            id: rowId,
            kind: 'transaction',
            payload,
            createdAt: new Date().toISOString(),
            retries: 0,
          })
          setDrafts((prev) =>
            prev.map((d) =>
              d.cashierRowNumber === rowToSave.cashierRowNumber
                ? { ...d, saving: false, saveError: undefined }
                : d,
            ),
          )
          return
        }
        // Unknown error — show on the row so the cashier sees it.
        setDrafts((prev) =>
          prev.map((d) =>
            d.cashierRowNumber === rowToSave.cashierRowNumber
              ? {
                  ...d,
                  saving: false,
                  saveError: `${result.code}: ${result.message}`,
                }
              : d,
          ),
        )
      } catch (err) {
        // Network exception — queue and let the worker handle it.
        await enqueue({
          id: rowId,
          kind: 'transaction',
          payload,
          createdAt: new Date().toISOString(),
          retries: 0,
          lastError: err instanceof Error ? err.message : String(err),
        })
        setDrafts((prev) =>
          prev.map((d) =>
            d.cashierRowNumber === rowToSave.cashierRowNumber
              ? { ...d, saving: false, saveError: undefined }
              : d,
          ),
        )
      }
    },
    [branch, businessDate, addOptimistic, replaceOptimistic, removeOptimistic],
  )

  const onCommit = useCallback(
    (rowToSave: DraftRow) => {
      if (readOnly) return
      if (!isSaveable(rowToSave)) return
      void persistRow(rowToSave)
    },
    [readOnly, persistRow],
  )

  const onDelete = useCallback(
    async (rowToDelete: DraftRow) => {
      if (readOnly) return
      if (!rowToDelete.id) return
      const rowId = buildRowId(
        branch,
        businessDate,
        rowToDelete.cashierRowNumber,
      )

      // Capture snapshot for potential undo (we re-add it on undo, then
      // re-fire writeTransaction with the same rowId so the row is
      // recreated server-side too — idempotent upsert handles that).
      const snapshot: DraftRow = { ...rowToDelete, saving: false, saveError: undefined }

      // Optimistic removal — drop from context immediately so the
      // panels update.
      removeOptimistic(rowToDelete.id)
      setDrafts((prev) =>
        prev.map((d) =>
          d.cashierRowNumber === rowToDelete.cashierRowNumber
            ? blankDraft(d.cashierRowNumber)
            : d,
        ),
      )

      // 5-second undo window. If the cashier hits Undo within that
      // window, restore the row locally AND re-fire writeTransaction
      // (since the deletion would already have committed). If the
      // window passes, fire the actual deleteTransaction.
      let undone = false
      toast({
        message: `Row ${rowToDelete.cashierRowNumber} deleted (${rowToDelete.staff || 'empty'}).`,
        variant: 'default',
        durationMs: 5000,
        action: {
          label: 'Undo',
          onClick: () => {
            undone = true
            // Restore locally.
            const restoredRow: TransactionRow = {
              id: rowToDelete.id,
              branch,
              businessDate,
              cashierRowNumber: rowToDelete.cashierRowNumber,
              staff: rowToDelete.staff,
              course: rowToDelete.course as TransactionRow['course'],
              duration: Number(rowToDelete.duration) as TransactionRow['duration'],
              timeIn: rowToDelete.timeIn || null,
              timeOut: rowToDelete.timeOut || null,
              method: rowToDelete.method,
              addon: Number(rowToDelete.addon) || 0,
              baseCommission: Number(rowToDelete.baseCommission) || 0,
              balmBonus: Number(rowToDelete.balmBonus) || 0,
              bookingBonus: Number(rowToDelete.bookingBonus) || 0,
              totalCommission: Number(rowToDelete.totalCommission) || 0,
              cash: Number(rowToDelete.cash) || 0,
              qr: Number(rowToDelete.qr) || 0,
              credit: Number(rowToDelete.credit) || 0,
              price: Number(rowToDelete.price) || 0,
              flags: rowToDelete.flags,
              comment: rowToDelete.comment,
              createdAt: '',
              updatedAt: '',
              createdBy: null,
            }
            addOptimistic(restoredRow)
            setDrafts((prev) =>
              prev.map((d) =>
                d.cashierRowNumber === rowToDelete.cashierRowNumber
                  ? snapshot
                  : d,
              ),
            )
            // Re-fire writeTransaction so the server has the row again.
            void persistRow(snapshot)
          },
        },
        onTimeout: () => {
          // Window elapsed — commit the deletion to the server.
          if (undone) return
          void deleteTransaction({ rowId }).then((result) => {
            if (!result.ok) {
              // Couldn't reach the server. Restore the row locally
              // and tell the cashier.
              setDrafts((prev) =>
                prev.map((d) =>
                  d.cashierRowNumber === rowToDelete.cashierRowNumber
                    ? {
                        ...snapshot,
                        saveError: `${result.code}: ${result.message}`,
                      }
                    : d,
                ),
              )
              toast({
                message: `Could not delete row ${rowToDelete.cashierRowNumber}: ${result.message}`,
                variant: 'error',
              })
            }
          })
        },
      })
    },
    [readOnly, branch, businessDate, addOptimistic, removeOptimistic, persistRow],
  )

  function addRows() {
    setVisibleRowCount((n) => n + ADD_BATCH)
  }

  // Memoise the row content so the table doesn't re-render every
  // child on every keystroke in another row.
  const rowsView = useMemo(() => drafts, [drafts])

  return (
    <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
      <header className="px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/40">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide">
            Sessions — {branch}
          </h2>
          <div className="text-xs text-zinc-500">
            Business date: <span className="font-mono">{businessDate}</span>
          </div>
        </div>
      </header>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/40 sticky top-0 z-10">
            <tr>
              <th className="px-1 py-1.5 text-right">#</th>
              <th className="px-1 py-1.5 text-right">Price</th>
              <th className="px-1 py-1.5 text-left">Staff</th>
              <th className="px-1 py-1.5 text-left">Course</th>
              <th className="px-1 py-1.5 text-left">Dur</th>
              <th className="px-1 py-1.5 text-left">In</th>
              <th className="px-1 py-1.5 text-left">Out</th>
              <th className="px-1 py-1.5 text-right">Add</th>
              <th className="px-1 py-1.5 text-right">Comm.</th>
              <th className="px-1 py-1.5 text-left">Method</th>
              <th className="px-1 py-1.5 text-right">Cash</th>
              <th className="px-1 py-1.5 text-right">QR</th>
              <th className="px-1 py-1.5 text-right">Credit</th>
              <th className="px-1 py-1.5 text-left">Balm/Book</th>
              <th className="px-1 py-1.5 text-left">Comment</th>
              <th className="px-1 py-1.5"> </th>
            </tr>
          </thead>
          <tbody>
            {rowsView.map((d, idx) => (
              <SessionRow
                key={d.cashierRowNumber}
                row={d}
                branch={branch}
                businessDate={businessDate}
                roster={roster}
                prices={prices}
                regularRates={regularRates}
                freelanceRates={freelanceRates}
                readOnly={readOnly}
                onChange={(next) => updateDraft(idx, next)}
                onCommit={onCommit}
                onDelete={onDelete}
              />
            ))}
          </tbody>
        </table>
      </div>
      <footer className="px-4 py-2.5 flex items-center justify-between gap-3 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/40">
        <div className="text-xs text-zinc-500">
          {drafts.length} rows
          {' · '}
          {drafts.filter((d) => d.id).length} saved
        </div>
        <button
          type="button"
          onClick={addRows}
          disabled={readOnly}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-700 disabled:opacity-50"
        >
          + Add {ADD_BATCH} rows
        </button>
      </footer>
    </section>
  )
}
