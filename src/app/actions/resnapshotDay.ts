'use server'

/**
 * heals-system-rebuild — `resnapshotDay` server action (task 7.16).
 *
 * Owner-only recalculation entry-point used after an owner edit or
 * delete on past data. In the heals rebuild the salary board and shop
 * income board are computed *live* from `transactions` and `expenses`
 * rows on every render — there is no materialised snapshot table to
 * rebuild. So this action is functionally a no-op that returns
 * `{ ok: true, warnings: [] }` once the role gate has been cleared.
 *
 * What it DOES do is a defensive **consistency check** of the day's
 * rows. The DB enforces
 *
 *     total_commission = base_commission + balm_bonus + booking_bonus + addon
 *
 * via a CHECK constraint on `transactions` (Req 20.7), and the
 * commission compute path in `writeTransaction` enforces it again at
 * write time (Req 6.4). Neither of those should ever produce a
 * mismatch in normal operation, but if a row somehow drifts (manual
 * SQL fix, data import, future migration that bypasses the action
 * layer) the owner needs to know — that's what this action is for.
 *
 * Per Requirement 13.3 a consistency mismatch surfaces as a
 * **warning** (non-blocking string) rather than an error. The caller
 * (Time Machine, owner-delete action, diagnostics page) renders the
 * warning as a banner / toast but otherwise treats the operation as
 * successful: edits and deletes have already committed and there is
 * nothing to roll back.
 *
 * Pipeline:
 *   1. Resolve the current profile via `getCurrentProfile()`.
 *      Anonymous → `UNAUTHENTICATED`; non-owner → `NOT_OWNER`.
 *   2. Validate input: `businessDate` must be `yyyy-MM-dd`, optional
 *      `branch` must be one of Kimberry/Bishop/Chulia. When `branch`
 *      is omitted, the action checks all three branches.
 *   3. SELECT the relevant rows from `transactions` (RLS already
 *      grants the owner full read access via `tx_owner_all`).
 *   4. For each row, recompute `base + balm + book + addon` and
 *      compare to `total_commission`. Mismatches accumulate into the
 *      `warnings` array; the action never throws on data drift.
 *
 * Validates: Requirement 13.3 (recalculation failure surfaces a
 *            warning rather than blocking the edit/delete).
 *
 * @see c:/BILL/.kiro/specs/heals-system-rebuild/design.md
 *      §"Server Actions"
 * @see c:/BILL/.kiro/specs/heals-system-rebuild/requirements.md §13
 */

import { z } from 'zod'

import { getCurrentProfile } from '@/lib/profile'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { branchSchema } from '@/domain/validators'
import type { Branch } from '@/domain/types'

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

/**
 * Strict `yyyy-MM-dd` matcher. The Salary Board and Shop Income Board
 * use the same shape, so any well-formed ISO calendar date round-trips
 * cleanly to `transactions.business_date` (a Postgres `date`). The
 * regex rejects free-text dates like `15/05/2026` that would otherwise
 * reach the DB as `null`.
 */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const resnapshotDayInputSchema = z.object({
  businessDate: z.string().regex(DATE_PATTERN, 'businessDate must be yyyy-MM-dd'),
  branch: branchSchema.optional(),
})

export type ResnapshotDayInput = z.infer<typeof resnapshotDayInputSchema>

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type ResnapshotDayErrorCode =
  | 'UNAUTHENTICATED'
  | 'NOT_OWNER'
  | 'INVALID_INPUT'
  | 'DB_ERROR'

export type ResnapshotDayResult =
  | {
      ok: true
      businessDate: string
      branch: Branch | null
      /** Number of rows scanned (zero is fine — empty days are valid). */
      checkedRows: number
      /**
       * One human-readable string per anomaly. Empty when every row
       * satisfied `total = base + balm + book + addon` within
       * `EPSILON`. The DB CHECK constraint should keep this empty in
       * practice; non-empty means an out-of-band write slipped past
       * the action layer.
       */
      warnings: string[]
    }
  | {
      ok: false
      code: ResnapshotDayErrorCode
      message: string
      details?: unknown
    }

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Floating-point tolerance for the commission identity check. The
 * monetary columns are `numeric(10,2)`, so anything past the second
 * decimal would already fail the DB CHECK constraint. We compare with
 * 0.01 as a defensive cushion against rounding artefacts when the
 * supabase-js client deserialises numerics into JS numbers.
 */
const EPSILON = 0.01

interface TransactionConsistencyRow {
  branch: Branch
  business_date: string
  cashier_row_number: number
  staff: string
  base_commission: number | string | null
  balm_bonus: number | string | null
  booking_bonus: number | string | null
  addon: number | string | null
  total_commission: number | string | null
}

const CONSISTENCY_COLUMNS =
  'branch, business_date, cashier_row_number, staff, ' +
  'base_commission, balm_bonus, booking_bonus, addon, total_commission'

/**
 * Coerce a numeric column from supabase-js (which may return a string
 * for `numeric` columns depending on driver / runtime) into a finite
 * JS number. Non-finite or `null` values become `0` so the identity
 * check still produces a meaningful diff rather than `NaN`.
 */
function toNumber(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function resnapshotDay(
  input: unknown,
): Promise<ResnapshotDayResult> {
  // 1. Auth + role gate ----------------------------------------------------
  const profile = await getCurrentProfile()
  if (!profile) {
    return {
      ok: false,
      code: 'UNAUTHENTICATED',
      message: 'Sign in required',
    }
  }
  if (profile.role !== 'owner') {
    return {
      ok: false,
      code: 'NOT_OWNER',
      message: 'Only owner accounts may resnapshot a day',
    }
  }

  // 2. Validate input ------------------------------------------------------
  const parsed = resnapshotDayInputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'invalid input',
      details: parsed.error.flatten(),
    }
  }
  const { businessDate, branch } = parsed.data

  // 3. SELECT the day's rows ----------------------------------------------
  // RLS (`tx_owner_all` in migration 003) gives the owner full read
  // access across every branch, so a single query covers the
  // "branch omitted → all branches" case.
  const sb = createServerSupabaseClient()
  let query = sb
    .from('transactions')
    .select(CONSISTENCY_COLUMNS)
    .eq('business_date', businessDate)
  if (branch) {
    query = query.eq('branch', branch)
  }

  const { data: rows, error } = await query
  if (error) {
    return {
      ok: false,
      code: 'DB_ERROR',
      message: error.message,
      details: error,
    }
  }

  // 4. Verify the commission identity per row -----------------------------
  const warnings: string[] = []
  const typedRows = (rows ?? []) as unknown as TransactionConsistencyRow[]

  for (const row of typedRows) {
    const base = toNumber(row.base_commission)
    const balm = toNumber(row.balm_bonus)
    const book = toNumber(row.booking_bonus)
    const addon = toNumber(row.addon)
    const total = toNumber(row.total_commission)
    const expected = base + balm + book + addon
    const diff = Math.abs(total - expected)
    if (diff > EPSILON) {
      warnings.push(
        `Row ${row.branch}|${row.business_date}|${row.cashier_row_number} ` +
          `(staff "${row.staff}"): total_commission=${total} != ` +
          `base(${base}) + balm(${balm}) + book(${book}) + addon(${addon}) = ${expected} ` +
          `(diff ${diff.toFixed(2)})`,
      )
    }
  }

  return {
    ok: true,
    businessDate,
    branch: branch ?? null,
    checkedRows: typedRows.length,
    warnings,
  }
}
