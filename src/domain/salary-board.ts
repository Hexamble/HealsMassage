/**
 * Salary board derivation for the heals-system-rebuild.
 *
 * Pure functions, no I/O. Migrates `salary-board.ts` from the legacy
 * salary-system-rebuild row shape (`commission`, `rowId`, …) to the
 * heals `TransactionRow` shape (`totalCommission`, `cashierRowNumber`,
 * …) defined in `./types`.
 *
 * Exports the heals contract:
 *
 *   - {@link buildCanonicalView} — two-pass EXTRA attribution. Pass 1
 *     collects real-row match keys at OWN branch; pass 2 emits one
 *     {@link CanonicalEntry} per row, dropping Freelance, covered EXTRA,
 *     and undecodable EXTRA rows, falling back to the decoded
 *     destination for uncovered EXTRAs.
 *
 *   - {@link aggregateByStaff} — group canonical entries by
 *     `(staffLc, branch, date)` and sum `total`.
 *
 *   - {@link resolveHomeBranch} — case-insensitive trimmed-name lookup
 *     against the active roster; returns `homeBranch` or `null` when
 *     the staff is not on the roster (or is inactive).
 *
 *   - {@link buildSalaryBoard} — top-level entry point. Filters rows
 *     to `cycle.days`, computes the canonical view, aggregates per
 *     `(staff, branch, date)`, and emits per-branch sections (one per
 *     home branch with at least one non-zero non-freelance staff,
 *     Req 9.1) plus the multi-branch summary (staff with non-zero
 *     totals at ≥2 distinct branches, Req 9.3, 9.4).
 *
 * Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.6, 9.1, 9.2, 9.3, 9.4,
 *            9.5, 9.7, 18.2.
 *
 * Property tests (see `salary-board.test.ts`):
 *   - Property 4 — Canonical view never double-counts and correctly
 *     attributes (Req 5.2, 5.3, 5.4, 5.6, 9.4)
 *   - Property 6 — Salary board home-branch attribution and freelance
 *     exclusion (Req 9.1, 9.2, 9.3, 9.7, 18.2)
 *   - Property 9 — Cycle payout total equals sum of daily totals
 *     (Req 9.2, 22.1)
 *
 * Migration note (task 4.4 of heals-system-rebuild):
 *   The previous file targeted the salary-system-rebuild legacy shape
 *   and exported `buildPerBranchView` plus a different `SalaryBoard`
 *   type. Existing callers (cashier `EarningsPanel`, owner `salary`,
 *   `time-machine`, `daily-ledger`, integration tests, etc.) reference
 *   those legacy exports and will surface TS errors until they are
 *   migrated in their own respective tasks (task 4.12 reports.ts
 *   already aligned to the heals shape via a local replica). This is
 *   expected and intentional per the task description.
 *
 *   The previous test file is preserved as
 *   `salary-board.test.ts.legacy` for reference; the new file in
 *   this folder tests the heals contract.
 */

import {
  BRANCHES,
  type Branch,
  type Cycle,
  type StaffMember,
  type TransactionRow,
} from './types'
import {
  buildExtraMatchKey,
  decodeExtraDestination,
  isExtraMethod,
} from './extra'

// Re-export the row + roster types so legacy callers that imported
// them from `salary-board` (the salary-system-rebuild contract) keep
// resolving without code changes. The canonical source is `./types`.
export type { TransactionRow, StaffMember as Staff } from './types'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Canonical-view entry — one per source row, after Freelance / covered
 * EXTRA / undecodable EXTRA rows have been dropped.
 *
 * `branch` is the ATTRIBUTION branch (post-fallback). For a real row
 * this equals `row.branch`; for an uncovered EXTRA it equals the
 * decoded destination.
 *
 * `staffLc` is the lower-cased trimmed staff name (the join / group
 * key). `staffDisplay` preserves the trimmed display form so reports
 * can render the cashier's typed casing.
 *
 * `total` is the row's `totalCommission` coerced to a number; rows with
 * NaN / null commissions contribute 0.
 */
export interface CanonicalEntry {
  row: TransactionRow
  staffLc: string
  staffDisplay: string
  branch: Branch
  /** `yyyy-MM-dd` business date. */
  date: string
  total: number
  /** True when this entry is an uncovered EXTRA falling back to its decoded destination. */
  isFallbackExtra: boolean
}

/**
 * Aggregated total for a single (staff, branch, date) bucket.
 *
 * `staffDisplay` is the first display form encountered for the staff
 * across all bucketed entries — sufficient for the salary board, which
 * groups display by staff regardless of branch / date.
 */
export interface StaffAggregate {
  staffLc: string
  staffDisplay: string
  branch: Branch
  date: string
  total: number
}

