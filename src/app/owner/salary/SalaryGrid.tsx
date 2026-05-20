'use client'

import { useCallback, useState, useRef, useTransition } from 'react'
import { ownerSetDayCommission } from '@/app/actions/ownerSetDayCommission'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StaffDayData {
  /** Transaction ID for this staff+date (needed for the server action). */
  txId: string | null
  /** Sum of totalCommission for this staff on this date. */
  commission: number
  /** Sum of balmBonus for this staff on this date. */
  balm: number
}

export interface StaffRow {
  name: string
  /** Keyed by yyyy-MM-dd */
  days: Record<string, StaffDayData>
  totalCommission: number
  totalBalm: number
}

export interface BranchSectionData {
  branch: string
  staff: StaffRow[]
}

interface DayHeader {
  date: string
  dayOfWeek: string
  dayNum: string
}

interface Props {
  sections: BranchSectionData[]
  dayHeaders: DayHeader[]
  today: string
}

// ---------------------------------------------------------------------------
// Editable Cell
// ---------------------------------------------------------------------------

function EditableCell({
  value,
  txId,
  field,
  isToday,
  editMode,
}: {
  value: number
  txId: string | null
  field: 'baseCommission' | 'balmBonus'
  isToday: boolean
  editMode: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [localValue, setLocalValue] = useState('')
  const [displayValue, setDisplayValue] = useState(value)
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  const bgClass = isToday ? 'bg-teal-50 dark:bg-teal-900/30' : ''

  const handleClick = useCallback(() => {
    if (!editMode) return
    setLocalValue(displayValue ? String(displayValue) : '')
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }, [displayValue, editMode])

  const handleSave = useCallback(() => {
    setEditing(false)
    const num = parseFloat(localValue)
    if (isNaN(num) || num < 0) return
    if (num === displayValue) return

    setDisplayValue(num)

    if (!txId) return // No transaction to update

    startTransition(async () => {
      await ownerSetDayCommission({ id: txId, [field]: num })
    })
  }, [localValue, displayValue, txId, field])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleSave()
      if (e.key === 'Escape') setEditing(false)
    },
    [handleSave],
  )

  if (editing) {
    return (
      <td className={`border border-zinc-200 dark:border-zinc-700 px-1 py-0.5 text-right ${bgClass}`}>
        <input
          ref={inputRef}
          type="number"
          min="0"
          step="1"
          className="w-full text-xs text-right bg-white dark:bg-zinc-900 border border-blue-400 rounded px-0.5 py-0 outline-none"
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          autoFocus
        />
      </td>
    )
  }

  return (
    <td
      className={`border border-zinc-200 dark:border-zinc-700 px-1 py-0.5 text-right text-xs tabular-nums ${editMode ? 'cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/30' : ''} ${bgClass} ${isPending ? 'opacity-50' : ''}`}
      onClick={handleClick}
    >
      {displayValue ? displayValue : ''}
    </td>
  )
}

// ---------------------------------------------------------------------------
// Main Grid
// ---------------------------------------------------------------------------

