// heals-system-rebuild — Owner Commission Rate Editor (Task 19.1)
//
// Lets the owner add a new effective row to `commission_rates` for any
// (course, duration, rateType) cell. The action `setStaffRate` /
// `setFreelanceRate` insert (not upsert) so history is preserved.
//
// The page also lists every rate row currently in the table grouped
// by rate_type / course for transparency.

import { COURSES, DURATIONS } from '@/domain/types'
import { createServerSupabaseClient } from '@/lib/supabase/server'

import RateEditor from './RateEditor'

export const dynamic = 'force-dynamic'

interface RawRate {
  id: string
  course: string
  duration: number
  rate_type: 'regular' | 'freelance'
  branch_group: string
  amount: number | string
  effective_from: string
}

function n(v: unknown): number {
  if (typeof v === 'number') return v
  if (v == null) return 0
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

export default async function RatesPage() {
  const sb = createServerSupabaseClient()
  const { data } = await sb
    .from('commission_rates')
    .select('id, course, duration, rate_type, branch_group, amount, effective_from')
    .order('course')
    .order('duration')
    .order('effective_from', { ascending: false })

  const rows = ((data ?? []) as Record<string, unknown>[]).map(
    (r): RawRate => ({
      id: String(r.id ?? ''),
      course: String(r.course ?? ''),
      duration: n(r.duration),
      rate_type: r.rate_type === 'freelance' ? 'freelance' : 'regular',
      branch_group: String(r.branch_group ?? 'all'),
      amount: n(r.amount),
      effective_from: String(r.effective_from ?? ''),
    }),
  )

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl sm:text-3xl font-semibold">Commission rates</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Add a new effective rate. Old rows stay so historical days
          replay against the rate that was in effect at the time.
          Bishop FR freelance rate is computed as <code>max(0, kim − 1)</code>{' '}
          at lookup time, never stored.
        </p>
      </header>

      <RateEditor courses={[...COURSES]} durations={[...DURATIONS]} />

      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        <header className="px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/40">
          <h2 className="text-sm font-semibold uppercase tracking-wide">
            Rate history ({rows.length} rows)
          </h2>
        </header>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wide text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Course</th>
                <th className="px-3 py-2 text-left">Dur</th>
                <th className="px-3 py-2 text-left">Group</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-left">Effective</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className="px-3 py-1.5">
                    <span
                      className={[
                        'rounded-md px-2 py-0.5 text-xs font-medium',
                        r.rate_type === 'freelance'
                          ? 'bg-fuchsia-100 dark:bg-fuchsia-950/40 text-fuchsia-800 dark:text-fuchsia-200'
                          : 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200',
                      ].join(' ')}
                    >
                      {r.rate_type}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">{r.course}</td>
                  <td className="px-3 py-1.5">{r.duration}</td>
                  <td className="px-3 py-1.5 text-zinc-500">{r.branch_group}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-mono">
                    {Number(r.amount).toFixed(2)}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-xs">{r.effective_from}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