/**
 * One row inside a {@link BoardSection}: the staff's name plus a
 * `daily` map keyed by `yyyy-MM-dd` and the cycle total.
 *
 * `daily` only contains entries for days where the staff's total in
 * this section is non-zero — empty days are absent (consumers default
 * to 0).
 */
export interface BoardStaffRow {
  name: string
  daily: Record<string, number>
  total: number
}

/**
 * One section of the salary board: a per-branch slice or the
 * multi-branch summary. `staff` is sorted by descending `total`,
 * ties broken by name ascending so output is fully deterministic.
 *
 * `total` is the section's grand total (sum of `staff[i].total`).
 */
export interface BoardSection {
  staff: BoardStaffRow[]
  total: number
}

/**
 * Top-level salary board contract returned by {@link buildSalaryBoard}.
 *
 * `perBranch` is `Partial<Record<Branch, BoardSection>>` because empty
 * branches are OMITTED entirely (Req 9.1 — a section is only displayed
 * when ≥1 eligible staff has a non-zero total). Consumers must guard
 * against missing keys.
 *
 * `multiBranch` is always present (it may have an empty `staff` array
 * when no staff worked at ≥2 branches in the cycle).
 */
export interface SalaryBoard {
  perBranch: Partial<Record<Branch, BoardSection>>
  multiBranch: BoardSection
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isFreelanceMethod(method: unknown): boolean {
  return String(method ?? '').trim().toLowerCase() === 'freelance'
}

function rowTotal(row: TransactionRow): number {
  const n = Number(row.totalCommission)
  return Number.isFinite(n) ? n : 0
}

// ---------------------------------------------------------------------------
// buildCanonicalView
// ---------------------------------------------------------------------------

/**
 * Two-pass canonical view of the salary inputs.
 *
 *   Pass 1 — collect match keys of every real (non-EXTRA, non-Freelance)
 *            row at its OWN branch. The match key is built via
 *            {@link buildExtraMatchKey}, so it is invariant under case,
 *            whitespace, and string-vs-number duration formatting.
 *
 *   Pass 2 — emit one {@link CanonicalEntry} per surviving row:
 *              - Freelance rows         → drop (paid separately, Req 18.2)
 *              - real (non-EXTRA) rows  → emit at `row.branch`
 *              - EXTRA, decodable:
 *                  match-key covered    → drop (real row credits dest, Req 5.2)
 *                  match-key uncovered  → emit at decoded dest, fallback (Req 5.3)
 *              - EXTRA, undecodable     → drop (Req 5.5)
 *
 * The output preserves input row order (modulo dropped rows), so
 * downstream callers may assume stable iteration without an extra sort.
 */
export function buildCanonicalView(
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
  const out: CanonicalEntry[] = []
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
      // Intent unclear — drop entirely (Req 5.5). The owner can surface
      // these via a separate diagnostics view.
      continue
    }

    out.push({
      row,
      staffLc: String(row.staff).trim().toLowerCase(),
      staffDisplay: String(row.staff).trim(),
      branch: attribBranch,
      date: row.businessDate,
      total: rowTotal(row),
      isFallbackExtra,
    })
  }

  return out
}

// ---------------------------------------------------------------------------
// aggregateByStaff
// ---------------------------------------------------------------------------

/**
 * Group canonical entries by `(staffLc, branch, date)` and sum the
 * `total` field. Output order is insertion order: for each unique
 * bucket the first entry's position in `canonical` determines its
 * position in the result.
 *
 * `staffDisplay` is the display form from the FIRST entry observed for
 * a given `staffLc` (across all branches and dates), matching how the
 * board renders a staff's name in their home-branch row.
 */
export function aggregateByStaff(
  canonical: ReadonlyArray<CanonicalEntry>,
): StaffAggregate[] {
  // First-display map keyed by staffLc — preserves the casing the
  // cashier originally typed.
  const firstDisplay = new Map<string, string>()
  for (const e of canonical) {
    if (!firstDisplay.has(e.staffLc)) {
      firstDisplay.set(e.staffLc, e.staffDisplay)
    }
  }

  // Bucket by `staffLc|branch|date`. Maps preserve insertion order in
  // ES2015+, so the output mirrors the order buckets were first seen.
  const buckets = new Map<string, StaffAggregate>()
  for (const e of canonical) {
    const key = `${e.staffLc}|${e.branch}|${e.date}`
    const cur = buckets.get(key)
    if (cur) {
      cur.total += e.total
    } else {
      buckets.set(key, {
        staffLc: e.staffLc,
        staffDisplay: firstDisplay.get(e.staffLc) ?? e.staffDisplay,
        branch: e.branch,
        date: e.date,
        total: e.total,
      })
    }
  }

  return Array.from(buckets.values())
}