export default function SalaryGrid({ sections, dayHeaders, today }: Props) {
  const [editMode, setEditMode] = useState(false)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => setEditMode((v) => !v)}
          className={[
            'rounded-md border px-4 py-1.5 text-sm font-medium transition-colors',
            editMode
              ? 'border-rose-400 bg-rose-100 text-rose-800 hover:bg-rose-200 dark:border-rose-700 dark:bg-rose-950/50 dark:text-rose-200 dark:hover:bg-rose-900/60'
              : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700',
          ].join(' ')}
        >
          {editMode ? '✓ Done editing' : '✏ Edit'}
        </button>
      </div>

      {sections.map((section) => (
        <section
          key={section.branch}
          className="border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 overflow-hidden"
        >
          <header className="px-3 py-2 border-b border-zinc-200 bg-zinc-50 dark:bg-zinc-800">
            <h2 className="text-sm font-semibold uppercase tracking-wide">
              {section.branch}
            </h2>
          </header>
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-xs">
              <thead>
                {/* Day-of-week row */}
                <tr className="border-b border-zinc-100">
                  <th className="sticky left-0 z-10 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 px-2 py-1 text-left w-20" />
                  {dayHeaders.map((h) => (
                    <th
                      key={h.date + '-dow'}
                      className={`border border-zinc-200 dark:border-zinc-700 px-1 py-0.5 text-center font-medium text-[10px] uppercase text-zinc-500 ${h.date === today ? 'bg-teal-50 dark:bg-teal-900/30' : ''}`}
                    >
                      {h.dayOfWeek}
                    </th>
                  ))}
                  <th className="border border-zinc-200 dark:border-zinc-700 px-2 py-0.5 text-center font-semibold text-[10px] uppercase text-zinc-600">
                    TOTAL
                  </th>
                  <th className="border border-zinc-200 dark:border-zinc-700 px-2 py-0.5 text-center font-semibold text-[10px] uppercase text-zinc-600 whitespace-nowrap">
                    TOTAL+BALM
                  </th>
                </tr>
                {/* Day number row */}
                <tr className="border-b border-zinc-200">
                  <th className="sticky left-0 z-10 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 px-2 py-1 text-left w-20" />
                  {dayHeaders.map((h) => (
                    <th
                      key={h.date + '-num'}
                      className={`border border-zinc-200 dark:border-zinc-700 px-1 py-0.5 text-center font-mono text-[10px] text-zinc-500 ${h.date === today ? 'bg-teal-50 dark:bg-teal-900/30' : ''}`}
                    >
                      {h.dayNum}
                    </th>
                  ))}
                  <th className="border border-zinc-200 dark:border-zinc-700 px-2 py-0.5" />
                  <th className="border border-zinc-200 dark:border-zinc-700 px-2 py-0.5" />
                </tr>
              </thead>
              <tbody>
                {section.staff.map((s) => (
                  <StaffRows
                    key={s.name}
                    staff={s}
                    dayHeaders={dayHeaders}
                    today={today}
                    editMode={editMode}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {sections.length === 0 && (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-6 text-sm text-zinc-500">
          No transactions in this cycle yet.
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Staff Rows (commission + balm)
// ---------------------------------------------------------------------------

function StaffRows({
  staff,
  dayHeaders,
  today,
  editMode,
}: {
  staff: StaffRow
  dayHeaders: DayHeader[]
  today: string
  editMode: boolean
}) {
  return (
    <>
      {/* Commission row */}
      <tr className="border-b border-zinc-100">
        <td className="sticky left-0 z-10 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 px-2 py-1 font-bold text-xs whitespace-nowrap">
          {staff.name}
        </td>
        {dayHeaders.map((h) => {
          const dayData = staff.days[h.date]
          return (
            <EditableCell
              key={h.date + '-comm'}
              value={dayData?.commission ?? 0}
              txId={dayData?.txId ?? null}
              field="baseCommission"
              isToday={h.date === today}
              editMode={editMode}
            />
          )
        })}
        <td className="border border-zinc-200 dark:border-zinc-700 px-2 py-1 text-right font-semibold text-xs tabular-nums">
          {staff.totalCommission || ''}
        </td>
        <td className="border border-zinc-200 dark:border-zinc-700 px-2 py-1 text-right font-semibold text-xs tabular-nums">
          {staff.totalCommission + staff.totalBalm || ''}
        </td>
      </tr>
      {/* Balm row */}
      <tr className="border-b border-zinc-200">
        <td className="sticky left-0 z-10 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 px-2 py-1 text-xs text-zinc-400 pl-4">
          BALM
        </td>
        {dayHeaders.map((h) => {
          const dayData = staff.days[h.date]
          return (
            <EditableCell
              key={h.date + '-balm'}
              value={dayData?.balm ?? 0}
              txId={dayData?.txId ?? null}
              field="balmBonus"
              isToday={h.date === today}
              editMode={editMode}
            />
          )
        })}
        <td className="border border-zinc-200 dark:border-zinc-700 px-2 py-1 text-right text-xs text-zinc-400 tabular-nums">
          {staff.totalBalm || ''}
        </td>
        <td className="border border-zinc-200 dark:border-zinc-700 px-2 py-1" />
      </tr>
    </>
  )
}
