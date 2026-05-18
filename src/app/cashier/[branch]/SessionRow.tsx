'use client'

/**
 * heals-system-rebuild — SessionRow (companion to SessionTable, Task 9.4)
 *
 * Renders one editable session row — a `<tr>` with combobox / numeric
 * cells, autosaving on commit. Owns its own per-row dirty-edit state
 * but persists nothing locally beyond the `row` prop the parent
 * provides; the parent (SessionTable) fans out optimistic updates
 * and reconciles with server responses.
 *
 * Empty rows (no staff yet) are rendered grayed-out as placeholders
 * and never call the server until at least staff + course + duration +
 * method are filled.
 *
 * Cells:
 *   #  — row number (display only)
 *   Staff      — ComboBox (roster + freelancers + free text)
 *   Course     — ComboBox (15 codes + free text)
 *   Duration   — ComboBox (30/60/90/120 + free text)
 *   Method     — ComboBox (7 canonical methods + free text)
 *   In         — text HH:mm (free text, optional)
 *   Out        — text HH:mm
 *   Cash       — number
 *   QR         — number
 *   Credit     — number
 *   Price      — number (auto-fills; editable for discounts)
 *   Addon      — number
 *   Flags      — MultiCombo (Staff Balm / Customer Balm / Booking + free)
 *   Base       — number (auto-fills from rate table; editable)
 *   Balm       — number (auto-fills 3 if Staff Balm; editable)
 *   Book       — number (auto-fills duration-bonus if Booking; editable)
 *   Total      — number (auto = base+balm+book+addon; editable)
 *   Comment    — text
 *   ×          — delete button (saved rows only)
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import {
  COURSES,
  DURATIONS,
  TRANSACTION_METHODS,
  type Branch,
  type ExpenseRow as _ExpenseRow,
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
import { computeRowDefaults } from './rowDefaults'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * In-memory editable shape of a session row. Mirrors `TransactionRow`
 * but keeps every value as a string so partial typing doesn't fight
 * `<input type="number">` quirks. The SessionTable converts to numbers
 * at save time.
 */
export interface DraftRow {
  /** Persistent UUID after server save; empty for unsaved rows. */
  id: string
  /** Stable per-(branch, date) row number. */
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
  /** Per-cell override flags so auto-fill never clobbers manual edits. */
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
  /** Local-only flags — surface UI states. */
  saving?: boolean
  saveError?: string
  /** True for the always-trailing placeholder row. */
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

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

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
    cash: '0',
    qr: '0',
    credit: '0',
    price: '0',
    addon: '0',
    flags: '',
    baseCommission: '0',
    balmBonus: '0',
    bookingBonus: '0',
    totalCommission: '0',
    comment: '',
    overrides: {},
    isPlaceholder: true,
  }
}

