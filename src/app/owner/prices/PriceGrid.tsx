'use client'

/**
 * Unified price & commission grid with inline editing.
 *
 * Renders 5 sections (Customer Prices × 2, Staff Commission, Freelance × 2)
 * in a compact grid layout. When edit mode is toggled, clicking a cell opens
 * an inline number input. On blur/Enter the appropriate server action fires.
 */

import { useState, useTransition, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'

import { setPrice } from '@/app/actions/setPrice'
import { setStaffRate } from '@/app/actions/setStaffRate'
import { setFreelanceRate } from '@/app/actions/setFreelanceRate'
import type { Course, Duration, Branch } from '@/domain/types'
import { COURSES, DURATIONS } from '@/domain/types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SectionDef {
  title: string
  type: 'price' | 'staff' | 'freelance'
  /** For price sections: which branch */
  branch?: Branch
  /** For freelance sections: which branch_group */
  branchGroup?: string
  data: Record<string, number | undefined>
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PriceGrid({ sections }: { sections: SectionDef[] }) {
  const [editing, setEditing] = useState(false)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className={[
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            editing
              ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200'
              : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
          ].join(' ')}
        >
          {editing ? '✏ Editing — click to lock' : '✏ Edit'}
        </button>
      </div>

      {sections.map((sec, idx) => (
        <GridSection key={idx} section={sec} editing={editing} />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Grid Section
// ---------------------------------------------------------------------------

function GridSection({
  section,
  editing,
}: {
  section: SectionDef
  editing: boolean
}) {
  return (
    <section className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      <header className="bg-green-700 text-white px-3 py-2">
        <h2 className="text-sm font-semibold">{section.title}</h2>
      </header>
      <div className="overflow-x-auto bg-white dark:bg-zinc-900">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-700">
              <th className="px-2 py-1.5 text-left text-sm font-semibold text-zinc-700 dark:text-zinc-100">
                Course
              </th>
              {DURATIONS.map((d) => (
                <th
                  key={d}
                  className="px-2 py-1.5 text-right text-sm font-semibold text-zinc-700 dark:text-zinc-100"
                >
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COURSES.map((course) => {
              const cells = DURATIONS.map(
                (d) => section.data[`${course}|${d}`],
              )
              // Show row even if all empty (to match the spec layout)
              return (
                <tr
                  key={course}
                  className="border-b border-zinc-100 dark:border-zinc-700"
                >
                  <td className="px-2 py-1 font-medium text-zinc-800 dark:text-zinc-100">
                    {course}
                  </td>
                  {DURATIONS.map((d, i) => (
                    <Cell
                      key={d}
                      value={cells[i]}
                      editing={editing}
                      section={section}
                      course={course}
                      duration={d}
                    />
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Editable Cell
// ---------------------------------------------------------------------------

function Cell({
  value,
  editing,
  section,
  course,
  duration,
}: {
  value: number | undefined
  editing: boolean
  section: SectionDef
  course: Course
  duration: Duration
}) {
  const router = useRouter()
  const [active, setActive] = useState(false)
  const [inputVal, setInputVal] = useState('')
  const [pending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  const save = useCallback(() => {
    const num = Number(inputVal)
    if (!Number.isFinite(num) || num < 0) {
      setActive(false)
      return
    }
    startTransition(async () => {
      try {
        if (section.type === 'price') {
          await setPrice({
            course,
            duration,
            branch: section.branch!,
            price: num,
          })
        } else if (section.type === 'staff') {
          await setStaffRate({
            course,
            duration,
            rateType: 'regular',
            branchGroup: section.branchGroup ?? 'all',
            amount: num,
          })
        } else {
          await setFreelanceRate({
            course,
            duration,
            rateType: 'freelance',
            branchGroup: section.branchGroup ?? 'all',
            amount: num,
          })
        }
        router.refresh()
      } catch {
        // silently fail — the page will show stale data
      }
      setActive(false)
    })
  }, [inputVal, section, course, duration, router, startTransition])

  if (editing && active) {
    return (
      <td className="px-1 py-0.5">
        <input
          ref={inputRef}
          type="number"
          step="any"
          min="0"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') setActive(false)
          }}
          disabled={pending}
          autoFocus
          className="w-16 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-1 py-0.5 text-xs text-right tabular-nums dark:text-zinc-100"
        />
      </td>
    )
  }

  const display = value != null ? Math.round(value) : ''

  return (
    <td
      className={[
        'px-2 py-1 text-right tabular-nums font-mono text-zinc-700 dark:text-zinc-100',
        editing ? 'cursor-pointer hover:bg-green-50 dark:hover:bg-green-900/20' : '',
      ].join(' ')}
      onClick={() => {
        if (!editing) return
        setInputVal(value != null ? String(Math.round(value)) : '')
        setActive(true)
      }}
    >
      {pending ? '…' : display}
    </td>
  )
}
