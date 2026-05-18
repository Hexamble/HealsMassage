'use client'

/**
 * heals-system-rebuild — Inline price editor.
 *
 * Pick a (course, duration, branch) cell + new price; submit calls
 * the `setPrice` server action. On success the page refreshes.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { setPrice } from '@/app/actions/setPrice'
import type { Branch, Course, Duration } from '@/domain/types'

export default function PriceEditor({
  courses,
  durations,
  branches,
}: {
  courses: Course[]
  durations: Duration[]
  branches: Branch[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [course, setCourse] = useState<Course>(courses[0])
  const [duration, setDuration] = useState<Duration>(durations[1] ?? durations[0])
  const [branch, setBranch] = useState<Branch>(branches[0])
  const [price, setPriceValue] = useState('')

  function submit() {
    const p = Number(price)
    if (!Number.isFinite(p) || p < 0) {
      setError('Price must be non-negative')
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        const result = await setPrice({ course, duration, branch, price: p })
        if (!result.ok) {
          setError(`${result.code}: ${result.message}`)
          return
        }
        setPriceValue('')
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  return (
    <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide mb-3">
        Update price
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 items-end">
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
            onChange={(e) => setDuration(Number(e.target.value) as Duration)}
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm w-full"
          >
            {durations.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Branch">
          <select
            value={branch}
            onChange={(e) => setBranch(e.target.value as Branch)}
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm w-full"
          >
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Price (RM)">
          <input
            type="text"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPriceValue(e.target.value)}
            placeholder="0.00"
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm w-full text-right tabular-nums"
          />
        </Field>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-md bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save price'}
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