function num(s: string): number {
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

/**
 * A draft is "saveable" when the four required fields are present.
 * Anything else (price, commission, flags) is optional.
 */
export function isSaveable(d: DraftRow): boolean {
  if (!d.staff.trim()) return false
  if (!d.course.trim()) return false
  if (!d.duration.trim()) return false
  if (!d.method.trim()) return false
  return true
}

// ---------------------------------------------------------------------------
// Cell-level option lists
// ---------------------------------------------------------------------------

function buildStaffOptions(roster: StaffMember[]): ComboBoxOption[] {
  // Branch staff first, then freelancers — visually grouped.
  const branchStaff = roster
    .filter((s) => !s.isFreelance && s.isActive)
    .map((s) => ({ value: s.name, group: 'Branch staff' }))
  const freelancers = roster
    .filter((s) => s.isFreelance && s.isActive)
    .map((s) => ({ value: s.name, group: 'Freelancers' }))
  return [...branchStaff, ...freelancers]
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
// Component
// ---------------------------------------------------------------------------

export default function SessionRow({
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

  // Per-row staffIsFreelance flag — drives rate-table routing in the
  // auto-fill helper.
  const staffIsFreelance = useMemo(() => {
    const lc = row.staff.trim().toLowerCase()
    return roster.some(
      (s) => s.name.trim().toLowerCase() === lc && s.isFreelance,
    )
  }, [row.staff, roster])

  // Auto-fill on (course, duration, method, flags, branch, staff) change
  // — but never clobber cells the cashier manually overrode.
  const autoFillKey = `${row.course}|${row.duration}|${row.method}|${row.flags}|${branch}|${staffIsFreelance}`
  const lastAutoFillKey = useRef<string | null>(null)
  useEffect(() => {
    if (lastAutoFillKey.current === autoFillKey) return
    lastAutoFillKey.current = autoFillKey

    // Don't fight the user during partial typing — only auto-fill when
    // course + duration are both set.
    if (!row.course || !row.duration) return

    const parsedDuration = num(row.duration)
    if (![30, 60, 90, 120].includes(parsedDuration)) return

    const defaults = computeRowDefaults({
      branch,
      businessDate,
      course: row.course as Parameters<typeof computeRowDefaults>[0]['course'],
      duration: parsedDuration as Parameters<typeof computeRowDefaults>[0]['duration'],
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
    if (!row.overrides.balm && next.balmBonus !== String(defaults.balmBonus)) {
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
    if (
      !row.overrides.total &&
      next.totalCommission !== String(defaults.totalCommission)
    ) {
      next.totalCommission = String(defaults.totalCommission)
      changed = true
    }
    if (changed) onChange(next)
    // We intentionally skip onCommit here — auto-fills aren't a save
    // event by themselves; the cashier's next blur on any cell will
    // bundle them in.
  }, [
    autoFillKey,
    branch,
    businessDate,
    prices,
    regularRates,
    freelanceRates,
    onChange,
    row,
    staffIsFreelance,
  ])

  // Live total recompute when base/balm/book/addon change unless the
  // cashier overrode total directly.
  const partsKey = `${row.baseCommission}|${row.balmBonus}|${row.bookingBonus}|${row.addon}|${row.overrides.total ? '1' : '0'}`
  const lastPartsKey = useRef<string | null>(null)
  useEffect(() => {
    if (lastPartsKey.current === partsKey) return
    lastPartsKey.current = partsKey
    if (row.overrides.total) return
    const total =
      Math.round(
        (num(row.baseCommission) +
          num(row.balmBonus) +
          num(row.bookingBonus) +
          num(row.addon)) *
          100,
      ) / 100
    if (String(total) !== row.totalCommission) {
      onChange({ ...row, totalCommission: String(total) })
    }
  }, [partsKey, row, onChange])

  function patch(field: keyof DraftRow, value: unknown) {
    onChange({ ...row, [field]: value })
  }

  function commit() {
    onCommit(row)
  }

  function setOverride(
    name: keyof DraftRow['overrides'],
    nextValue: string,
  ) {
    onChange({
      ...row,
      [
        name === 'base'
          ? 'baseCommission'
          : name === 'balm'
          ? 'balmBonus'
          : name === 'book'
          ? 'bookingBonus'
          : name === 'total'
          ? 'totalCommission'
          : name
      ]: nextValue,
      overrides: { ...row.overrides, [name]: true },
    })
  }

  const isDimmed = !!row.isPlaceholder && !isSaveable(row)
  const rowStateClass = isDimmed
    ? 'opacity-60'
    : row.saving
    ? 'opacity-80'
    : row.saveError
    ? 'bg-red-50 dark:bg-red-950/30'
    : ''

  return (
    <tr
      className={`border-b border-zinc-100 dark:border-zinc-800 ${rowStateClass}`}
    >
      <td className="px-2 py-1 text-xs text-zinc-500 align-middle text-right tabular-nums">
        {row.cashierRowNumber}
      </td>
      <td className="px-1 py-0 align-middle min-w-[140px]">
        <ComboBox
          ariaLabel="Staff"
          value={row.staff}
          options={staffOptions}
          placeholder="Staff name"
          disabled={readOnly}
          onChange={(v) => patch('staff', v)}
          onCommit={(v) => {
            if (v !== row.staff) onChange({ ...row, staff: v })
            commit()
          }}
        />
      </td>
      <td className="px-1 py-0 align-middle min-w-[80px]">
        <ComboBox
          ariaLabel="Course"
          value={row.course}
          options={COURSE_OPTIONS}
          placeholder="FR"
          disabled={readOnly}
          onChange={(v) => patch('course', v)}
          onCommit={() => commit()}
        />
      </td>
      <td className="px-1 py-0 align-middle min-w-[70px]">
        <ComboBox
          ariaLabel="Duration"
          value={row.duration}
          options={DURATION_OPTIONS}
          placeholder="60"
          disabled={readOnly}
          onChange={(v) => patch('duration', v)}
          onCommit={() => commit()}
        />
      </td>
      <td className="px-1 py-0 align-middle min-w-[110px]">
        <ComboBox
          ariaLabel="Method"
          value={row.method}
          options={METHOD_OPTIONS}
          placeholder="CASH"
          disabled={readOnly}
          onChange={(v) => patch('method', v)}
          onCommit={() => commit()}
        />
      </td>
      <td className="px-1 py-0 align-middle">
        <input
          type="text"
          aria-label="Time in"
          value={row.timeIn}
          placeholder="HH:mm"
          disabled={readOnly}
          onChange={(e) => patch('timeIn', e.target.value)}
          onBlur={commit}
          className="w-[70px] bg-transparent border-0 outline-0 px-2 py-1.5 text-sm focus:ring-2 focus:ring-[var(--theme-primary)] focus:rounded"
        />
      </td>
      <td className="px-1 py-0 align-middle">
        <input
          type="text"
          aria-label="Time out"
          value={row.timeOut}
          placeholder="HH:mm"
          disabled={readOnly}
          onChange={(e) => patch('timeOut', e.target.value)}
          onBlur={commit}
          className="w-[70px] bg-transparent border-0 outline-0 px-2 py-1.5 text-sm focus:ring-2 focus:ring-[var(--theme-primary)] focus:rounded"
        />
      </td>
      <NumberCell
        label="Cash"
        value={row.cash}
        readOnly={readOnly}
        onChange={(v) =>
          onChange({ ...row, cash: v, overrides: { ...row.overrides, cash: true } })
        }
        onCommit={commit}
      />
      <NumberCell
        label="QR"
        value={row.qr}
        readOnly={readOnly}
        onChange={(v) =>
          onChange({ ...row, qr: v, overrides: { ...row.overrides, qr: true } })
        }
        onCommit={commit}
      />
      <NumberCell
        label="Credit"
        value={row.credit}
        readOnly={readOnly}
        onChange={(v) =>
          onChange({
            ...row,
            credit: v,
            overrides: { ...row.overrides, credit: true },
          })
        }
        onCommit={commit}
      />
      <NumberCell
        label="Price"
        value={row.price}
        readOnly={readOnly}
        accent={!row.overrides.price}
        onChange={(v) => setOverride('price', v)}
        onCommit={commit}
      />
      <NumberCell
        label="Addon"
        value={row.addon}
        readOnly={readOnly}
        onChange={(v) => patch('addon', v)}
        onCommit={commit}
      />
      <td className="px-1 py-0 align-middle min-w-[180px]">
        <MultiCombo
          ariaLabel="Flags"
          value={row.flags}
          options={FLAG_OPTIONS}
          placeholder="Add flag…"
          disabled={readOnly}
          onChange={(v) => patch('flags', v)}
          onCommit={() => commit()}
        />
      </td>
      <NumberCell
        label="Base commission"
        value={row.baseCommission}
        readOnly={readOnly}
        accent={!row.overrides.base}
        onChange={(v) => setOverride('base', v)}
        onCommit={commit}
      />
      <NumberCell
        label="Balm bonus"
        value={row.balmBonus}
        readOnly={readOnly}
        accent={!row.overrides.balm}
        onChange={(v) => setOverride('balm', v)}
        onCommit={commit}
      />
      <NumberCell
        label="Booking bonus"
        value={row.bookingBonus}
        readOnly={readOnly}
        accent={!row.overrides.book}
        onChange={(v) => setOverride('book', v)}
        onCommit={commit}
      />
      <NumberCell
        label="Total"
        value={row.totalCommission}
        readOnly={readOnly}
        accent={!row.overrides.total}
        bold
        onChange={(v) => setOverride('total', v)}
        onCommit={commit}
      />
      <td className="px-1 py-0 align-middle min-w-[120px]">
        <input
          type="text"
          aria-label="Comment"
          value={row.comment}
          placeholder="Notes"
          disabled={readOnly}
          onChange={(e) => patch('comment', e.target.value)}
          onBlur={commit}
          className="w-full bg-transparent border-0 outline-0 px-2 py-1.5 text-sm focus:ring-2 focus:ring-[var(--theme-primary)] focus:rounded"
        />
      </td>
      <td className="px-1 py-0 align-middle text-right">
        {row.id && !readOnly && (
          <button
            type="button"
            aria-label={`Delete row ${row.cashierRowNumber}`}
            onClick={() => onDelete(row)}
            className="text-zinc-400 hover:text-red-600 px-2 py-1 text-sm"
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
}

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
    <td className="px-1 py-0 align-middle">
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
          'w-[80px] bg-transparent border-0 outline-0 px-2 py-1.5 text-sm text-right tabular-nums',
          'focus:ring-2 focus:ring-[var(--theme-primary)] focus:rounded',
          accent ? 'text-zinc-500 dark:text-zinc-400' : '',
          bold ? 'font-semibold' : '',
        ].join(' ')}
      />
    </td>
  )
}
