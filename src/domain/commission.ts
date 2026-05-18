/**
 * Commission calculation — heals-system-rebuild domain layer.
 *
 * Pure, side-effect-free functions. Encodes the per-row commission
 * algorithm from
 *   `c:/BILL/.kiro/specs/heals-system-rebuild/design.md` §"Commission
 *   Calculation"
 * and the rate-lookup rules from Requirements 2.6, 2.7, 6.1–6.6, 18.1,
 * 18.4, 18.5.
 *
 * Public API (in dependency order):
 *
 *   - `RegularRateRow`, `FreelanceRateRow`   — rate-row shapes
 *   - `PriceRow`, `PriceTable`               — price-row shapes + lookup map
 *   - `priceTableFromRows`                   — build a PriceTable
 *   - `lookupCustomerPrice`                  — price for (course, duration, branch)
 *   - `lookupRegularRate`                    — most-recent regular-staff rate
 *   - `lookupFreelanceRate`                  — most-recent freelance rate (Bishop FR floor)
 *   - `bookingBonus`                         — duration-keyed booking bonus
 *   - `CommissionInput`, `CommissionResult`  — computeCommission contract
 *   - `computeCommission`                    — per-row commission breakdown
 *
 * Rate tables are passed in as plain arrays (`RegularRateRow[]` /
 * `FreelanceRateRow[]`). Each row carries the date it became
 * effective; the lookup picks the most-recent row whose `effectiveFrom`
 * is <= `businessDate`. The owner can layer new rates without losing
 * history (Req 6.7) — historical rows replay against the rate active
 * on their business date.
 *
 * Bishop FR freelance rate is computed at lookup time, not seeded:
 * `max(0, kcRate - 1)` per Req 6.6 / 18.4. Bishop's regular FR price is
 * RM 2 less than Kimberry/Chulia per Req 2.7, but that's enforced by
 * the seeded `prices` table — `lookupCustomerPrice` is a plain lookup.
 *
 * `computeCommission` short-circuits to all-zero when the method
 * decodes as EXTRA (Req 5.x — EXTRA rows are notes, not earnings).
 * For `method === 'Freelance'` the base comes from
 * `lookupFreelanceRate`; otherwise from `lookupRegularRate`.
 *
 * Validates: Requirements 2.6, 2.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6,
 *            18.1, 18.4, 18.5.
 */

import type { Branch, Course, Duration, TransactionMethod } from './types'
import { isExtraMethod } from './extra'

// Re-export the literal-union types that downstream UI / action modules
// historically import from `@/domain/commission`. The single source of
// truth is `./types`; this just preserves the legacy import path.
export type { Branch, Course, Duration } from './types'

/**
 * Legacy alias for `TransactionMethod`. The salary-system-rebuild spec
 * exposed a `Method` type from this module; the heals contract renamed
 * the canonical type to `TransactionMethod` in `./types`. Several owner
 * pages and theming utilities still import `Method` from here, so we
 * keep the alias to avoid a wide rewrite — the type is identical.
 */
export type Method = TransactionMethod

// ---------------------------------------------------------------------------
// Rate row shapes
// ---------------------------------------------------------------------------

/**
 * One row of the regular-staff commission rate table.
 *
 * `branchGroup` selects which group of branches a rate applies to. The
 * seeded data uses `'all'` for the rate that applies everywhere; the
 * field is kept open as a string so future per-branch overrides
 * (Kimberry-only promotions, etc.) can layer in without a schema
 * change. Lookups match exactly on `branchGroup`.
 *
 * `effectiveFrom` is a `yyyy-MM-dd` business date; the rate is in force
 * from that date forward until a later row supersedes it.
 */
export interface RegularRateRow {
  course: Course
  duration: Duration
  branchGroup: string
  amount: number
  effectiveFrom: string
}

/**
 * One row of the freelance commission rate table. Same shape as
 * `RegularRateRow`. The Bishop FR rate is NOT seeded here — it is
 * computed at lookup time as `max(0, kcRate - 1)`. The seeded rows
 * cover the Kimberry/Chulia base value (typically `branchGroup: 'all'`).
 */
export interface FreelanceRateRow {
  course: Course
  duration: Duration
  branchGroup: string
  amount: number
  effectiveFrom: string
}

// ---------------------------------------------------------------------------
// Price-table shapes + helpers
// ---------------------------------------------------------------------------

/**
 * One row of the customer-price table (the `prices` DB table).
 *
 * Bishop FR prices are seeded RM 2 less than Kimberry/Chulia (Req 2.7),
 * so `lookupCustomerPrice` is a plain lookup with no branch-specific
 * arithmetic.
 */
