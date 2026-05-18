// heals-system-rebuild — Owner Price Editor (Task 19.2)
//
// Edit one cell of the `prices` table at a time. Server-rendered
// grid + an inline editor row similar to the rate editor. Bishop FR
// rows are seeded RM 2 less than Kim/Chu but the owner can adjust
// any cell individually.

import { BRANCHES, COURSES, DURATIONS, type Branch, type Course, type Duration } from '@/domain/types'
import { createServerSupabaseClient } from '@/lib/supabase/server'

import PriceEditor from './PriceEditor'

export const dynamic = 'force-dynamic'

interface RawPrice {
  course: string
  duration: number
  branch: string
  price: number | string
}

function n(v: unknown): number {
  if (typeof v === 'number') return v
  if (v == null) return 0
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

export default async function PricesPage() {
  const sb = createServerSupabaseClient()
  const { data } = await sb
    .from('prices')
    .select('course, duration, branch, price')
    .order('course')
    .order('duration')

  const rows = ((data ?? []) as Record<string, unknown>[]).map(
    (r): RawPrice => ({
      course: String(r.course ?? ''),
      duration: n(r.duration),
      branch: String(r.branch ?? ''),
      price: n(r.price),
    }),
  )

  // Build a lookup so the grid can render every (course×duration×branch)
  // combination, even cells that don't yet have a row.
  const lookup = new Map<string, number>()
  for (const r of rows) {
    lookup.set(`${r.course}|${r.duration}|${r.branch}`, Number(r.price))
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl sm:text-3xl font-semibold">Prices</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Customer price per (course × duration × branch). Cashier sees
          this number when picking the row, and can override at the
          point of sale for discounts.
        </p>
      </header>

      <PriceEditor
        courses={[...COURSES]}
        durations={[...DURATIONS]}
        branches={[...BRANCHES]}
      />

      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        <header className="px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/40">
          <h2 className="text-sm font-semibold uppercase tracking-wide">
            Current prices
          </h2>
        </header>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wide text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="px-3 py-2 text-left">Course</th>
                <th className="px-3 py-2 text-right">Dur</th>
                {BRANCHES.map((b) => (
                  <th key={b} className="px-3 py-2 text-right">
                    {b}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COURSES.flatMap((c: Course) =>
                DURATIONS.map((d: Duration) => {
                  const cells = BRANCHES.map((b: Branch) =>
                    lookup.get(`${c}|${d}|${b}`),
                  )
                  // Skip rows where every branch has no price.
                  if (cells.every((v) => v === undefined)) return null
                  return (
                    <tr
                      key={`${c}-${d}`}
                      className="border-b border-zinc-100 dark:border-zinc-800"
                    >
                      <td className="px-3 py-1.5 font-medium">{c}</td>
                      <td className="px-3 py-1.5 text-right">{d}</td>
                      {cells.map((v, i) => (
                        <td
                          key={`${c}-${d}-${BRANCHES[i]}`}
                          className="px-3 py-1.5 text-right tabular-nums font-mono"
                        >
                          {v == null ? '—' : Number(v).toFixed(2)}
                        </td>
                      ))}
                    </tr>
                  )
                }),
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
