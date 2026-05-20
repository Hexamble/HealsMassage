// Boss HQ — Salary Board (Google Sheets edition)
//
// Shows each staff member's commission for the current pay cycle,
// with EXTRA fallback logic and multi-branch summary.
// Reads directly from the Cashier_POS Google Sheet.

import Link from 'next/link'

import { getBusinessDate } from '@/domain/business-date'
import { cycleDates } from '@/domain/cycle'
import { BRANCHES, type Branch } from '@/domain/types'
import { fetchAllBranches } from '@/lib/sheets'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// EXTRA logic
// ---------------------------------------------------------------------------

function isFreelance(method: string): boolean {
  return method.trim().toLowerCase() === 'freelance'
}

function isExtraMethod(method: string): boolean {
  const upper = method.trim().toUpperCase()
  if (!upper.startsWith('EXTRA')) return false
  if (upper.length === 5) return true
  return !/[A-Z0-9]/.test(upper.charAt(5))
}

function decodeExtraDest(method: string): Branch | null {
  if (!isExtraMethod(method)) return null
  const suffix = method.trim().toUpperCase().slice(5).replace(/^[\s\-_]+/, '')
  if (suffix.startsWith('KIM') || suffix.startsWith('KM')) return 'Kimberry'
  if (suffix.startsWith('BIS') || suffix.startsWith('BS')) return 'Bishop'
  if (suffix.startsWith('CHU') || suffix.startsWith('CH') || suffix.startsWith('CL'))
    return 'Chulia'
  return null
}

