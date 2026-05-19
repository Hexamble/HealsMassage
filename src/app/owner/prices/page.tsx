// Unified Prices & Commission Rates page.
//
// Displays 5 grid sections:
//   1. Customer Prices — Kimberry & Chulia
//   2. Customer Prices — Bishop (FR -RM2)
//   3. Staff Commission — All Branches
//   4. Freelance — Kimberry & Chulia
//   5. Freelance — Bishop

import { COURSES, DURATIONS } from '@/domain/types'
import { createServerSupabaseClient } from '@/lib/supabase/server'

import PriceGrid, { type SectionDef } from './PriceGrid'

export const dynamic = 'force-dynamic'

function n(v: unknown): number | undefined {
  if (v == null) return undefined
  const x = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(x) && x > 0 ? x : undefined
}

export default async function PricesPage() {
  const sb = createServerSupabaseClient()

  // Fetch prices (keyed by course, duration, branch)
  const { data: priceRows } = await sb
    .from('prices')
    .select('course, duration, branch, price')

  // Fetch commission rates — latest effective row per (course, duration, rate_type, branch_group)
  const { data: rateRows } = await sb
    .from('commission_rates')
    .select('course, duration, rate_type, branch_group, amount, effective_from')
    .order('effective_from', { ascending: false })

  // --- Build price lookup: key = "course|duration|branch" ---
  const priceLookup = new Map<string, number>()
  for (const r of (priceRows ?? []) as Record<string, unknown>[]) {
    const key = `${r.course}|${r.duration}|${r.branch}`
    const val = n(r.price)
    if (val != null) priceLookup.set(key, val)
  }

  // --- Build rate lookup: key = "course|duration|rateType|branchGroup" ---
  // Only keep the latest effective_from per unique key
  const rateSeen = new Set<string>()
  const rateLookup = new Map<string, number>()
  for (const r of (rateRows ?? []) as Record<string, unknown>[]) {
    const key = `${r.course}|${r.duration}|${r.rate_type}|${r.branch_group}`
    if (rateSeen.has(key)) continue // already have the latest
    rateSeen.add(key)
    const val = n(r.amount)
    if (val != null) rateLookup.set(key, val)
  }

  // --- Helper to build section data maps ---
  function buildPriceData(branch: string): Record<string, number | undefined> {
    const out: Record<string, number | undefined> = {}
    for (const c of COURSES) {
      for (const d of DURATIONS) {
        const v = priceLookup.get(`${c}|${d}|${branch}`)
        out[`${c}|${d}`] = v
      }
    }
    return out
  }

  function buildRateData(
    rateType: 'regular' | 'freelance',
    branchGroup: string,
  ): Record<string, number | undefined> {
    const out: Record<string, number | undefined> = {}
    for (const c of COURSES) {
      for (const d of DURATIONS) {
        const v = rateLookup.get(`${c}|${d}|${rateType}|${branchGroup}`)
        out[`${c}|${d}`] = v
      }
    }
    return out
  }

  // --- Section 1: Customer Prices — Kimberry & Chulia ---
  // Kimberry and Chulia share the same prices, so we use Kimberry as source
  const kimPriceData = buildPriceData('Kimberry')

  // --- Section 2: Customer Prices — Bishop ---
  const bishopPriceData = buildPriceData('Bishop')

  // --- Section 3: Staff Commission — All Branches ---
  const staffData = buildRateData('regular', 'all')

  // --- Section 4: Freelance — Kimberry & Chulia ---
  const freelanceAllData = buildRateData('freelance', 'all')

  // --- Section 5: Freelance — Bishop ---
  const freelanceBishopData = buildRateData('freelance', 'bishop')

  const sections: SectionDef[] = [
    {
      title: '🏷️ CUSTOMER PRICES — Kimberry & Chulia',
      type: 'price',
      branch: 'Kimberry',
      data: kimPriceData,
    },
    {
      title: '🏷️ CUSTOMER PRICES — Bishop (FR −RM2)',
      type: 'price',
      branch: 'Bishop',
      data: bishopPriceData,
    },
    {
      title: '💼 STAFF COMMISSION — All Branches',
      type: 'staff',
      branchGroup: 'all',
      data: staffData,
    },
    {
      title: '🔶 FREELANCE — Kimberry & Chulia',
      type: 'freelance',
      branchGroup: 'all',
      data: freelanceAllData,
    },
    {
      title: '🔶 FREELANCE — Bishop',
      type: 'freelance',
      branchGroup: 'bishop',
      data: freelanceBishopData,
    },
  ]

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl sm:text-3xl font-semibold dark:text-zinc-100">
          Prices &amp; Commission Rates
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          All customer prices and commission rates in one view. Toggle edit
          mode to update any cell inline.
        </p>
      </header>

      <PriceGrid sections={sections} />
    </div>
  )
}
