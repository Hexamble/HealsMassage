'use client'

/**
 * heals-system-rebuild — Inline editor for adding new commission-rate
 * rows. Inserts via the heals server actions; on success the page
 * refreshes to show the new row.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { setStaffRate } from '@/app/actions/setStaffRate'
import { setFreelanceRate } from '@/app/actions/setFreelanceRate'
import type { Course, Duration } from '@/domain/types'

export default function RateEditor({
  courses,
  durations,
}: {
  courses: Course[]
  durations: Duration[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [course, setCourse] = useState<Course>(courses[0])
  const [duration, setDuration] = useState<Duration>(durations[1] ?? durations[0])
  const [rateType, setRateType] = useState<'regular' | 'freelance'>('regular')
  const [amount, setAmount] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState(
    new Date().toISOString().slice(0, 10),
  )

  function submit() {
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt < 0) {
      setError('Amount must be a non-negative number')
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        const fn = rateType === 'regular' ? setStaffRate : setFreelanceRate
        const result = await fn({
          course,
          duration,
          rateType,
          branchGroup: 'all',
          amount: amt,
          effectiveFrom,
        })
        if (!result.ok) {
          setError(`${result.code}: ${result.message}`)
          return
        }
        setAmount('')
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  return (
    <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide mb-3">
        Add new rate
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 items-end">
        <Field label="Type">
          <select
            value={rateType}
            onChange={(e) =>
              setRateType(e.target.value as 'regular' | 'freelance')
            }
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm w-full"
          >
            <option value="regular">Regular</option>
            <option value="freelance">Freelance</option>
          </select>
        </Field>
        <Field label="Course">
          <select
            value={course}
            onChange={(e) => setCourse(e.target.value as Course)}
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm w-full"
          >
            {courses.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Duration">
          <select
            value={duration}
            onChange={(e) =>
              setDuration(Number(e.target.value) as Duration)
            }
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm w-full"
          >
            {durations.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount (RM)">
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm w-full text-right tabular-nums"
          />
        </Field>
        <Field label="Effective from">
          <input
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm w-full"
          />
        </Field>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-md bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Add rate'}
        </button>
      </div>
      {error && (
        <div className="mt-3 text-xs text-red-700 bg-red-50 dark:bg-red-950/30 p-2 rounded">
          {error}
        </div>
      )}
    </section>
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
      <label className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">
        {label}
      </label>
      {children}
    </div>
  )
}
