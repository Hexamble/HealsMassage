'use server'

/**
 * `deleteTransaction` — heals-system-rebuild server action (task 7.5).
 *
 * Hard-deletes a single row from `transactions`. The audit trail is
 * captured automatically by the AFTER DELETE trigger installed in
 * migration `004_audit_trigger.sql` (Req 1.6), so this action does
 * not write to `audit_log` itself.
 *
 * Input shape (discriminated union):
 *   - `{ rowId }` — `"{branch}|{business_date}|{cashier_row_number}"`,
 *     the cashier-facing key (Req 3.1). Used by the cashier UI; also
 *     accepted on the owner path.
 *   - `{ id }` — UUID primary key, owner-only path used by Boss HQ
 *     when editing or deleting historical rows.
 *
 * Authorization (Req 1.2, 1.3):
 *   - Cashier: may only delete rows in their own branch where
 *     `business_date` equals the server-canonical business date
 *     (`getBusinessDate(now)`, 5 AM Asia/Kuala_Lumpur cutoff). RLS
 *     additionally enforces the branch filter; the explicit
 *     application-layer check produces clear error codes
 *     (`BRANCH_MISMATCH`, `TOO_OLD`) instead of an opaque
 *     `NOT_FOUND` after a count-zero delete.
 *     Cashiers must use the `rowId` path; supplying `{ id }` returns
 *     `INVALID_INPUT` so the owner-only column key never leaks into
 *     the cashier UI.
 *   - Owner: may delete any row regardless of branch or
 *     `business_date` (Req 13.3). Either path (`rowId` or `id`) is
 *     accepted. RLS (`tx_owner_all`) is already permissive.
 *
 * Discriminated-union return shape — the action never throws; every
 * error becomes a `{ ok: false, code, message }` value the UI maps
 * to a toast string.
 *
 * Validates: Requirements 1.6 (writes — including deletes — captured
 *            in the audit log via DB trigger),
 *            13.3 (owner full-power edit / add / delete on past
 *            records).
 *
 * See `c:/BILL/.kiro/specs/heals-system-rebuild/design.md`
 *     §"Server Actions" and §"Row Level Security policies".
 */

import { z } from 'zod'

import { getBusinessDate } from '@/domain/business-date'
import { parseRowId } from '@/domain/row-id'
import { getCurrentProfile } from '@/lib/profile'
import { createServerSupabaseClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

/**
 * Either `{ rowId }` (cashier or owner) or `{ id }` (owner-only). The
 * union is decoded with `z.union` so a payload missing both keys is
 * rejected up front with `INVALID_INPUT` and never reaches the DB.
 */
const deleteTransactionInputSchema = z.union([
  z.object({ rowId: z.string().min(1) }),
  z.object({ id: z.string().uuid() }),
])

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DeleteTransactionErrorCode =
  | 'UNAUTHENTICATED'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'BRANCH_MISMATCH'
  | 'TOO_OLD'
  | 'DB_ERROR'

export type DeleteTransactionResult =
  | { ok: true; code?: undefined; message?: undefined }
  | {
      ok: false
      code: DeleteTransactionErrorCode
      message: string
      details?: unknown
    }

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function deleteTransaction(
  input: unknown,
): Promise<DeleteTransactionResult> {
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
  const parsed = deleteTransactionInputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Expected { rowId } or { id }',
      details: parsed.error.flatten(),
    }
  }

  const sb = createServerSupabaseClient()

  // 3. Owner UUID path ------------------------------------------------------
  // Only owners may delete by id. Cashiers receive `INVALID_INPUT` so the
  // UUID surface never leaks into the per-branch UI.
  if ('id' in parsed.data) {
    if (profile.role !== 'owner') {
      return {
        ok: false,
        code: 'INVALID_INPUT',
        message: 'Cashiers must use { rowId }',
      }
    }
    const { error, count } = await sb
      .from('transactions')
      .delete({ count: 'exact' })
      .eq('id', parsed.data.id)
    if (error) {
      return {
        ok: false,
        code: 'DB_ERROR',
        message: error.message,
        details: error,
      }
    }
    if (!count) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: 'Transaction not found',
      }
    }
    return { ok: true }
  }

  // 4. rowId path (cashier always, owner allowed) --------------------------
  let parsedRow
  try {
    parsedRow = parseRowId(parsed.data.rowId)
  } catch {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Malformed rowId',
    }
  }

  // Cashier-only pre-checks. The owner role bypasses both: branch
  // (owners are not pinned) and business_date (owners may delete any
  // historical row per Req 13.3).
  if (profile.role === 'cashier') {
    if (profile.branch !== parsedRow.branch) {
      return {
        ok: false,
        code: 'BRANCH_MISMATCH',
        message: 'Cashiers may only delete rows from their own branch',
      }
    }
    const today = getBusinessDate(new Date())
    if (parsedRow.businessDate !== today) {
      return {
        ok: false,
        code: 'TOO_OLD',
        message: 'Cashiers may only delete rows for the current business date',
      }
    }
  }

  const { error, count } = await sb
    .from('transactions')
    .delete({ count: 'exact' })
    .eq('branch', parsedRow.branch)
    .eq('business_date', parsedRow.businessDate)
    .eq('cashier_row_number', parsedRow.cashierRowNumber)

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
  // already removed between request and delete. Either way the caller
  // sees a clean `NOT_FOUND` rather than a silent success.
  if (!count) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: 'Transaction not found or not deletable',
    }
  }

  return { ok: true }
}