// ---------------------------------------------------------------------------
// resolveHomeBranch
// ---------------------------------------------------------------------------

/**
 * Look up a staff's home branch from the roster.
 *
 * Match is case-insensitive on trimmed `name`. Only ACTIVE roster
 * entries are considered (Req 14.3 — inactive staff retain history but
 * do not surface in current views via roster lookups).
 *
 * Returns `null` when no active match is found. Callers decide how to
 * surface this — the salary board treats unmapped staff as not in any
 * home-branch section, but their canonical totals still appear in the
 * multi-branch summary if they qualify.
 *
 * @param staffLower lower-cased trimmed staff name (caller responsibility).
 *   Accepts the canonical join-key form so callers don't normalise twice.
 */
export function resolveHomeBranch(
  staffLower: string,
  roster: ReadonlyArray<StaffMember>,
): Branch | null {
  const target = staffLower.trim().toLowerCase()
  for (const s of roster) {
    if (!s.isActive) continue
    if (s.name.trim().toLowerCase() === target) return s.homeBranch
  }
  return null
}

// ---------------------------------------------------------------------------
// buildSalaryBoard
// ---------------------------------------------------------------------------

/**
 * Build the cycle-level salary board for the heals contract.
 *
 * Steps:
 *   1. Filter `rows` to those whose `businessDate` falls inside
 *      `cycle.days`. Set lookup keeps this O(n).
 *   2. Compute the canonical view over the filtered rows.
 *   3. Aggregate per `(staffLc, branch, date)` via
 *      {@link aggregateByStaff}.
 *   4. Build per-staff cross-branch summaries:
 *        - daily totals per attribution branch
 *        - per-branch cycle totals
 *        - set of distinct branches with non-zero contribution
 *   5. Emit per-branch sections — for each branch that has ≥1
 *      non-freelance staff with a non-zero total, build a
 *      {@link BoardSection} listing those staff's per-branch totals.
 *      Per Req 9.1 (strict), branches with no eligible staff are
 *      OMITTED entirely from `perBranch` (the consumer can detect
 *      missing keys via `Object.prototype.hasOwnProperty`).
 *      Freelance roster members are excluded entirely (Req 9.7, 18.2).
 *   6. Emit the multi-branch section — staff (freelance excluded) who
 *      have non-zero totals at ≥2 distinct branches in the cycle.
 *      `daily` for a multi-branch row is the per-day sum across all
 *      branches the staff worked at.
 *
 * Sorting: each section's `staff` is sorted by descending `total`,
 * ties broken by name ascending.
 */