export interface PriceRow {
  course: Course
  duration: Duration
  branch: Branch
  price: number
}

/** Read-only price lookup keyed by `${course}|${duration}|${branch}`. */
export type PriceTable = ReadonlyMap<string, number>

/** Canonical `PriceTable` key. */
export function priceKey(
  course: Course,
  duration: Duration,
  branch: Branch,
): string {
  return `${course}|${duration}|${branch}`
}

/**
 * Build a `PriceTable` from a flat row array. Later rows for the same
 * `(course, duration, branch)` win, matching the DB primary key.
 * Coerces `price` through `Number(...)` so callers can pass values that
 * arrived as strings from `numeric(10,2)` columns without pre-parsing.
 */
export function priceTableFromRows(
  rows: ReadonlyArray<PriceRow>,
): PriceTable {
  const m = new Map<string, number>()
  for (const r of rows) {
    const v = Number(r.price)
    if (!Number.isFinite(v)) continue
    m.set(priceKey(r.course, r.duration, r.branch), v)
  }
  return m
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/**
 * Customer-facing price for the (course, duration, branch) cell.
 * Returns 0 when the cell is missing from the table — the caller is
 * expected to display "—" or 0 in that case.
 *
 * The Bishop FR -2 RM rule (Req 2.7) is encoded by the seeded `prices`
 * table, so this function is a plain lookup; no branch-specific
 * arithmetic happens here.
 */
export function lookupCustomerPrice(
  course: Course,
  duration: Duration,
  branch: Branch,
  priceTable: PriceTable,
): number {
  const v = priceTable.get(priceKey(course, duration, branch))
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

// ---------------------------------------------------------------------------
// Flags helpers (Heals POS — multi-select chips on each transaction row)
// ---------------------------------------------------------------------------

/**
 * Decoded flag set from the comma-separated `flags` string stored on a
 * transaction row. The cashier UI persists raw chip tokens as-is so a
 * cashier can add free-text notes; the three booleans below are
 * derived by case-insensitive substring matching against the canonical
 * names ("staff balm", "customer balm", "booking").
 *
 * `raw` keeps every trimmed non-empty token in original order so the
 * UI can render the chips back exactly as the cashier typed them.
 */
export interface ParsedFlags {
  staffBalm: boolean
  customerBalm: boolean
  booking: boolean
  raw: string[]
}

/**
 * Parse a comma-separated `flags` string into a `ParsedFlags` record.
 *
 * Rules:
 *   - Tokens are split on commas (`,`). Whitespace inside a token is
 *     preserved (so `"Staff Balm"` stays as one token).
 *   - Each token is trimmed; empty tokens after trimming are dropped.
 *   - Booleans are derived by case-insensitive substring match against
 *     the canonical labels:
 *         "staff balm"   → staffBalm = true
 *         "customer balm"→ customerBalm = true
 *         "booking"      → booking = true
 *     Substring matching keeps the legacy "stf balm", "cust balm"
 *     etc. semantics that previous Apps Script ports relied on, while
 *     still letting cashiers add free-text annotations.
 *
 * Empty / undefined input returns all-false with empty `raw`.
 */
export function parseFlags(flagsStr: string | undefined | null): ParsedFlags {
  const out: ParsedFlags = {
    staffBalm: false,
    customerBalm: false,
    booking: false,
    raw: [],
  }
  if (!flagsStr) return out
  const tokens = flagsStr
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
  out.raw = tokens
  const lc = flagsStr.toLowerCase()
  // Customer balm needs to be checked first so a token like
  // "customer balm" doesn't also flip staffBalm via the "balm" substring
  // — we anchor each canonical label with its full phrase.
  if (lc.includes('customer balm')) out.customerBalm = true
  if (lc.includes('staff balm')) out.staffBalm = true
  if (lc.includes('booking')) out.booking = true
  return out
}

/**
 * Final customer price including the +RM 10 Customer Balm surcharge.
 *
 * Rules (Heals POS — derived from the cashier's working formula):
 *
 *   1. EXTRA methods → 0. EXTRA rows are notes, not money (Req 2.5).
 *   2. Otherwise → `lookupCustomerPrice(course, duration, branch, ...)`
 *      plus RM 10 when `flags` includes "customer balm" (case-insensitive).
 *
 * The Customer Balm surcharge is applied at price lookup time so the
 * cashier sees the same number on the receipt that the customer pays.
 * Staff Balm bumps commission only — it is NOT priced into the
 * customer total.
 *
 * Validates: Heals user formula spec (commission.ts contract update).
 */
export function customerPriceWithFlags(
  course: Course,
  duration: Duration,
  branch: Branch,
  method: string,
  flags: string | undefined | null,
  priceTable: PriceTable,
): number {
  if (isExtraMethod(String(method ?? '').trim())) return 0
  const base = lookupCustomerPrice(course, duration, branch, priceTable)
  const f = parseFlags(flags)
  return base + (f.customerBalm ? 10 : 0)
}

/**
 * Most-recent regular-staff rate in force on `businessDate` for the
 * given `(course, duration, branchGroup)` triple.
 *
 * Filters `rateTable` by an exact match on `course`, `duration`, and
 * `branchGroup`, drops rows whose `effectiveFrom > businessDate`, then
 * returns the `amount` of the row with the latest `effectiveFrom`.
 * Returns 0 when no row matches — the caller treats that as
 * "rate not yet defined" (the pre-seed period or a typo'd combo).
 *
 * Validates: Requirement 6.1 (lookup tables), 6.7 (rates take effect
 * forward in time without rewriting history).
 */
export function lookupRegularRate(
  course: Course,
  duration: Duration,
  rateTable: ReadonlyArray<RegularRateRow>,
  branchGroup: string,
  businessDate: string,
): number {
  let best: RegularRateRow | null = null
  for (const r of rateTable) {
    if (r.course !== course) continue
    if (r.duration !== duration) continue
    if (r.branchGroup !== branchGroup) continue
    if (r.effectiveFrom > businessDate) continue
    if (best === null || r.effectiveFrom > best.effectiveFrom) {
      best = r
    }
  }
  if (best === null) return 0
  const v = Number(best.amount)
  return Number.isFinite(v) ? v : 0
}

/**
 * Most-recent freelance rate in force on `businessDate` for the given
 * `(course, duration, branch)` triple.
 *
 * Branch handling:
 *
 *   - `branch === 'Bishop'` AND `course === 'FR'` — the rate is
 *     computed at lookup time as `max(0, kcRate - 1)` per Req 6.6 / 18.4.
 *     `kcRate` is the seeded Kimberry/Chulia FR rate at the row's
 *     `branchGroup === 'all'` cell. Floor at RM 0 — the function never
 *     returns a negative value.
 *   - All other branches — the rate is the most-recent matching row
 *     under `branchGroup === 'all'` (the default seeded group).
 *
 * Returns 0 when no row matches the lookup.
 *
 * Validates: Requirements 6.5, 6.6, 18.1, 18.4 (Bishop independent calc,
 * floor at 0). Property 19 (freelance rate routing).
 */
export function lookupFreelanceRate(
  course: Course,
  duration: Duration,
  branch: Branch,
  rateTable: ReadonlyArray<FreelanceRateRow>,
  businessDate: string,
): number {
  // Helper: most-recent freelance rate for a given branchGroup cell.
  const lookup = (group: string): number => {
    let best: FreelanceRateRow | null = null
    for (const r of rateTable) {
      if (r.course !== course) continue
      if (r.duration !== duration) continue
      if (r.branchGroup !== group) continue
      if (r.effectiveFrom > businessDate) continue
      if (best === null || r.effectiveFrom > best.effectiveFrom) {
        best = r
      }
    }
    if (best === null) return 0
    const v = Number(best.amount)
    return Number.isFinite(v) ? v : 0
  }

  if (branch === 'Bishop' && course === 'FR') {
    const kcRate = lookup('all')
    return Math.max(0, kcRate - 1)
  }
  return lookup('all')
}

/**
 * Duration-keyed booking bonus. 60 → 3, 90 → 4.5, 120 → 6, otherwise 0.
 * Exported so callers that need the per-row `book` component without
 * routing through `computeCommission` (e.g. the salary board) stay in
 * sync with this single source of truth.
 */
export function bookingBonus(duration: Duration): number {
  switch (duration) {
    case 60:
      return 3
    case 90:
      return 4.5
    case 120:
      return 6
    default:
      return 0
  }
}

// ---------------------------------------------------------------------------
// computeCommission
// ---------------------------------------------------------------------------

/**
 * Per-row commission inputs. The rate tables and `priceTable` are
 * passed by reference — callers fetch them once per request and thread
 * them through every row in the batch.
 *
 * `branchGroup` defaults to `'all'` when omitted. `priceTable` is
 * accepted for API symmetry with other domain helpers; it is currently
 * unused by `computeCommission` (the freelance Bishop FR floor reads
 * from `freelanceRates`, not from prices), but threading it here keeps
 * the call site identical when callers later need price-driven
 * fallbacks.
 */
export interface CommissionInput {
  course: Course
  duration: Duration
  branch: Branch
  businessDate: string
  /**
   * Method string as stored on the transaction row. Accepts the canonical
   * values (`CASH`, `QR`, `CREDIT`, `Freelance`, `EXTRA KM`, `EXTRA BS`,
   * `EXTRA CL`) plus the case/whitespace variants `isExtraMethod` and
   * the `'freelance'` check below tolerate.
   */
  method: string
  staffBalm: boolean
  booking: boolean
  addon: number
  /**
   * Optional comma-separated `flags` string from the row. When the
   * row's chips include "Staff Balm" / "Booking" / "Customer Balm",
   * those override the explicit `staffBalm`/`booking` booleans above
   * (a flag take precedence). Lets server callers pass either shape.
   */
  flags?: string
  /** Defaults to `'all'`. */
  branchGroup?: string
  regularRates: ReadonlyArray<RegularRateRow>
  freelanceRates: ReadonlyArray<FreelanceRateRow>
  priceTable?: PriceTable
}

/**
 * Per-part breakdown of a row's commission. Invariant (Req 20.7):
 * `total === base + balm + book + addon`.
 *
 *   - `balm`  ∈ {0, 3}
 *   - `book`  ∈ {0, 3, 4.5, 6} keyed by duration
 *   - `addon` is `max(0, input.addon)`
 *
 * EXTRA rows return all-zero (Req 5.x — EXTRA rows are notes).
 */
export interface CommissionResult {
  base: number
  balm: number
  book: number
  addon: number
  total: number
}

/** Zero-result helper. */
const ZERO_RESULT: CommissionResult = Object.freeze({
  base: 0,
  balm: 0,
  book: 0,
  addon: 0,
  total: 0,
})

/**
 * Compute the per-row commission breakdown.
 *
 * Algorithm (from heals design.md §"Commission Calculation"):
 *
 *   1. `isExtraMethod(method)` → return all zeros. EXTRA rows have
 *      price 0 and pay no commission at the source branch; their
 *      cross-branch attribution is handled by the salary-board layer
 *      via the canonical-view fallback (Req 5.x).
 *   2. `method === 'Freelance'` (case-insensitive, trimmed) → base
 *      from `lookupFreelanceRate(course, duration, branch, freelanceRates,
 *      businessDate)`.
 *   3. Otherwise → base from `lookupRegularRate(course, duration,
 *      regularRates, branchGroup, businessDate)`.
 *   4. `balm`  = 3 if `staffBalm` else 0 (Req 6.2).
 *   5. `book`  = `bookingBonus(duration)` if `booking`, else 0 (Req 6.3).
 *   6. `addon` = `max(0, input.addon)` (defensive clamp).
 *   7. `total` = base + balm + book + addon (Req 6.4 / 20.7).
 *
 * Validates: Requirements 2.6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 18.1,
 *            18.4, 18.5. Properties 5 and 19.
 */
export function computeCommission(input: CommissionInput): CommissionResult {
  const trimmedMethod = String(input.method ?? '').trim()

  // EXTRA rows are notes — no money, no commission at this row.
  if (isExtraMethod(trimmedMethod)) {
    return { ...ZERO_RESULT }
  }

  const branchGroup = input.branchGroup ?? 'all'
  const isFreelanceMethod = trimmedMethod.toLowerCase() === 'freelance'

  // Allow the optional `flags` string to act as a fallback or override
  // for the staffBalm / booking booleans. Any flag listed on the row's
  // chips wins — so a row whose `flags` carries "Staff Balm" gets the
  // +3 RM bump even if the caller forgot to set the explicit boolean.
  const parsed = parseFlags(input.flags)
  const staffBalm = input.staffBalm || parsed.staffBalm
  const booking = input.booking || parsed.booking

  const base = isFreelanceMethod
    ? lookupFreelanceRate(
        input.course,
        input.duration,
        input.branch,
        input.freelanceRates,
        input.businessDate,
      )
    : lookupRegularRate(
        input.course,
        input.duration,
        input.regularRates,
        branchGroup,
        input.businessDate,
      )

  const balm = staffBalm ? 3 : 0
  const book = booking ? bookingBonus(input.duration) : 0
  const addon = clampNonNegative(input.addon)

  return { base, balm, book, addon, total: base + balm + book + addon }
}

function clampNonNegative(n: number | undefined | null): number {
  if (n == null || !Number.isFinite(n)) return 0
  return n < 0 ? 0 : n
}
