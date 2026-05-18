'use server'

/**
 * heals-system-rebuild — `writeExpense` server action.
 *
 * Inserts a row into `expenses`. Both cashiers and the owner reach the
 * `expenses` table through this action, but the trust model differs:
 *
 *   - Cashier callers: `branch` is taken from the authenticated
 *     profile (the JWT's branch claim is also enforced by RLS), the
 *     input is permitted to omit `branch` entirely, and `businessDate`
 *     is always the server-canonical 5 AM Asia/Kuala_Lumpur cutoff
 *     (Requirement 4.x). `source` is persisted as `'Cashier'`.
 *   - Owner callers: `branch` is REQUIRED in the input (the owner
 *     profile carries no branch claim) and `businessDate` MAY be
 *     specified explicitly for historical backfill — when omitted it
 *     falls back to today's business date the same way the cashier
 *     path does. `source` is persisted as `'Manual'`.
 *
 * Pipeline:
 *   1. Resolve the current profile via `getCurrentProfile()`.
 *      Anonymous callers → `UNAUTHENTICATED` before touching the DB.
 *   2. Parse a permissive action input schema (loose `branch` /
 *      `businessDate`); reject malformed submissions with
 *      `INVALID_INPUT` and the flattened zod error tree.
 *   3. Determine the effective `branch` from the role:
 *        cashier → profile.branch (config error ⇒ `NOT_AUTHORIZED`)
 *        owner   → input.branch (missing ⇒ `INVALID_INPUT`)
 *   4. Determine the effective `businessDate`:
 *        cashier → `getBusinessDate(new Date())`
 *        owner   → `input.businessDate ?? getBusinessDate(new Date())`
 *   5. Build the canonical `{branch, item, amount, method, note}`
 *      payload and validate it with the shared `expenseSchema` from
 *      validators (Req 17.1, 17.3 — non-empty item, positive amount,
 *      method enum). This is the trust boundary for the persisted
 *      row's value rules.
 *   6. INSERT through the user-bound SSR client so RLS applies
 *      (`exp_owner_all` / `exp_cashier_branch_all` in
 *      `003_rls_policies.sql`). The audit trail is written
 *      automatically by the AFTER INSERT trigger on `expenses`
 *      (`004_audit_trigger.sql`); no manual audit_log insert here.
 *   7. Return a discriminated union — never throws on validation,
 *     auth, or DB errors. Unexpected runtime failures bubble up.
 *
 * Validates: Requirement 17.1 (cashier-side cashier-source expense),
 *            Requirement 17.2 (server-derived branch + business_date),
 *            Requirement 17.3 (item non-empty, amount strictly positive,
 *            method enum), Requirement 17.4 (owner-side `'Manual'`
 *            source with historical backfill).
 *
 * @see c:/BILL/.kiro/specs/heals-system-rebuild/design.md §"Server Actions"
 * @see c:/BILL/.kiro/specs/heals-system-rebuild/requirements.md §17
 */

import { z } from 'zod'

import { branchSchema, expenseSchema } from '@/domain/validators'
import { getBusinessDate } from '@/domain/business-date'
import { getCurrentProfile } from '@/lib/profile'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { Branch, ExpenseRow, PaymentMethod } from '@/domain/types'

// ---------------------------------------------------------------------------
// Action input schema
//
// Permissive shape: `branch` and `businessDate` are optional at parse
// time so cashier callers can submit `{item, amount, method, note}`
// alone. Role-specific requirements (owner must supply `branch`) are
// enforced after the parse, where we have the resolved profile in
// hand.
// ---------------------------------------------------------------------------

const writeExpenseInputSchema = z.object({
  item: z.string({ required_error: 'item is required' }),
  amount: z.number({ required_error: 'amount is required' }),
  method: z.string({ required_error: 'method is required' }),
  note: z.string().optional().default(''),
  /** Owner callers MUST specify; cashier callers MAY omit (uses profile). */
  branch: branchSchema.optional(),
  /** Owner-only override for historical backfill. */
  businessDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'businessDate must be yyyy-MM-dd')
    .optional(),
})

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type WriteExpenseErrorCode =
  | 'UNAUTHENTICATED'
  | 'NOT_AUTHORIZED'
  | 'INVALID_INPUT'
  | 'DB_ERROR'

