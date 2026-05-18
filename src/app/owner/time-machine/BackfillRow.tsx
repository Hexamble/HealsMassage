'use client'

/**
 * heals-system-rebuild — Time Machine backfill editor.
 *
 * Renders one editable row at the bottom of each branch table on the
 * Time Machine page. The owner fills it in and submits to backfill a
 * historical session into that branch on that business date — calling
 * `writeTransaction` with the `businessDate` override owner-only field
 * (Req 13.3).
 *
 * Why a single inline row instead of replacing the whole table:
 *   - The Time Machine's primary use case is REVIEWING history, not
 *     bulk editing. Inline append-one row is the 90% case.
 *   - For deep edits / corrections, the owner navigates to
 *     `/cashier/{branch}` and uses the cashier route's full editable
 *     table (which already supports owner historical writes).
 *
 * Validates: Requirements 13.1, 13.3.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { writeTransaction } from '@/app/actions/writeTransaction'
import {
  COURSES,
  DURATIONS,
  TRANSACTION_METHODS,
  type Branch,
  type Course,
  type Duration,
} from '@/domain/types'

export default function BackfillRow({
  branch,
  date,
  nextRowNumber,
}: {
  branch: Branch
  date: string
  /** Suggested next cashier_row_number; the action will overwrite. */
  nextRowNumber: number
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [staff, setStaff] = useState('')
  const [course, setCourse] = useState<Course>('FR')
  const [duration, setDuration] = useState<Duration>(60)
  const [method, setMethod] = useState<string>('CASH')
  const [price, setPrice] = useState('')
  const [cash, setCash] = useState('')
  const [qr, setQr] = useState('')
  const [credit, setCredit] = useState('')

  function reset() {
    setStaff('')
    setCourse('FR')
    setDuration(60)
    setMethod('CASH')
    setPrice('')
    setCash('')
    setQr('')
    setCredit('')
    setError(null)
  }

  function submit() {
    if (!staff.trim()) {
      setError('Staff name required')
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        const payload: Record<string, unknown> = {
          branch,
          businessDate: date, // owner-only override
          cashierRowNumber: nextRowNumber,
          staff: staff.trim(),
          course,
          duration,
          method,
          cash: Number(cash) || 0,
          qr: Number(qr) || 0,
          credit: Number(credit) || 0,
        }
        if (price) {
          payload.price = Number(price) || 0
        }
        const result = await writeTransaction(payload)
        if (!result.ok) {
          setError(`${result.code}: ${result.message}`)
          return
        }
        reset()
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  return (
    <div className="border-t border-zinc-200 dark:border-zinc-800 px-4 py-3 bg-zinc-50/40 dark:bg-zinc-800/30">
      <div className="flex flex-wrap items-end gap-2 text-xs">
        <Field label="Staff">
          <input
            type="text"
            value={staff}
            onChange={(e) => setStaff(e.target.value)}
            placeholder="Name"
            className="w-32 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1"
          />
        </Field>
        <Field label="Course">
          <select
            value={course}
            onChange={(e) => setCourse(e.target.value as Course)}
            className="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1"
          >
            {COURSES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Dur">
          <select
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value) as Duration)}
            className="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1"
          >
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Method">
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1"
          >
            {TRANSACTION_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Cash">
          <input
            type="text"
            inputMode="decimal"
            value={cash}
            onChange={(e) => setCash(e.target.value)}
            placeholder="0"
            className="w-16 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-right tabular-nums"
          />
        </Field>
        <Field label="QR">
          <input
            type="text"
            inputMode="decimal"
            value={qr}
            onChange={(e) => setQr(e.target.value)}
            placeholder="0"
            className="w-16 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-right tabular-nums"
          />
        </Field>
        <Field label="Credit">
          <input
            type="text"
            inputMode="decimal"
            value={credit}
            onChange={(e) => setCredit(e.target.value)}
            placeholder="0"
            className="w-16 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-right tabular-nums"
          />
        </Field>
        <Field label="Price (optional)">
          <input
            type="text"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="auto"
            className="w-20 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-right tabular-nums"
          />
        </Field>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-md bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-3 py-1 text-xs font-medium disabled:opacity-50"
        >
          {pending ? 'Adding…' : `Backfill row ${nextRowNumber}`}
        </button>
      </div>
      {error && (
        <div className="mt-2 text-xs text-red-700 bg-red-50 dark:bg-red-950/30 px-2 py-1 rounded">
          {error}
        </div>
      )}
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col">
      <label className="text-[9px] uppercase tracking-wide text-zinc-500 mb-0.5">
        {label}
      </label>
      {children}
    </div>
  )
}
