/**
 * Deterministic transaction key (`row_id`).
 *
 * A `row_id` uniquely identifies a transaction by its logged branch,
 * business date (5 AM Asia/Kuala_Lumpur cutoff applied upstream), and
 * the cashier-typed sequential row number for that (branch, date) pair.
 * The format is fixed:
 *
 *     {branch}|{business_date}|{cashier_row_number}
 *
 * Pure, side-effect-free, and round-trip:
 * `parseRowId(buildRowId(b, d, n))` deep-equals `{ b, d, n }` for any
 * valid input.
 *
 * Validates: Requirements 3.1 (row_id format) and 3.5 (uniqueness key
 * matches the database UNIQUE index on
 * `(branch, business_date, cashier_row_number)`).
 *
 * See `c:/BILL/.kiro/specs/heals-system-rebuild/design.md`
 *     §"Domain Layer Components" → `row-id.ts`.
 */

import type { Branch } from './types'

const BRANCHES: readonly Branch[] = ['Kimberry', 'Bishop', 'Chulia'] as const
const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * Result of parsing a well-formed `row_id` string.
 */
export interface ParsedRowId {
  branch: Branch
  businessDate: string
  cashierRowNumber: number
}

/**
 * Build a deterministic `row_id` from its three parts.
 *
 * @param branch             One of the three branches.
 * @param businessDate       A `yyyy-MM-dd` string (5 AM KL cutoff applied
 *                           upstream by `getBusinessDate`).
 * @param cashierRowNumber   The "No" column on the cashier panel
 *                           (sequential per (branch, business_date)).
 * @returns                  `"{branch}|{businessDate}|{cashierRowNumber}"`.
 */
export function buildRowId(
  branch: Branch,
  businessDate: string,
  cashierRowNumber: number,
): string {
  return `${branch}|${businessDate}|${cashierRowNumber}`
}

function isBranch(value: string): value is Branch {
  return (BRANCHES as readonly string[]).includes(value)
}

/**
 * Parse a `row_id` back into its three parts.
 *
 * Throws a `TypeError` when:
 *   - the input is not a string
 *   - the input does not split into exactly three parts on `|`
 *   - the branch is not one of `'Kimberry' | 'Bishop' | 'Chulia'`
 *     (this also covers an empty branch segment)
 *   - the business date does not match `/^\d{4}-\d{2}-\d{2}$/`
 *     (calendar correctness is `getBusinessDate`'s concern, not ours)
 *   - the cashier row number is not a non-negative integer whose
 *     decimal form round-trips through `Number.parseInt(s, 10)`
 *     (i.e. no leading zeros, no sign, no whitespace, no fraction)
 *
 * @throws {TypeError} when the input is malformed.
 */
export function parseRowId(rowId: string): ParsedRowId {
  if (typeof rowId !== 'string') {
    throw new TypeError(`Malformed row_id: expected string, got ${typeof rowId}`)
  }

  const parts = rowId.split('|')
  if (parts.length !== 3) {
    throw new TypeError(
      `Malformed row_id: expected 3 pipe-separated parts, got ${parts.length} (input: ${JSON.stringify(rowId)})`,
    )
  }

  const [branchPart, businessDate, rowNumPart] = parts

  if (!isBranch(branchPart)) {
    throw new TypeError(
      `Malformed row_id: unknown branch ${JSON.stringify(branchPart)}`,
    )
  }
  if (!BUSINESS_DATE_PATTERN.test(businessDate)) {
    throw new TypeError(
      `Malformed row_id: business_date ${JSON.stringify(businessDate)} does not match yyyy-MM-dd`,
    )
  }

  const cashierRowNumber = Number.parseInt(rowNumPart, 10)
  if (!Number.isFinite(cashierRowNumber)) {
    throw new TypeError(
      `Malformed row_id: cashier_row_number ${JSON.stringify(rowNumPart)} is not a finite integer`,
    )
  }
  if (cashierRowNumber < 0) {
    throw new TypeError(
      `Malformed row_id: cashier_row_number ${cashierRowNumber} is negative`,
    )
  }
  if (String(cashierRowNumber) !== rowNumPart) {
    // Catches leading zeros ('003'), fractions ('3.14'), sign prefixes
    // ('+3'), trailing whitespace, and any other non-canonical form.
    throw new TypeError(
      `Malformed row_id: cashier_row_number ${JSON.stringify(rowNumPart)} is not in canonical decimal form`,
    )
  }

  return { branch: branchPart, businessDate, cashierRowNumber }
}

// Re-export `Branch` so existing imports from this module
// (`import { type Branch } from '@/domain/row-id'`) remain valid after
// the type was migrated to `types.ts`.
export type { Branch } from './types'