export function buildSalaryBoard(
  rows: ReadonlyArray<TransactionRow>,
  roster: ReadonlyArray<StaffMember>,
  cycle: Cycle,
): SalaryBoard {
  // 1. Filter to cycle days.
  const cycleDays = new Set(cycle.days)
  const filtered = rows.filter((r) => cycleDays.has(r.businessDate))

  // 2 + 3. Canonical view + per-bucket aggregate.
  const canonical = buildCanonicalView(filtered)
  const aggregates = aggregateByStaff(canonical)

  // Lookup roster by lower-cased trimmed name. Only active staff
  // participate in home-branch attribution (Req 14.3); freelance
  // members are excluded outright from both per-branch and
  // multi-branch sections (Req 9.7, 18.2).
  const rosterByLc = new Map<string, StaffMember>()
  for (const s of roster) {
    rosterByLc.set(s.name.trim().toLowerCase(), s)
  }

  function isEligibleRosterStaff(staffLc: string): boolean {
    const r = rosterByLc.get(staffLc)
    // Only roster-known, active, non-freelance staff surface on the board.
    // Unknown staff have no home branch and are intentionally absent from
    // both per-branch sections and the multi-branch summary (Req 9.1, 9.7,
    // 18.2). The diagnostic surface for unknown-staff rows lives elsewhere.
    if (!r) return false
    return r.isActive && !r.isFreelance
  }

  // 4. Per-staff cross-branch summary. Maps preserve insertion order.
  interface StaffSummary {
    staffLc: string
    staffDisplay: string
    /** branch → date → total */
    perBranchDaily: Map<Branch, Map<string, number>>
    /** branch → cycle total */
    perBranchTotal: Map<Branch, number>
    /** distinct branches with non-zero total */
    nonZeroBranches: Set<Branch>
  }

  const summaries = new Map<string, StaffSummary>()

  for (const a of aggregates) {
    if (a.total === 0) continue // skip zero buckets entirely; they don't surface anywhere
    let s = summaries.get(a.staffLc)
    if (!s) {
      s = {
        staffLc: a.staffLc,
        staffDisplay: a.staffDisplay,
        perBranchDaily: new Map(),
        perBranchTotal: new Map(),
        nonZeroBranches: new Set(),
      }
      summaries.set(a.staffLc, s)
    }
    // Daily contribution at this branch.
    let dailyForBranch = s.perBranchDaily.get(a.branch)
    if (!dailyForBranch) {
      dailyForBranch = new Map()
      s.perBranchDaily.set(a.branch, dailyForBranch)
    }
    dailyForBranch.set(a.date, (dailyForBranch.get(a.date) ?? 0) + a.total)
    s.perBranchTotal.set(
      a.branch,
      (s.perBranchTotal.get(a.branch) ?? 0) + a.total,
    )
    s.nonZeroBranches.add(a.branch)
  }

  // 5. Per-branch sections. We accumulate into a normal object first so
  //    we can decide per-branch whether to emit (Req 9.1 strict).
  const perBranchAcc: Partial<Record<Branch, BoardStaffRow[]>> = {}

  for (const s of Array.from(summaries.values())) {
    if (!isEligibleRosterStaff(s.staffLc)) continue

    for (const branch of BRANCHES) {
      const total = s.perBranchTotal.get(branch) ?? 0
      if (total === 0) continue

      const dailyMap = s.perBranchDaily.get(branch)
      const daily: Record<string, number> = {}
      if (dailyMap) {
        for (const [d, v] of Array.from(dailyMap)) {
          if (v !== 0) daily[d] = v
        }
      }

      const list = (perBranchAcc[branch] ??= [])
      list.push({
        name: s.staffDisplay,
        daily,
        total,
      })
    }
  }

  const perBranch: Partial<Record<Branch, BoardSection>> = {}
  for (const branch of BRANCHES) {
    const list = perBranchAcc[branch]
    if (!list || list.length === 0) continue // Req 9.1: omit empty sections entirely.
    list.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    perBranch[branch] = {
      staff: list,
      total: list.reduce((sum, r) => sum + r.total, 0),
    }
  }

  // 6. Multi-branch summary. `daily` is the cross-branch sum per day.
  const multiBranchRows: BoardStaffRow[] = []
  for (const s of Array.from(summaries.values())) {
    if (!isEligibleRosterStaff(s.staffLc)) continue
    if (s.nonZeroBranches.size < 2) continue

    const daily: Record<string, number> = {}
    let total = 0
    for (const dailyForBranch of Array.from(s.perBranchDaily.values())) {
      for (const [d, v] of Array.from(dailyForBranch)) {
        daily[d] = (daily[d] ?? 0) + v
        total += v
      }
    }
    multiBranchRows.push({ name: s.staffDisplay, daily, total })
  }
  multiBranchRows.sort(
    (a, b) => b.total - a.total || a.name.localeCompare(b.name),
  )
  const multiBranch: BoardSection = {
    staff: multiBranchRows,
    total: multiBranchRows.reduce((sum, r) => sum + r.total, 0),
  }

  return { perBranch, multiBranch }
}


// ---------------------------------------------------------------------------
// Legacy compatibility shims (salary-system-rebuild contract)
// ---------------------------------------------------------------------------
//
// The salary-system-rebuild spec exported `SalaryRow` and a
// `buildPerBranchView(rows, roster, cycle)` helper that several owner
// pages still import from this module. The heals rebuild renamed
// these to `BoardStaffRow` and `buildSalaryBoard(...)` respectively.
//
// Rather than touch every owner page right now, expose thin shims so
// existing call sites keep compiling. New code should prefer the
// canonical heals names.

/** Alias of {@link BoardStaffRow} for legacy salary-system imports. */
export type SalaryRow = BoardStaffRow

/**
 * Legacy alias around `buildSalaryBoard(...).perBranch`.
 *
 * The salary-system contract exposed the per-branch sections as a
 * plain `Record<Branch, SalaryRow[]>`. This shim flattens the heals
 * `BoardSection` shape (`{staff, total}`) into the row array the old
 * callers expect, and returns `[]` for branches with no eligible
 * staff (the heals contract OMITS empty branches from `perBranch`,
 * but the old callers iterate the record directly).
 *
 * Multi-branch summary is dropped from the legacy view because the
 * old contract didn't have it; callers that need it should use
 * `buildSalaryBoard` directly.
 */
export function buildPerBranchView(
  rows: ReadonlyArray<TransactionRow>,
  roster: ReadonlyArray<StaffMember>,
  cycle: Cycle,
): Record<Branch, BoardStaffRow[]> {
  const board = buildSalaryBoard(rows, roster, cycle)
  const out: Record<Branch, BoardStaffRow[]> = {
    Kimberry: [],
    Bishop: [],
    Chulia: [],
  }
  for (const b of BRANCHES) {
    out[b] = board.perBranch[b]?.staff ?? []
  }
  return out
}