export type WriteExpenseResult =
  | { ok: true; row: ExpenseRow }
  | {
      ok: false
      code: WriteExpenseErrorCode
      message: string
      details?: unknown
    }

// ---------------------------------------------------------------------------
// Internal DB row shape (snake_case as returned by PostgREST)
// ---------------------------------------------------------------------------

interface DbExpenseRow {
  id: string
  branch: Branch
  business_date: string
  item: string
  amount: number | string
  method: string
  note: string | null
  source: 'Cashier' | 'Manual'
  created_at: string
  created_by: string | null
}

function toExpenseRow(row: DbExpenseRow): ExpenseRow {
  return {
    id: row.id,
    branch: row.branch,
    businessDate: row.business_date,
    item: row.item,
    // `numeric(10,2)` round-trips as a string from PostgREST; coerce to
    // number for the API surface so callers don't deal with both shapes.
    amount: typeof row.amount === 'string' ? Number(row.amount) : row.amount,
    method: row.method as PaymentMethod | 'Other',
    note: row.note ?? '',
    source: row.source,
    createdAt: row.created_at,
    createdBy: row.created_by,
  }
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function writeExpense(
  input: unknown,
): Promise<WriteExpenseResult> {
  // 1. Auth gate ----------------------------------------------------------
  const profile = await getCurrentProfile()
  if (!profile) {
    return {
      ok: false,
      code: 'UNAUTHENTICATED',
      message: 'Sign in required',
    }
  }

  // 2. Parse the loose action input --------------------------------------
  const parsedInput = writeExpenseInputSchema.safeParse(input)
  if (!parsedInput.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Expense input failed validation',
      details: parsedInput.error.flatten(),
    }
  }
  const data = parsedInput.data

  // 3. Determine the effective branch ------------------------------------
  let branch: Branch
  if (profile.role === 'cashier') {
    if (!profile.branch) {
      // A cashier profile without a branch is a config error — RLS
      // would block any write anyway, but surfacing this as
      // NOT_AUTHORIZED gives the UI a clearer error than a generic
      // RLS denial.
      return {
        ok: false,
        code: 'NOT_AUTHORIZED',
        message: 'Cashier profile is missing a branch assignment',
      }
    }
    branch = profile.branch
  } else {
    // Owner — branch must be supplied explicitly.
    if (!data.branch) {
      return {
        ok: false,
        code: 'INVALID_INPUT',
        message: 'Owner expense entry requires a branch',
      }
    }
    branch = data.branch
  }

  // 4. Determine the effective business date ------------------------------
  // Cashier: always the server-canonical 5 AM cutoff. Owner: optional
  // explicit override for historical backfill, otherwise the same
  // cutoff value.
  const businessDate =
    profile.role === 'owner' && data.businessDate
      ? data.businessDate
      : getBusinessDate(new Date())

  // 5. Validate the canonical persisted shape via expenseSchema ----------
  const canonicalParse = expenseSchema.safeParse({
    branch,
    item: data.item,
    amount: data.amount,
    method: data.method,
    note: data.note ?? '',
  })
  if (!canonicalParse.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Expense input failed validation',
      details: canonicalParse.error.flatten(),
    }
  }
  const expense = canonicalParse.data

  const source: 'Cashier' | 'Manual' =
    profile.role === 'cashier' ? 'Cashier' : 'Manual'

  // 6. INSERT via the user-bound client so RLS applies -------------------
  const sb = createServerSupabaseClient()
  const { data: inserted, error: insertError } = await sb
    .from('expenses')
    .insert({
      branch: expense.branch,
      business_date: businessDate,
      item: expense.item,
      amount: expense.amount,
      method: expense.method,
      note: expense.note,
      source,
      created_by: profile.userId,
    })
    .select()
    .single<DbExpenseRow>()

  if (insertError || !inserted) {
    return {
      ok: false,
      code: 'DB_ERROR',
      message: insertError?.message ?? 'Insert returned no row',
      details: insertError,
    }
  }

  // 7. Shaped result ------------------------------------------------------
  return { ok: true, row: toExpenseRow(inserted) }
}
