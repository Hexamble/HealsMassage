'use client'

/**
 * SessionTable — Clean rewrite.
 *
 * Single component with inline editable rows. Save triggers on
 * row-change (focus moves to a different row) or explicit Save button.
 * No localStorage, no offline queue, no optimistic/reconcile machinery.
 * Fetches fresh data on load and on window focus via context.
 */

import { useState } from 'react'

import { buildRowId } from '@/domain/row-id'
import {
  COURSES,
  DURATIONS,
  TRANSACTION_METHODS,
  type Branch,
  type StaffMember,
  type TransactionRow,
} from '@/domain/types'
import type { Course, Duration } from '@/domain/commission'
import { writeTransaction } from '@/app/actions/writeTransaction'
import { deleteTransaction } from '@/app/actions/deleteTransaction'
import { toast } from '@/components/cashier/Toaster'
import { parseTimeInput } from '@/lib/timeFormat'

import { useCashier } from './CashierContext'
import { blankDraft, isSaveable, rowToDraft, type DraftRow } from './SessionRow'
import { computeRowDefaults } from './rowDefaults'

const INITIAL_ROWS = 15
const ADD_BATCH = 5

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function num(s: string): number {
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

function buildInitialRows(
  saved: ReadonlyArray<TransactionRow>,
  minRows: number,
): DraftRow[] {
  const byNum = new Map<number, DraftRow>()
  for (const r of saved) {
    byNum.set(r.cashierRowNumber, rowToDraft(r))
  }
  const highest = saved.reduce(
    (acc, r) => Math.max(acc, r.cashierRowNumber),
    0,
  )
  const target = Math.max(minRows, highest)
  const list: DraftRow[] = []
  for (let i = 1; i <= target; i++) {
    list.push(byNum.get(i) ?? blankDraft(i))
  }
  return list
}

/** Compute auto-fill for price/commission when course/duration/method/flags change. */
function applyAutoFill(
  row: DraftRow,
  branch: Branch,
  businessDate: string,
  ctx: {
    prices: ReturnType<typeof useCashier>['prices']
    regularRates: ReturnType<typeof useCashier>['regularRates']
    freelanceRates: ReturnType<typeof useCashier>['freelanceRates']
    roster: StaffMember[]
  },
): DraftRow {
  if (!row.course || !row.duration) return row
  const dur = num(row.duration)
  if (![30, 60, 90, 120].includes(dur)) return row

  const staffIsFreelance = ctx.roster.some(
    (s) => s.name.trim().toLowerCase() === row.staff.trim().toLowerCase() && s.isFreelance,
  )

  const defaults = computeRowDefaults({
    branch,
    businessDate,
    course: row.course as Course,
    duration: dur as Duration,
    method: row.method,
    flags: row.flags,
    staffIsFreelance,
    prices: ctx.prices,
    regularRates: ctx.regularRates,
    freelanceRates: ctx.freelanceRates,
  })

  return {
    ...row,
    price: String(defaults.price),
    baseCommission: String(defaults.baseCommission),
    balmBonus: String(defaults.balmBonus),
    bookingBonus: String(defaults.bookingBonus),
    totalCommission: String(defaults.totalCommission),
  }
}

/** Compute time-out from time-in + duration. */
function computeTimeOut(timeIn: string, duration: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(timeIn.trim())
  if (!m) return ''
  const dur = num(duration)
  if (![30, 60, 90, 120].includes(dur)) return ''
  const startMin = parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
  const endMin = Math.min(startMin + dur, 23 * 60 + 59)
  const hh = String(Math.floor(endMin / 60)).padStart(2, '0')
  const mm = String(endMin % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

/** Build the payload writeTransaction expects. */
function draftToPayload(d: DraftRow, branch: Branch) {
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
    price: num(d.price),
    addon: num(d.addon),
    flags: d.flags,
    comment: d.comment,
    staffBalm: d.flags.toLowerCase().includes('staff balm'),
    booking: d.flags.toLowerCase().includes('booking'),
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

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
    refreshAll,
  } = ctx

  const [rows, setRows] = useState<DraftRow[]>(() =>
    buildInitialRows(transactions, INITIAL_ROWS),
  )

  // --- Row update helper (always reads latest from state) ---
  function updateRow(rowNum: number, updater: (prev: DraftRow) => DraftRow) {
    setRows((prev) =>
      prev.map((r) => (r.cashierRowNumber === rowNum ? updater(r) : r)),
    )
  }

  // --- Save logic ---
  async function saveRow(row: DraftRow) {
    if (!isSaveable(row)) return
    updateRow(row.cashierRowNumber, (r) => ({ ...r, saving: true, saveError: undefined }))

    try {
      const payload = draftToPayload(row, branch)
      const result = await writeTransaction(payload)
      if (result.ok) {
        const r = result.row
        updateRow(row.cashierRowNumber, (prev) => ({
          ...prev,
          id: r.id,
          saving: false,
          saveError: undefined,
          // Update with server-computed values
          price: String(r.price),
          baseCommission: String(r.baseCommission),
          balmBonus: String(r.balmBonus),
          bookingBonus: String(r.bookingBonus),
          totalCommission: String(r.totalCommission),
        }))
      } else {
        updateRow(row.cashierRowNumber, (prev) => ({
          ...prev,
          saving: false,
          saveError: `${result.code}: ${result.message}`,
        }))
        toast({ message: `Row ${row.cashierRowNumber}: ${result.message}`, variant: 'error' })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error'
      updateRow(row.cashierRowNumber, (prev) => ({
        ...prev,
        saving: false,
        saveError: msg,
      }))
      toast({ message: `Row ${row.cashierRowNumber}: ${msg}`, variant: 'error' })
    }
  }

  // Save on explicit button click — reads latest state
  function handleSaveClick(rowNum: number) {
    setRows((current) => {
      const row = current.find((r) => r.cashierRowNumber === rowNum)
      if (row && isSaveable(row)) {
        void saveRow(row)
      }
      return current
    })
  }

  // --- Delete handler ---
  async function handleDelete(rowNum: number) {
    if (readOnly) return
    const row = rows.find((r) => r.cashierRowNumber === rowNum)
    if (!row || !row.id) return

    const rowId = buildRowId(branch, businessDate, row.cashierRowNumber)
    updateRow(rowNum, () => blankDraft(rowNum))

    try {
      const result = await deleteTransaction({ rowId })
      if (!result.ok) {
        toast({ message: `Delete failed: ${result.message}`, variant: 'error' })
      }
    } catch (err) {
      toast({ message: `Delete failed: ${err instanceof Error ? err.message : 'Network error'}`, variant: 'error' })
    }
  }

  // --- Footer actions ---
  function addRows() {
    setRows((prev) => {
      const maxNum = prev.reduce((acc, r) => Math.max(acc, r.cashierRowNumber), 0)
      const added: DraftRow[] = []
      for (let i = 1; i <= ADD_BATCH; i++) {
        added.push(blankDraft(maxNum + i))
      }
      return [...prev, ...added]
    })
  }

  function clearUnsaved() {
    setRows(buildInitialRows(transactions, INITIAL_ROWS))
  }

  function handleRefresh() {
    void refreshAll().then(() => {
      // After refresh, rebuild rows from fresh transactions
      setRows(buildInitialRows(ctx.transactions, Math.max(INITIAL_ROWS, rows.length)))
    })
  }

  // --- Staff options for select ---
  const homeStaff = roster.filter((s) => s.isActive && !s.isFreelance && s.homeBranch === branch)
  const otherStaff = roster.filter((s) => s.isActive && !s.isFreelance && s.homeBranch !== branch)
  const freelancers = roster.filter((s) => s.isActive && s.isFreelance)

  // --- Inline change handlers (synchronous auto-fill) ---
  function onFieldChange(rowNum: number, field: keyof DraftRow, value: string) {
    updateRow(rowNum, (prev) => {
      let next = { ...prev, [field]: value }

      // Auto-fill on course/duration/method/flags change
      if (field === 'course' || field === 'duration' || field === 'method' || field === 'flags') {
        next = applyAutoFill(next, branch, businessDate, { prices, regularRates, freelanceRates, roster })
      }

      // Auto-fill time-out when duration changes and timeIn is set
      if (field === 'duration' && next.timeIn) {
        const tout = computeTimeOut(next.timeIn, next.duration)
        if (tout) next.timeOut = tout
      }

      return next
    })
  }

  function onTimeInBlur(rowNum: number) {
    updateRow(rowNum, (prev) => {
      if (!prev.timeIn.trim()) return prev
      const result = parseTimeInput(prev.timeIn)
      if (!result.valid) return prev
      const formatted = result.formatted
      const tout = computeTimeOut(formatted, prev.duration)
      return { ...prev, timeIn: formatted, timeOut: tout || prev.timeOut }
    })
  }

  function onTimeOutBlur(rowNum: number) {
    updateRow(rowNum, (prev) => {
      if (!prev.timeOut.trim()) return prev
      const result = parseTimeInput(prev.timeOut)
      if (!result.valid) return prev
      return { ...prev, timeOut: result.formatted }
    })
  }

  function onFlagToggle(rowNum: number, flag: string) {
    updateRow(rowNum, (prev) => {
      const current = prev.flags
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean)
      const has = current.includes(flag)
      const next = has ? current.filter((f) => f !== flag) : [...current, flag]
      const flagStr = next.join(',')
      let updated = { ...prev, flags: flagStr }
      updated = applyAutoFill(updated, branch, businessDate, { prices, regularRates, freelanceRates, roster })
      return updated
    })
  }

  // --- Render ---
  const inputCls =
    'w-full bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 border border-zinc-300 dark:border-zinc-700 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]'
  const selectCls =
    'w-full bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 border border-zinc-300 dark:border-zinc-700 rounded px-1 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]'
  const numCls =
    'w-[56px] bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 border border-zinc-300 dark:border-zinc-700 rounded px-1.5 py-1 text-xs text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]'

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
              <th className="px-1 py-1.5 text-right w-8">#</th>
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
              <th className="px-1 py-1.5 text-left">Balm&amp;Book</th>
              <th className="px-1 py-1.5 text-left">Comment</th>
              <th className="px-1 py-1.5 w-20"> </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rn = row.cashierRowNumber
              const flags = row.flags.split(',').map((f) => f.trim()).filter(Boolean)
              const rowBg = row.saving
                ? 'opacity-70'
                : rn % 2 === 0
                  ? 'bg-zinc-50/70 dark:bg-zinc-800/30'
                  : ''

              return (
                <tr
                  key={rn}
                  className={`border-b border-zinc-100 dark:border-zinc-800 ${rowBg}`}
                >
                  {/* Row number */}
                  <td className="px-1 py-0.5 text-[10px] text-zinc-500 text-right tabular-nums align-middle">
                    {rn}
                  </td>

                  {/* Price */}
                  <td className="px-0.5 py-0 align-middle">
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label={`Price row ${rn}`}
                      value={row.price}
                      disabled={readOnly}
                      onChange={(e) => onFieldChange(rn, 'price', e.target.value)}
                      className={numCls}
                    />
                  </td>

                  {/* Staff */}
                  <td className="px-0.5 py-0 align-middle min-w-[100px]">
                    <select
                      aria-label={`Staff row ${rn}`}
                      value={row.staff}
                      disabled={readOnly}
                      onChange={(e) => onFieldChange(rn, 'staff', e.target.value)}
                      className={selectCls}
                    >
                      <option value="">—</option>
                      <optgroup label={`${branch} staff`}>
                        {homeStaff.map((s) => (
                          <option key={s.id} value={s.name}>{s.name}</option>
                        ))}
                      </optgroup>
                      {otherStaff.length > 0 && (
                        <optgroup label="Other branch">
                          {otherStaff.map((s) => (
                            <option key={s.id} value={s.name}>{s.name} ({s.homeBranch.slice(0, 3)})</option>
                          ))}
                        </optgroup>
                      )}
                      {freelancers.length > 0 && (
                        <optgroup label="Freelance">
                          {freelancers.map((s) => (
                            <option key={s.id} value={s.name}>{s.name}</option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </td>

                  {/* Course */}
                  <td className="px-0.5 py-0 align-middle min-w-[64px]">
                    <select
                      aria-label={`Course row ${rn}`}
                      value={row.course}
                      disabled={readOnly}
                      onChange={(e) => onFieldChange(rn, 'course', e.target.value)}
                      className={selectCls}
                    >
                      <option value="">—</option>
                      {COURSES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </td>

                  {/* Duration */}
                  <td className="px-0.5 py-0 align-middle min-w-[58px]">
                    <select
                      aria-label={`Duration row ${rn}`}
                      value={row.duration}
                      disabled={readOnly}
                      onChange={(e) => onFieldChange(rn, 'duration', e.target.value)}
                      className={selectCls}
                    >
                      <option value="">—</option>
                      {DURATIONS.map((d) => (
                        <option key={d} value={String(d)}>{d}</option>
                      ))}
                    </select>
                  </td>

                  {/* Time In */}
                  <td className="px-0.5 py-0 align-middle">
                    <input
                      type="text"
                      aria-label={`Time in row ${rn}`}
                      value={row.timeIn}
                      placeholder="HH:mm"
                      disabled={readOnly}
                      onChange={(e) => onFieldChange(rn, 'timeIn', e.target.value)}
                      onBlur={() => onTimeInBlur(rn)}
                      className={`w-[62px] ${inputCls}`}
                    />
                  </td>

                  {/* Time Out */}
                  <td className="px-0.5 py-0 align-middle">
                    <input
                      type="text"
                      aria-label={`Time out row ${rn}`}
                      value={row.timeOut}
                      placeholder="auto"
                      disabled={readOnly}
                      onChange={(e) => onFieldChange(rn, 'timeOut', e.target.value)}
                      onBlur={() => onTimeOutBlur(rn)}
                      className={`w-[62px] ${inputCls}`}
                    />
                  </td>

                  {/* Add-on */}
                  <td className="px-0.5 py-0 align-middle">
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label={`Add-on row ${rn}`}
                      value={row.addon}
                      disabled={readOnly}
                      onChange={(e) => onFieldChange(rn, 'addon', e.target.value)}
                      className={numCls}
                    />
                  </td>

                  {/* Commission */}
                  <td className="px-0.5 py-0 align-middle">
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label={`Commission row ${rn}`}
                      value={row.totalCommission}
                      disabled={readOnly}
                      onChange={(e) => onFieldChange(rn, 'totalCommission', e.target.value)}
                      className={`${numCls} font-semibold`}
                    />
                  </td>

                  {/* Method */}
                  <td className="px-0.5 py-0 align-middle min-w-[88px]">
                    <select
                      aria-label={`Method row ${rn}`}
                      value={row.method}
                      disabled={readOnly}
                      onChange={(e) => onFieldChange(rn, 'method', e.target.value)}
                      className={selectCls}
                    >
                      <option value="">—</option>
                      {TRANSACTION_METHODS.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </td>

                  {/* Cash */}
                  <td className="px-0.5 py-0 align-middle">
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label={`Cash row ${rn}`}
                      value={row.cash}
                      disabled={readOnly}
                      onChange={(e) => onFieldChange(rn, 'cash', e.target.value)}
                      className={numCls}
                    />
                  </td>

                  {/* QR */}
                  <td className="px-0.5 py-0 align-middle">
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label={`QR row ${rn}`}
                      value={row.qr}
                      disabled={readOnly}
                      onChange={(e) => onFieldChange(rn, 'qr', e.target.value)}
                      className={numCls}
                    />
                  </td>

                  {/* Credit */}
                  <td className="px-0.5 py-0 align-middle">
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label={`Credit row ${rn}`}
                      value={row.credit}
                      disabled={readOnly}
                      onChange={(e) => onFieldChange(rn, 'credit', e.target.value)}
                      className={numCls}
                    />
                  </td>

                  {/* Balm & Book flags */}
                  <td className="px-0.5 py-0 align-middle min-w-[160px]">
                    <div className="flex items-center gap-2 text-[10px]">
                      <label className="flex items-center gap-0.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={flags.includes('Staff Balm')}
                          disabled={readOnly}
                          onChange={() => onFlagToggle(rn, 'Staff Balm')}
                          className="rounded border-zinc-300 dark:border-zinc-600"
                        />
                        <span>Staff Balm</span>
                      </label>
                      <label className="flex items-center gap-0.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={flags.includes('Customer Balm')}
                          disabled={readOnly}
                          onChange={() => onFlagToggle(rn, 'Customer Balm')}
                          className="rounded border-zinc-300 dark:border-zinc-600"
                        />
                        <span>Cust Balm</span>
                      </label>
                      <label className="flex items-center gap-0.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={flags.includes('Booking')}
                          disabled={readOnly}
                          onChange={() => onFlagToggle(rn, 'Booking')}
                          className="rounded border-zinc-300 dark:border-zinc-600"
                        />
                        <span>Booking</span>
                      </label>
                    </div>
                  </td>

                  {/* Comment */}
                  <td className="px-0.5 py-0 align-middle min-w-[100px]">
                    <input
                      type="text"
                      aria-label={`Comment row ${rn}`}
                      value={row.comment}
                      disabled={readOnly}
                      onChange={(e) => onFieldChange(rn, 'comment', e.target.value)}
                      className={inputCls}
                    />
                  </td>

                  {/* Status / Actions */}
                  <td className="px-1 py-0 align-middle text-center whitespace-nowrap">
                    {row.saving && (
                      <span className="text-zinc-400 text-sm" title="Saving">⏳</span>
                    )}
                    {row.id && !row.saving && (
                      <span className="text-emerald-600 dark:text-emerald-400 font-bold text-sm" title="Saved">✓</span>
                    )}
                    {row.saveError && (
                      <span className="text-red-500 text-[10px] ml-1" title={row.saveError}>!</span>
                    )}
                    {!readOnly && isSaveable(row) && !row.saving && (
                      <button
                        type="button"
                        onClick={() => handleSaveClick(rn)}
                        className="ml-1 text-[10px] text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 border border-zinc-300 dark:border-zinc-600 rounded px-1.5 py-0.5"
                        title="Save row"
                      >
                        Save
                      </button>
                    )}
                    {row.id && !readOnly && !row.saving && (
                      <button
                        type="button"
                        aria-label={`Delete row ${rn}`}
                        onClick={() => handleDelete(rn)}
                        className="ml-1 text-zinc-400 hover:text-red-600 text-sm px-1"
                        title="Delete"
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <footer className="px-4 py-2.5 flex items-center justify-between gap-3 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/40">
        <div className="text-xs text-zinc-500">
          {rows.length} rows · {rows.filter((d) => d.id).length} saved
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={clearUnsaved}
            disabled={readOnly}
            title="Clear unsaved draft rows"
            className="inline-flex items-center gap-1 rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700 disabled:opacity-50"
          >
            Clear unsaved
          </button>
          <button
            type="button"
            onClick={addRows}
            disabled={readOnly}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 dark:hover:bg-zinc-700 disabled:opacity-50"
          >
            + Add {ADD_BATCH} rows
          </button>
          <button
            type="button"
            onClick={handleRefresh}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 dark:hover:bg-zinc-700"
            title="Refresh from database"
          >
            ⟳ Refresh
          </button>
        </div>
      </footer>
    </section>
  )
}
