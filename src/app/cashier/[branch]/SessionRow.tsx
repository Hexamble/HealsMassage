'use client'

/**
 * SessionRow — one editable row.
 *
 * Architecture (rewritten to fix the render-loop freeze):
 *
 *   - NO useEffects with `row` or `onChange` in deps. Those caused
 *     infinite re-render loops because the effects called onChange
 *     which updated parent state which re-rendered the row which
 *     re-fired the effect.
 *
 *   - Auto-fill happens INSIDE the relevant cell's onChange handler.
 *     When you change Course or Duration, the price/commission auto-
 *     fill is computed synchronously inside that handler and passed
 *     up via onChange in a single update.
 *
 *   - Time Out auto-fill runs inside the Time In onChange handler.
 *
 *   - Payment auto-fill runs inside the Method onCommit handler.
 *
 *   - Total commission is recomputed inside the base/balm/book/addon
 *     onChange handlers (not as an effect).
 *
 *   - Wrapped in React.memo so the row only re-renders when its own
 *     `row` prop actually changes (not when sibling rows change).
 */

import { memo, useEffect, useMemo, useState } from 'react'

import {
  COURSES,
  DURATIONS,
  TRANSACTION_METHODS,
  type Branch,
  type StaffMember,
  type TransactionRow,
} from '@/domain/types'
import type {
  FreelanceRateRow,
  PriceRow,
  RegularRateRow,
} from '@/domain/commission'

import ComboBox, { type ComboBoxOption } from '@/components/cashier/ComboBox'
import MultiCombo from '@/components/cashier/MultiCombo'
import {
  COURSE_COLORS,
  deriveStaffColor,
  DURATION_COLORS,
  METHOD_COLORS,
  readableForegroundFor,
} from '@/lib/theming'
import { computePaymentAutoFill } from '@/lib/paymentAutoFill'
import { parseTimeInput } from '@/lib/timeFormat'
import { computeRowDefaults } from './rowDefaults'

// ---------------------------------------------------------------------------
// Pill colors
// ---------------------------------------------------------------------------

