'use server'

/**
 * `deleteExpense` — heals-system-rebuild server action (task 7.8).
 *
 * Hard-deletes a single row from `expenses`. The audit trail is
 * captured automatically by the AFTER DELETE trigger installed in
 * migration `004_audit_trigger.sql` (Req 1.6), so this action does
 * not write to `audit_log` itself.
 *
 * Input shape:
 *   - `{ id }` — UUID primary key of the `expenses` row to delete.
 *
 * Authorization (Req 1.2, 1.3, 17.4):
 *   - Cashier: may only delete rows in their own branch where
 *     `business_date` equals the server-canonical business date
 *     (`getBusinessDate(now)`, 5 AM Asia/Kuala_Lumpur cutoff). The
 *     action SELECTs the row first (under RLS, so a cross-branch row
 *     surfaces as `NOT_FOUND` rather than `BRANCH_MISMATCH`),
 *     enforces the branch + business_date pre-checks in application
 *     code, then DELETEs. RLS (`exp_cashier_branch_all`) is the
 *     authoritative gate; the explicit checks produce clear error
 *     codes (`BRANCH_MISMATCH`, `TOO_OLD`) instead of an opaque
 *     `NOT_FOUND` after a count-zero delete.
 *   - Owner: may delete any row regardless of branch or
 *     `business_date`. RLS (`exp_owner_all`) is already permissive.
 *
 * Discriminated-union return shape — the action never throws on
 * validation, auth, or DB errors; every failure becomes a
 * `{ ok: false, code, message }` value the UI maps to a toast string.
 *
 * Validates: Requirement 1.6 (writes — including deletes — captured
 *            in the audit log via DB trigger),
 *            Requirement 17.4 (owner full-power expense management;
 *            cashier scope limited to own-branch / current-day).
 *
 * @see c:/BILL/.kiro/specs/heals-system-rebuild/design.md §"Server Actions"
 * @see c:/BILL/.kiro/specs/heals-system-rebuild/requirements.md §17
 */

import { z } from 'zod'

import { getBusinessDate } from '@/domain/business-date'
import { getCurrentProfile } from '@/lib/profile'
import { createServerSupabaseClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const deleteExpenseInputSchema = z.object({
  id: z.string().uuid(),
})

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DeleteExpenseErrorCode =
  | 'UNAUTHENTICATED'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'BRANCH_MISMATCH'
  | 'TOO_OLD'
  | 'DB_ERROR'

export type DeleteExpenseResult =
  | { ok: true; code?: undefined; message?: undefined }
  | {
      ok: false
      code: DeleteExpenseErrorCode
      message: string
      details?: unknown
    }

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function deleteExpense(
  input: unknown,
): Promise<DeleteExpenseResult> {
  // 1. Auth gate. ----------------------------------------------------------
  const profile = await getCurrentProfile()
  if (!profile) {
    return {
      ok: false,
      code: 'UNAUTHENTICATED',
      message: 'Sign-in required',
    }
  }

  // 2. Input validation. ---------------------------------------------------
  const parsed = deleteExpenseInputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Expected { id }',
      details: parsed.error.flatten(),
    }
  }
  const { id } = parsed.data

  const sb = createServerSupabaseClient()

  // 3. Cashier pre-check. --------------------------------------------------
  // SELECT first so a cross-branch or stale-day delete surfaces with a
  // precise error code. RLS already prevents cross-branch reads for
  // cashiers (so foreign-branch ids return `NOT_FOUND` here), but the
  // explicit application-layer checks give the UI clear messages for
  // own-branch-but-too-old rows.
  if (profile.role === 'cashier') {
    const { data: row, error: selectError } = await sb
      .from('expenses')
      .select('branch, business_date')
      .eq('id', id)
      .maybeSingle()

    if (selectError) {
      return {
        ok: false,
        code: 'DB_ERROR',
        message: selectError.message,
        details: selectError,
      }
    }

    if (!row) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: 'Expense not found',
      }
    }

    if (profile.branch !== row.branch) {
      return {
        ok: false,
        code: 'BRANCH_MISMATCH',
        message: 'Cashiers may only delete expenses from their own branch',
      }
    }

    const today = getBusinessDate(new Date())
    if (row.business_date !== today) {
      return {
        ok: false,
        code: 'TOO_OLD',
        message:
          'Cashiers may only delete expenses for the current business date',
      }
    }
  }

  // 4. DELETE via the user-bound client so RLS applies. -------------------
  const { error, count } = await sb
    .from('expenses')
    .delete({ count: 'exact' })
    .eq('id', id)

  if (error) {
    return {
      ok: false,
      code: 'DB_ERROR',
      message: error.message,
      details: error,
    }
  }

  // count === 0 means RLS rejected the delete (e.g., a stale cashier
  // session pointing at a row outside their branch) or the row was
  // already removed between the pre-check and the delete. Either way
  // the caller sees a clean `NOT_FOUND` rather than a silent success.
  if (!count) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: 'Expense not found or not deletable',
    }
  }

  return { ok: true }
}