function matchKey(staff: string, course: string, duration: number, branch: Branch): string {
  return `${staff.trim().toLowerCase()}|${course.trim().toUpperCase()}|${Math.round(duration)}|${branch}`
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StaffSalaryRow {
  name: string
  total: number
}

interface BranchSection {
  branch: Branch
  staff: StaffSalaryRow[]
  total: number
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function SalaryBoardPage({
  searchParams,
}: {
  searchParams: { monthIdx?: string; year?: string }
}) {
  const today = getBusinessDate(new Date())
  const todayDate = new Date(today + 'T00:00:00Z')
  const fallbackMonth = todayDate.getUTCMonth()
  const fallbackYear = todayDate.getUTCFullYear()

  const payCycleStartDay = 21

  const monthIdx = searchParams.monthIdx
    ? Math.max(0, Math.min(11, parseInt(searchParams.monthIdx, 10)))
    : fallbackMonth
  const year = searchParams.year
    ? parseInt(searchParams.year, 10)
    : fallbackYear

  const cycle = cycleDates(monthIdx, year, payCycleStartDay)

  // Fetch all branches from Google Sheets
  const allRows = await fetchAllBranches()

  // Filter to cycle days — since the sheet only has today's data,
  // we use all rows (the sheet represents the current day's transactions).
  // For a full cycle view we'd need historical data, but the sheet is live.
  const cycleDaysSet = new Set(cycle.days)
  const cycleRows = allRows.filter((r) => cycleDaysSet.has(r.businessDate))

  // Build canonical salary view with EXTRA fallback
  // Pass 1: collect real-row match keys
  const realKeys = new Set<string>()
  for (const r of cycleRows) {
    if (isFreelance(r.method)) continue
    if (decodeExtraDest(r.method) !== null) continue
    realKeys.add(matchKey(r.staff, r.course, r.duration, r.branch))
  }

  // Pass 2: attribute commissions
  // staffLc → branch → total
  const staffBranchTotals = new Map<string, Map<Branch, number>>()
  const staffDisplayNames = new Map<string, string>()

  for (const r of cycleRows) {
    if (isFreelance(r.method)) continue
    if (!r.staff.trim()) continue

    const staffLc = r.staff.trim().toLowerCase()
    if (!staffDisplayNames.has(staffLc)) {
      staffDisplayNames.set(staffLc, r.staff.trim())
    }

    let attribBranch: Branch = r.branch

    const dest = decodeExtraDest(r.method)
    if (dest !== null) {
      // Check if covered by a real row at destination
      const k = matchKey(r.staff, r.course, r.duration, dest)
      if (realKeys.has(k)) continue // covered — skip
      attribBranch = dest // fallback to destination
    } else if (isExtraMethod(r.method)) {
      // Undecodable EXTRA — skip
      continue
    }

    let branchMap = staffBranchTotals.get(staffLc)
    if (!branchMap) {
      branchMap = new Map()
      staffBranchTotals.set(staffLc, branchMap)
    }
    branchMap.set(attribBranch, (branchMap.get(attribBranch) ?? 0) + r.commission)
  }

  // Build per-branch sections
  const sections: BranchSection[] = []
  for (const branch of BRANCHES) {
    const staff: StaffSalaryRow[] = []
    for (const [staffLc, branchMap] of Array.from(staffBranchTotals)) {
      const total = branchMap.get(branch) ?? 0
      if (total === 0) continue
      staff.push({
        name: staffDisplayNames.get(staffLc) ?? staffLc,
        total: Math.round(total * 100) / 100,
      })
    }
    staff.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    if (staff.length > 0) {
      sections.push({
        branch,
        staff,
        total: staff.reduce((s, r) => s + r.total, 0),
      })
    }
  }

  // Multi-branch summary: staff with totals at ≥2 branches
  const multiBranch: StaffSalaryRow[] = []
  for (const [staffLc, branchMap] of Array.from(staffBranchTotals)) {
    const nonZeroBranches = Array.from(branchMap.values()).filter((v) => v > 0)
    if (nonZeroBranches.length < 2) continue
    const total = nonZeroBranches.reduce((s, v) => s + v, 0)
    multiBranch.push({
      name: staffDisplayNames.get(staffLc) ?? staffLc,
      total: Math.round(total * 100) / 100,
    })
  }
  multiBranch.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))

  // Navigation
  const prevMonthIdx = monthIdx === 0 ? 11 : monthIdx - 1
  const prevYear = monthIdx === 0 ? year - 1 : year
  const nextMonthIdx = monthIdx === 11 ? 0 : monthIdx + 1
  const nextYear = monthIdx === 11 ? year + 1 : year

  const now = new Date().toLocaleString('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Salary Board</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Cycle: <span className="font-mono">{cycle.startDate}</span> →{' '}
            <span className="font-mono">{cycle.endDate}</span> · Day{' '}
            {payCycleStartDay} start
          </p>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
            Last refreshed: {now} ·{' '}
            <Link
              href={`/owner/salary?monthIdx=${monthIdx}&year=${year}`}
              className="underline hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              ⟳ Refresh
            </Link>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`?monthIdx=${prevMonthIdx}&year=${prevYear}`}
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            ← Prev
          </a>
          <a
            href={`?monthIdx=${nextMonthIdx}&year=${nextYear}`}
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            Next →
          </a>
        </div>
      </header>

      {sections.length === 0 && multiBranch.length === 0 ? (
        <p className="text-sm text-zinc-500 italic">
          No salary data for this cycle yet.
        </p>
      ) : (
        <>
          {sections.map((sec) => (
            <SectionTable key={sec.branch} section={sec} />
          ))}

          {multiBranch.length > 0 && (
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800">
                <h2 className="text-sm font-semibold uppercase tracking-wide">
                  Multi-Branch Summary
                </h2>
              </div>
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 dark:border-zinc-800 text-xs uppercase text-zinc-500">
                    <th className="px-4 py-2 text-left">Staff</th>
                    <th className="px-4 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {multiBranch.map((s) => (
                    <tr
                      key={s.name}
                      className="border-b border-zinc-50 dark:border-zinc-800"
                    >
                      <td className="px-4 py-2 font-medium">{s.name}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold">
                        {s.total.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-zinc-50 dark:bg-zinc-800 font-semibold">
                    <td className="px-4 py-2">Total</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {multiBranch
                        .reduce((s, r) => s + r.total, 0)
                        .toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function SectionTable({ section }: { section: BranchSection }) {
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800">
        <h2 className="text-sm font-semibold uppercase tracking-wide">
          {section.branch}
        </h2>
      </div>
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-100 dark:border-zinc-800 text-xs uppercase text-zinc-500">
            <th className="px-4 py-2 text-left">Staff</th>
            <th className="px-4 py-2 text-right">Commission</th>
          </tr>
        </thead>
        <tbody>
          {section.staff.map((s) => (
            <tr
              key={s.name}
              className="border-b border-zinc-50 dark:border-zinc-800"
            >
              <td className="px-4 py-2 font-medium">{s.name}</td>
              <td className="px-4 py-2 text-right tabular-nums">
                {s.total.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-zinc-50 dark:bg-zinc-800 font-semibold">
            <td className="px-4 py-2">Total</td>
            <td className="px-4 py-2 text-right tabular-nums">
              {section.total.toFixed(2)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