function staffColorFor(value: string): { bg: string; fg: string } | null {
  if (!value.trim()) return null
  const bg = deriveStaffColor(value)
  return { bg, fg: readableForegroundFor(bg) }
}
function courseColorFor(value: string): { bg: string; fg: string } | null {
  const bg = (COURSE_COLORS as Record<string, string>)[value]
  if (!bg) return null
  return { bg, fg: readableForegroundFor(bg) }
}
function durationColorFor(value: string): { bg: string; fg: string } | null {
  const n = Number(value)
  const bg = (DURATION_COLORS as Record<number, string>)[n]
  if (!bg) return null
  return { bg, fg: readableForegroundFor(bg) }
}
function methodColorFor(value: string): { bg: string; fg: string } | null {
  const bg = (METHOD_COLORS as Record<string, string>)[value]
  if (!bg) return null
  return { bg, fg: readableForegroundFor(bg) }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DraftRow {
  id: string
  cashierRowNumber: number
  staff: string
  course: string
  duration: string
  method: string
  timeIn: string
  timeOut: string
  cash: string
  qr: string
  credit: string
  price: string
  addon: string
  flags: string
  baseCommission: string
  balmBonus: string
  bookingBonus: string
  totalCommission: string
  comment: string
  overrides: {
    price?: boolean
    base?: boolean
    balm?: boolean
    book?: boolean
    total?: boolean
    cash?: boolean
    qr?: boolean
    credit?: boolean
  }
  saving?: boolean
  saveError?: string
  isPlaceholder?: boolean
}

export interface SessionRowProps {
  row: DraftRow
  branch: Branch
  businessDate: string
  roster: StaffMember[]
  prices: ReadonlyArray<PriceRow>
  regularRates: ReadonlyArray<RegularRateRow>
  freelanceRates: ReadonlyArray<FreelanceRateRow>
  readOnly: boolean
  onChange: (row: DraftRow) => void
  onCommit: (row: DraftRow) => void
  onDelete: (row: DraftRow) => void
}

export function rowToDraft(r: TransactionRow): DraftRow {
  return {
    id: r.id,
    cashierRowNumber: r.cashierRowNumber,
    staff: r.staff,
    course: r.course,
    duration: String(r.duration),
    method: r.method,
    timeIn: r.timeIn ?? '',
    timeOut: r.timeOut ?? '',
    cash: String(r.cash ?? 0),
    qr: String(r.qr ?? 0),
    credit: String(r.credit ?? 0),
    price: String(r.price ?? 0),
    addon: String(r.addon ?? 0),
    flags: r.flags ?? '',
    baseCommission: String(r.baseCommission ?? 0),
    balmBonus: String(r.balmBonus ?? 0),
    bookingBonus: String(r.bookingBonus ?? 0),
    totalCommission: String(r.totalCommission ?? 0),
    comment: r.comment ?? '',
    overrides: {},
  }
}

export function blankDraft(cashierRowNumber: number): DraftRow {
  return {
    id: '',
    cashierRowNumber,
    staff: '',
    course: '',
    duration: '',
    method: '',
    timeIn: '',
    timeOut: '',
    cash: '',
    qr: '',
    credit: '',
    price: '',
    addon: '',
    flags: '',
    baseCommission: '',
    balmBonus: '',
    bookingBonus: '',
    totalCommission: '',
    comment: '',
    overrides: {},
    isPlaceholder: true,
  }
}

function num(s: string): number {
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

export function isSaveable(d: DraftRow): boolean {
  return !!(
    d.staff.trim() &&
    d.course.trim() &&
    d.duration.trim() &&
    d.method.trim()
  )
}

// ---------------------------------------------------------------------------
// Cell options
// ---------------------------------------------------------------------------

function buildStaffOptions(roster: StaffMember[]): ComboBoxOption[] {
  return roster
    .filter((s) => !s.isFreelance && s.isActive)
    .map((s) => ({ value: s.name }))
}

const COURSE_OPTIONS: ComboBoxOption[] = COURSES.map((c) => ({ value: c }))
const DURATION_OPTIONS: ComboBoxOption[] = DURATIONS.map((d) => ({
  value: String(d),
}))
const METHOD_OPTIONS: ComboBoxOption[] = TRANSACTION_METHODS.map((m) => ({
  value: m,
}))
const FLAG_OPTIONS: ComboBoxOption[] = [
  { value: 'Staff Balm' },
  { value: 'Customer Balm' },
  { value: 'Booking' },
]

// ---------------------------------------------------------------------------
// Pure helpers (no React, no side effects)
// ---------------------------------------------------------------------------

/**
 * Recompute total commission from parts. Pure function.
 */
function recomputeTotal(row: DraftRow): DraftRow {
  if (row.overrides.total) return row
  const total =
    Math.round(
      (num(row.baseCommission) +
        num(row.balmBonus) +
        num(row.bookingBonus) +
        num(row.addon)) *
        100,
    ) / 100
  const totalStr = String(total)
  if (totalStr === row.totalCommission) return row
  return { ...row, totalCommission: totalStr }
}

/**
 * Apply price/commission auto-fill from rate tables. Pure function.
 * Only updates fields that aren't manually overridden.
 */
function applyRateAutoFill(
  row: DraftRow,
  branch: Branch,
  businessDate: string,
  prices: ReadonlyArray<PriceRow>,
  regularRates: ReadonlyArray<RegularRateRow>,
  freelanceRates: ReadonlyArray<FreelanceRateRow>,
  staffIsFreelance: boolean,
): DraftRow {
  if (!row.course || !row.duration) return row
  const parsedDuration = num(row.duration)
  if (![30, 60, 90, 120].includes(parsedDuration)) return row

  const defaults = computeRowDefaults({
    branch,
    businessDate,
    course: row.course as Parameters<typeof computeRowDefaults>[0]['course'],
    duration:
      parsedDuration as Parameters<typeof computeRowDefaults>[0]['duration'],
    method: row.method,
    flags: row.flags,
    staffIsFreelance,
    prices,
    regularRates,
    freelanceRates,
  })

  const next: DraftRow = { ...row }
  let changed = false
  if (!row.overrides.price && next.price !== String(defaults.price)) {
    next.price = String(defaults.price)
    changed = true
  }
  if (
    !row.overrides.base &&
    next.baseCommission !== String(defaults.baseCommission)
  ) {
    next.baseCommission = String(defaults.baseCommission)
    changed = true
  }
  if (
    !row.overrides.balm &&
    next.balmBonus !== String(defaults.balmBonus)
  ) {
    next.balmBonus = String(defaults.balmBonus)
    changed = true
  }
  if (
    !row.overrides.book &&
    next.bookingBonus !== String(defaults.bookingBonus)
  ) {
    next.bookingBonus = String(defaults.bookingBonus)
    changed = true
  }
  return changed ? recomputeTotal(next) : row
}

/**
 * Auto-fill Time Out from Time In + Duration. Pure.
 */
function applyTimeOutAutoFill(row: DraftRow): DraftRow {
  const m = /^(\d{1,2}):(\d{2})$/.exec(row.timeIn.trim())
  if (!m) return row
  const dur = num(row.duration)
  if (![30, 60, 90, 120].includes(dur)) return row
  const startMin = parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
  const endMin = Math.min(startMin + dur, 23 * 60 + 59)
  const hh = String(Math.floor(endMin / 60)).padStart(2, '0')
  const mm = String(endMin % 60).padStart(2, '0')
  const computed = `${hh}:${mm}`
  if (row.timeOut === computed) return row
  return { ...row, timeOut: computed }
}

/**
 * Apply payment auto-fill. Pure.
 */
function applyPaymentAutoFill(row: DraftRow): DraftRow {
  const result = computePaymentAutoFill({
    method: row.method,
    price: row.price,
    currentPayment: { cash: row.cash, qr: row.qr, credit: row.credit },
    overrides: {
      cash: row.overrides.cash,
      qr: row.overrides.qr,
      credit: row.overrides.credit,
    },
  })
  if (!result.changed.cash && !result.changed.qr && !result.changed.credit) {
    return row
  }
  const updated = { ...row }
  if (result.changed.cash) updated.cash = result.cash
  if (result.changed.qr) updated.qr = result.qr
  if (result.changed.credit) updated.credit = result.credit
  return updated
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function SessionRowImpl({
  row,
  branch,
  businessDate,
  roster,
  prices,
  regularRates,
  freelanceRates,
  readOnly,
  onChange,
  onCommit,
  onDelete,
}: SessionRowProps) {
  const staffOptions = useMemo(() => buildStaffOptions(roster), [roster])

  const staffIsFreelance = useMemo(() => {
    const lc = row.staff.trim().toLowerCase()
    return roster.some(
      (s) => s.name.trim().toLowerCase() === lc && s.isFreelance,
    )
  }, [row.staff, roster])

  const [timeInError, setTimeInError] = useState(false)
  const [timeOutError, setTimeOutError] = useState(false)

  // -- Cell change handlers (synchronous auto-fill, no useEffects) -------

  function changeStaff(v: string) {
    onChange({ ...row, staff: v })
  }
  function commitStaff(v: string) {
    const next = { ...row, staff: v }
    onCommit(next)
  }

  function changeCourse(v: string) {
    const next = applyRateAutoFill(
      { ...row, course: v },
      branch,
      businessDate,
      prices,
      regularRates,
      freelanceRates,
      staffIsFreelance,
    )
    onChange(next)
  }
  function commitCourse() {
    onCommit(row)
  }

  function changeDuration(v: string) {
    let next = applyRateAutoFill(
      { ...row, duration: v },
      branch,
      businessDate,
      prices,
      regularRates,
      freelanceRates,
      staffIsFreelance,
    )
    next = applyTimeOutAutoFill(next)
    onChange(next)
  }
  function commitDuration() {
    onCommit(row)
  }

  function changeMethod(v: string) {
    onChange({ ...row, method: v })
  }
  function commitMethod(v: string) {
    const withMethod = { ...row, method: v || row.method }
    const filled = applyPaymentAutoFill(withMethod)
    onChange(filled)
    onCommit(filled)
  }

  function changeTimeIn(v: string) {
    if (timeInError) setTimeInError(false)
    const next = applyTimeOutAutoFill({ ...row, timeIn: v })
    onChange(next)
  }
  function blurTimeIn() {
    if (!row.timeIn.trim()) {
      setTimeInError(false)
      onCommit(row)
      return
    }
    const result = parseTimeInput(row.timeIn)
    if (result.valid) {
      setTimeInError(false)
      let next = { ...row, timeIn: result.formatted }
      next = applyTimeOutAutoFill(next)
      onChange(next)
      onCommit(next)
    } else {
      setTimeInError(true)
    }
  }

  function changeTimeOut(v: string) {
    if (timeOutError) setTimeOutError(false)
    onChange({ ...row, timeOut: v })
  }
  function blurTimeOut() {
    if (!row.timeOut.trim()) {
      setTimeOutError(false)
      onCommit(row)
      return
    }
    const result = parseTimeInput(row.timeOut)
    if (result.valid) {
      setTimeOutError(false)
      const next = { ...row, timeOut: result.formatted }
      onChange(next)
      onCommit(next)
    } else {
      setTimeOutError(true)
    }
  }

  function changeAddon(v: string) {
    const next = recomputeTotal({ ...row, addon: v })
    onChange(next)
  }

  function changeFlags(v: string) {
    onChange({ ...row, flags: v })
  }
  function commitFlags() {
    onCommit(row)
  }

  function changeComment(v: string) {
    onChange({ ...row, comment: v })
  }
  function commitComment() {
    onCommit(row)
  }

  function setOverridePrice(v: string) {
    onChange({ ...row, price: v, overrides: { ...row.overrides, price: true } })
  }
  function setOverrideBase(v: string) {
    const next = recomputeTotal({
      ...row,
      baseCommission: v,
      overrides: { ...row.overrides, base: true },
    })
    onChange(next)
  }
  function setOverrideTotal(v: string) {
    onChange({
      ...row,
      totalCommission: v,
      overrides: { ...row.overrides, total: true },
    })
  }
  function changeCash(v: string) {
    onChange({ ...row, cash: v, overrides: { ...row.overrides, cash: true } })
  }
  function changeQr(v: string) {
    onChange({ ...row, qr: v, overrides: { ...row.overrides, qr: true } })
  }
  function changeCredit(v: string) {
    onChange({ ...row, credit: v, overrides: { ...row.overrides, credit: true } })
  }

  function commitGeneric() {
    onCommit(row)
  }

  // -- Render --

  const isDimmed = !!row.isPlaceholder && !isSaveable(row)
  const rowIdx = row.cashierRowNumber
  const rowStateClass = isDimmed
    ? 'opacity-60'
    : row.saving
    ? 'opacity-80'
    : row.saveError
    ? 'bg-red-50 dark:bg-red-950/30'
    : rowIdx % 2 === 0
    ? 'bg-zinc-50/70 dark:bg-zinc-800/30'
    : ''

  return (
    <tr
      className={`border-b border-zinc-100 dark:border-zinc-800 ${rowStateClass}`}
    >
      <td className="px-1 py-0.5 text-[10px] text-zinc-500 align-middle text-right tabular-nums">
        {row.cashierRowNumber}
      </td>
      <NumberCell
        label="Price"
        value={row.price}
        readOnly={readOnly}
        accent={!row.overrides.price}
        onChange={setOverridePrice}
        onCommit={commitGeneric}
      />
      <td className="px-0.5 py-0 align-middle min-w-[100px]">
        <ComboBox
          ariaLabel="Staff"
          value={row.staff}
          options={staffOptions}
          placeholder="Staff"
          disabled={readOnly}
          colorFor={staffColorFor}
          onChange={changeStaff}
          onCommit={commitStaff}
        />
      </td>
      <td className="px-0.5 py-0 align-middle min-w-[64px]">
        <ComboBox
          ariaLabel="Course"
          value={row.course}
          options={COURSE_OPTIONS}
          placeholder="FR"
          disabled={readOnly}
          colorFor={courseColorFor}
          onChange={changeCourse}
          onCommit={commitCourse}
        />
      </td>
      <td className="px-0.5 py-0 align-middle min-w-[58px]">
        <ComboBox
          ariaLabel="Duration"
          value={row.duration}
          options={DURATION_OPTIONS}
          placeholder="60"
          disabled={readOnly}
          colorFor={durationColorFor}
          onChange={changeDuration}
          onCommit={commitDuration}
        />
      </td>
      <td className="px-0.5 py-0 align-middle">
        <input
          type="text"
          aria-label="Time in"
          value={row.timeIn}
          placeholder="HH:mm"
          disabled={readOnly}
          onChange={(e) => changeTimeIn(e.target.value)}
          onBlur={blurTimeIn}
          className={[
            'w-[62px] bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 rounded-md px-1.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]',
            timeInError
              ? 'border-2 border-red-500'
              : 'border border-zinc-300 dark:border-zinc-700',
          ].join(' ')}
        />
      </td>
      <td className="px-0.5 py-0 align-middle">
        <input
          type="text"
          aria-label="Time out"
          value={row.timeOut}
          placeholder="auto"
          disabled={readOnly}
          onChange={(e) => changeTimeOut(e.target.value)}
          onBlur={blurTimeOut}
          className={[
            'w-[62px] bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 rounded-md px-1.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]',
            timeOutError
              ? 'border-2 border-red-500'
              : 'border border-zinc-300 dark:border-zinc-700',
          ].join(' ')}
        />
      </td>
      <NumberCell
        label="Add-on"
        value={row.addon}
        readOnly={readOnly}
        onChange={changeAddon}
        onCommit={commitGeneric}
      />
      <NumberCell
        label="Total commission"
        value={row.totalCommission}
        readOnly={readOnly}
        accent={!row.overrides.total}
        bold
        onChange={setOverrideTotal}
        onCommit={commitGeneric}
      />
      <td className="px-0.5 py-0 align-middle min-w-[88px]">
        <ComboBox
          ariaLabel="Method"
          value={row.method}
          options={METHOD_OPTIONS}
          placeholder="CASH"
          disabled={readOnly}
          colorFor={methodColorFor}
          onChange={changeMethod}
          onCommit={commitMethod}
        />
      </td>
      <NumberCell
        label="Cash"
        value={row.cash}
        readOnly={readOnly}
        onChange={changeCash}
        onCommit={commitGeneric}
      />
      <NumberCell
        label="QR"
        value={row.qr}
        readOnly={readOnly}
        onChange={changeQr}
        onCommit={commitGeneric}
      />
      <NumberCell
        label="Credit"
        value={row.credit}
        readOnly={readOnly}
        onChange={changeCredit}
        onCommit={commitGeneric}
      />
      <td className="px-0.5 py-0 align-middle min-w-[150px]">
        <MultiCombo
          ariaLabel="Flags"
          value={row.flags}
          options={FLAG_OPTIONS}
          placeholder="…"
          disabled={readOnly}
          onChange={changeFlags}
          onCommit={commitFlags}
        />
      </td>
      <td className="px-0.5 py-0 align-middle min-w-[100px]">
        <input
          type="text"
          aria-label="Comment"
          value={row.comment}
          placeholder=""
          disabled={readOnly}
          onChange={(e) => changeComment(e.target.value)}
          onBlur={commitComment}
          className="w-full bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 border border-zinc-300 dark:border-zinc-700 rounded-md px-1.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]"
        />
      </td>
      <td className="px-1 py-0 align-middle text-right">
        {row.id && !readOnly && (
          <button
            type="button"
            aria-label={`Delete row ${row.cashierRowNumber}`}
            onClick={() => onDelete(row)}
            className="text-zinc-400 hover:text-red-600 px-1 py-0.5 text-sm"
          >
            ×
          </button>
        )}
        {row.saving && (
          <span className="text-xs text-zinc-500" title="Saving">
            …
          </span>
        )}
        {row.saveError && (
          <span
            className="text-xs text-red-600"
            title={row.saveError}
          >
            !
          </span>
        )}
      </td>
    </tr>
  )
  // Suppress unused warning — setOverrideBase is exported via overrides but
  // currently unused in render. Kept for future direct base-cell editing.
  void setOverrideBase
}

// Memoize so a row only re-renders when its own props change,
// not when sibling rows change.
const SessionRow = memo(SessionRowImpl, (prev, next) => {
  return (
    prev.row === next.row &&
    prev.branch === next.branch &&
    prev.businessDate === next.businessDate &&
    prev.roster === next.roster &&
    prev.prices === next.prices &&
    prev.regularRates === next.regularRates &&
    prev.freelanceRates === next.freelanceRates &&
    prev.readOnly === next.readOnly &&
    prev.onChange === next.onChange &&
    prev.onCommit === next.onCommit &&
    prev.onDelete === next.onDelete
  )
})

export default SessionRow

// ---------------------------------------------------------------------------
// NumberCell helper
// ---------------------------------------------------------------------------

function NumberCell({
  label,
  value,
  readOnly,
  accent,
  bold,
  onChange,
  onCommit,
}: {
  label: string
  value: string
  readOnly: boolean
  accent?: boolean
  bold?: boolean
  onChange: (v: string) => void
  onCommit: () => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <td className="px-0.5 py-0 align-middle">
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        value={draft}
        disabled={readOnly}
        onChange={(e) => {
          setDraft(e.target.value)
          onChange(e.target.value)
        }}
        onBlur={onCommit}
        className={[
          'w-[58px] bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 border border-zinc-300 dark:border-zinc-700 rounded-md px-1.5 py-1 text-xs text-right tabular-nums',
          'focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)] focus:border-[var(--theme-primary)]',
          accent ? 'text-zinc-500 dark:text-zinc-400' : '',
          bold ? 'font-semibold text-zinc-900 dark:text-zinc-100' : '',
        ].join(' ')}
      />
    </td>
  )
}
