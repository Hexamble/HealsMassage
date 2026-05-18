/**
 * Owner-facing report computation for the heals-system-rebuild.
 *
 * Pure functions, no I/O. All outputs are derived from the same canonical
 * EXTRA-attribution rules used by the salary board, so a payout figure
 * here is provably equal to what the cashier panels and Boss HQ salary
 * board show for the same cycle.
 *
 * Exports:
 *   - {@link topEarners}          — staff ranked by cycle commission,
 *                                    freelance excluded (Req 22.2)
 *   - {@link uncoveredExtras}     — EXTRA rows that fell back (no matching
 *                                    real row at destination), used for
 *                                    owner reconciliation (Req 22.5)
 *   - {@link expenseBreakdown}    — per-branch / per-item expense roll-up
 *                                    over the cycle (Req 22.3)
 *   - {@link payoutReport}        — per-staff per-branch totals from the
 *                                    canonical view, grouped by branch
 *                                    attribution (Req 22.1)
 *
 * Validates: Requirements 22.1, 22.2, 22.3, 22.5
 *
 * Design references:
 *   - `c:/BILL/.kiro/specs/heals-system-rebuild/design.md` §"Domain Layer"
 *     (`reports.ts` row in the module table)
 *   - §"Salary Board Render" — same canonical-view algorithm reused here
 *
 * Property tests (task 4.13, 4.14):
 *   - Property 16 — top earners sorted descending, freelance excluded
 *   - Property 17 — uncovered EXTRA reconciliation matches canonical-view
 *                    fallback set exactly
 *
 * NOTE: The canonical-view algorithm is replicated locally for now. The
 * `salary-board.ts` module ships the same algorithm but on a legacy
 * `TransactionRow` shape (`commission`, `rowId`, …) inherited from the
 * salary-system-rebuild. Once task 4.4 migrates `buildCanonicalView` to
 * the heals `TransactionRow` shape (from `./types`), replace the local
 * pass-1/pass-2 with `import { buildCanonicalView } from './salary-board'`
 * and project its `CanonicalMap` into the per-staff aggregations below.
 * TODO(task-4.4): dedupe canonical-view logic with `salary-board.ts`.
 */

import type {
  Branch,
  Cycle,
  ExpenseRow,
  StaffMember,
  TransactionRow,
} from './types'
import { BRANCHES } from './types'
import {
  buildExtraMatchKey,
  decodeExtraDestination,
  isExtraMethod,
} from './extra'

// ---------------------------------------------------------------------------
// Internal helpers (local canonical-view replica — see TODO in file header)
// ---------------------------------------------------------------------------

function isFreelanceMethod(method: unknown): boolean {
  return String(method ?? '').trim().toLowerCase() === 'freelance'
}

/**
 * Per-row canonical-view entry. One input row produces zero or one
 * entries (Freelance, undecodable-EXTRA, and covered-EXTRA rows produce
 * none). The `branch` field is the ATTRIBUTION branch (which differs
 * from `row.branch` for an uncovered EXTRA, where it equals the decoded
 * destination).
 */
interface CanonicalEntry {
  /** Reference back to the source row — needed by `uncoveredExtras`. */
  row: TransactionRow
  /** lower(trim(staff)) — joins to roster + groups across branches. */
  staffLc: string
  /** trim(staff) — display form preserved for report output. */
  staffDisplay: string
  /** Attribution branch (post-EXTRA fallback). */
  branch: Branch
  /** `yyyy-MM-dd`. */
  date: string
  /** `totalCommission` of the source row. */
  total: number
  /** True when this entry came from an uncovered EXTRA (fallback). */
  isFallbackExtra: boolean
}

/**
 * Run the two-pass canonical-view algorithm and emit per-row entries.
 *
 *   Pass 1 — collect match keys of every real (non-EXTRA, non-Freelance)
 *            row at its OWN branch.
 *   Pass 2 — for each row:
 *              - Freelance              → drop
 *              - real (non-EXTRA)       → emit at row.branch
 *              - EXTRA, decodable:
 *                  match-key covered    → drop (real row credits dest)
 *                  match-key uncovered  → emit at decoded dest (fallback)
 *              - EXTRA, undecodable     → drop (intent unclear)
 *
 * The same algorithm lives in `salary-board.ts` on the legacy row shape;
 * see file header TODO for the dedupe plan.
 */
function buildCanonicalEntries(
  rows: ReadonlyArray<TransactionRow>,
): CanonicalEntry[] {
  // Pass 1: real-row match keys at OWN branch.
  const realKeys = new Set<string>()
  for (const row of rows) {
    if (isFreelanceMethod(row.method)) continue
    if (decodeExtraDestination(row.method) !== null) continue
    realKeys.add(
      buildExtraMatchKey({
        staff: row.staff,
        businessDate: row.businessDate,
        course: row.course,
        duration: row.duration,
        branch: row.branch,
      }),
    )
  }

  // Pass 2: emit canonical entries.
  const entries: CanonicalEntry[] = []
  for (const row of rows) {
    if (isFreelanceMethod(row.method)) continue

    let attribBranch: Branch = row.branch
    let isFallbackExtra = false

    const dest = decodeExtraDestination(row.method)
    if (dest !== null) {
      const k = buildExtraMatchKey({
        staff: row.staff,
        businessDate: row.businessDate,
        course: row.course,
        duration: row.duration,
        branch: dest,
      })
      if (realKeys.has(k)) continue // covered — drop
      attribBranch = dest
      isFallbackExtra = true
    } else if (isExtraMethod(row.method)) {
      // EXTRA-shaped but the destination didn't decode (e.g. `EXTRA QQ`).
      // Intent unclear — drop here. Owner can surface these via a
      // separate diagnostics view.
      continue
    }

    entries.push({
      row,
      staffLc: row.staff.trim().toLowerCase(),
      staffDisplay: row.staff.trim(),
      branch: attribBranch,
      date: row.businessDate,
      total: Number(row.totalCommission) || 0,
      isFallbackExtra,
    })
  }

  return entries
}

function inCycle(
  cycle: Cycle,
): (item: { businessDate: string }) => boolean {
  const days = new Set(cycle.days)
  return (item) => days.has(item.businessDate)
}

// ---------------------------------------------------------------------------
// topEarners — Requirement 22.2
// ---------------------------------------------------------------------------

/**
 * Per-staff cycle-total payout. Sorted descending by `total`; ties
 * broken by display name ascending so the order is fully deterministic.
 */
export interface TopEarner {
  /** Display name (trimmed; first occurrence in `rows` wins). */
  name: string
  /** Sum of canonical-view totals across all attribution branches. */
  total: number
}

/**
 * Rank staff by cycle commission, descending. Freelance rows are
 * excluded by the canonical-view filter; EXTRA fallback rules apply, so
 * rankings reflect the same totals shown on the salary board.
 *
 * Rows outside `cycle.days` are ignored, so callers may pass full-month
 * arrays without pre-filtering.
 *
 * @see Requirement 22.2 — top earners ranking, freelance excluded.
 */
export function topEarners(
  rows: ReadonlyArray<TransactionRow>,
  cycle: Cycle,
): TopEarner[] {
  const filtered = rows.filter(inCycle(cycle))
  const entries = buildCanonicalEntries(filtered)

  // Aggregate by lower(staff). Preserve the first display form we see
  // so the report mirrors how the cashier typed the name.
  const byStaff = new Map<string, { name: string; total: number }>()
  for (const e of entries) {
    const cur = byStaff.get(e.staffLc)
    if (cur) {
      cur.total += e.total
    } else {
      byStaff.set(e.staffLc, { name: e.staffDisplay, total: e.total })
    }
  }

  return Array.from(byStaff.values()).sort(
    (a, b) => b.total - a.total || a.name.localeCompare(b.name),
  )
}

// ---------------------------------------------------------------------------
// uncoveredExtras — Requirement 22.5
// ---------------------------------------------------------------------------

/**
 * Return the subset of input rows that are EXTRA markers with a
 * decodable destination AND no matching real row at that destination —
 * i.e. exactly the EXTRAs that the canonical view falls back to credit
 * at the destination branch.
 *
 * Match rules are identical to the canonical view (see
 * {@link buildCanonicalEntries}): same `(staff, businessDate, course,
 * duration, destinationBranch)` key. EXTRAs whose method is undecodable
 * are NOT included — they are excluded entirely from the canonical
 * view and belong on a separate "malformed EXTRA" diagnostics view.
 *
 * Returned rows are in the order they appear in the input, so callers
 * can present them grouped by branch / date as needed without a stable
 * sort.
 *
 * @see Requirement 22.5 — EXTRA reconciliation report.
 */
export function uncoveredExtras(
  rows: ReadonlyArray<TransactionRow>,
): TransactionRow[] {
  // Pass 1: collect real-row match keys (mirrors buildCanonicalEntries
  // pass 1; not deduped here so this function stays standalone for the
  // common case where callers already filtered to a single date / cycle).
  const realKeys = new Set<string>()
  for (const row of rows) {
    if (isFreelanceMethod(row.method)) continue
    if (decodeExtraDestination(row.method) !== null) continue
    realKeys.add(
      buildExtraMatchKey({
        staff: row.staff,
        businessDate: row.businessDate,
        course: row.course,
        duration: row.duration,
        branch: row.branch,
      }),
    )
  }

  const out: TransactionRow[] = []
  for (const row of rows) {
    const dest = decodeExtraDestination(row.method)
    if (dest === null) continue // not an EXTRA, or undecodable — both excluded.
    const k = buildExtraMatchKey({
      staff: row.staff,
      businessDate: row.businessDate,
      course: row.course,
      duration: row.duration,
      branch: dest,
    })
    if (realKeys.has(k)) continue // covered — not "uncovered"
    out.push(row)
  }
  return out
}

// ---------------------------------------------------------------------------
// expenseBreakdown — Requirement 22.3
// ---------------------------------------------------------------------------

/** Per-item roll-up within a branch's expense breakdown. */
export interface ExpenseItemTotal {
  /** Trimmed item label as stored on the expense row. */
  item: string
  /** Sum of `amount` across rows whose `trim(item)` matches. */
  total: number
}

/** Per-branch slice of the expense breakdown report. */
export interface ExpenseBranchTotal {
  branch: Branch
  /** Sum of all expense amounts at this branch in the cycle. */
  total: number
  /**
   * Per-item breakdown sorted by total descending; ties broken by item
   * label ascending so the result is fully deterministic.
   */
  items: ExpenseItemTotal[]
}

/**
 * Aggregate expenses for the cycle by branch and by item.
 *
 * - Rows outside `cycle.days` are ignored.
 * - Item labels are compared after trim (`'Rent '` and `'Rent'` collapse
 *   to a single bucket). Case is preserved on the displayed label
 *   (cashiers may type `'Supplies'` and `'supplies'` distinctly; we
 *   don't second-guess casing).
 * - The output array is in the same order as `branches`, so callers can
 *   pass a custom branch ordering and have it reflected in the report.
 *
 * @see Requirement 22.3 — expense breakdown report.
 */
export function expenseBreakdown(
  expenses: ReadonlyArray<ExpenseRow>,
  cycle: Cycle,
  branches: ReadonlyArray<Branch>,
): ExpenseBranchTotal[] {
  const filtered = expenses.filter(inCycle(cycle))
  const result: ExpenseBranchTotal[] = []

  for (const branch of branches) {
    const itemTotals = new Map<string, number>()
    let total = 0
    for (const exp of filtered) {
      if (exp.branch !== branch) continue
      const amount = Number(exp.amount) || 0
      total += amount
      const key = exp.item.trim()
      itemTotals.set(key, (itemTotals.get(key) ?? 0) + amount)
    }
    const items: ExpenseItemTotal[] = Array.from(itemTotals.entries())
      .map(([item, t]) => ({ item, total: t }))
      .sort((a, b) => b.total - a.total || a.item.localeCompare(b.item))
    result.push({ branch, total, items })
  }

  return result
}

// ---------------------------------------------------------------------------
// payoutReport — Requirement 22.1
// ---------------------------------------------------------------------------

/** One staff's payout total within a branch slice of the payout report. */
export interface PayoutEntry {
  /** Display name — roster's stored name when matched, else the row's. */
  staff: string
  /** Sum of canonical-view totals at this attribution branch. */
  total: number
}

/**
 * Per-branch payout report. Each branch lists every staff who has any
 * canonical attribution at that branch in the cycle, sorted by total
 * descending (ties broken by staff name).
 *
 * Empty arrays are emitted for branches with no canonical entries, so
 * downstream renderers don't have to special-case missing keys.
 */
export type PayoutReport = Record<Branch, PayoutEntry[]>

/**
 * Per-staff per-branch payout totals from the canonical view, grouped
 * by branch attribution.
 *
 * - Rows outside `cycle.days` are ignored.
 * - The canonical view excludes Freelance rows and applies the EXTRA
 *   fallback rule, so a staff can appear under their HOME branch (real
 *   rows + covered EXTRAs that already credit a real-row destination)
 *   AND under another branch (uncovered EXTRA fallback). This is by
 *   design: the report mirrors the salary board's per-branch sections.
 * - When the row's staff matches a roster entry (case-insensitive,
 *   trimmed), the roster's stored display name is used; otherwise the
 *   row's display name is preserved.
 *
 * @see Requirement 22.1 — per-cycle payout report grouped by branch
 *      attribution.
 */
export function payoutReport(
  rows: ReadonlyArray<TransactionRow>,
  roster: ReadonlyArray<StaffMember>,
  cycle: Cycle,
): PayoutReport {
  const filtered = rows.filter(inCycle(cycle))
  const entries = buildCanonicalEntries(filtered)

  const rosterByLc = new Map<string, StaffMember>()
  for (const s of roster) {
    rosterByLc.set(s.name.trim().toLowerCase(), s)
  }

  // Group: branch → staffLc → { name, total }
  const grouped: Record<Branch, Map<string, { name: string; total: number }>> = {
    Kimberry: new Map(),
    Bishop: new Map(),
    Chulia: new Map(),
  }

  for (const e of entries) {
    const inner = grouped[e.branch]
    const cur = inner.get(e.staffLc)
    const display = rosterByLc.get(e.staffLc)?.name ?? e.staffDisplay
    if (cur) {
      cur.total += e.total
    } else {
      inner.set(e.staffLc, { name: display, total: e.total })
    }
  }

  const out: PayoutReport = { Kimberry: [], Bishop: [], Chulia: [] }
  for (const branch of BRANCHES) {
    out[branch] = Array.from(grouped[branch].values())
      .map(({ name, total }) => ({ staff: name, total }))
      .sort((a, b) => b.total - a.total || a.staff.localeCompare(b.staff))
  }
  return out
}
