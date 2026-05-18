'use server'

/**
 * `ownerDeleteTransaction` — heals-system-rebuild server action (task 7.6).
 *
 * Owner-only thin wrapper around {@link deleteTransaction} that adds
 * a downstream board recalculation step. The cashier-facing
 * `deleteTransaction` already supports the owner path (either
 * `{ rowId }` or `{ id }`) and bypasses the cashier-side
 * `business_date` guard when `profile.role === 'owner'`, so this
 * action does not duplicate the delete logic; it only
 *
 *   1. re-asserts `role === 'owner'` up front so any non-owner caller
 *      sees a clean `NOT_OWNER` instead of a downstream
 *      `INVALID_INPUT` (cashiers can't use `{ id }`) or `BRANCH_MISMATCH`;
 *   2. captures the deleted row's `business_date` (for `{ id }`
 *      payloads, by SELECT-ing before delegate; for `{ rowId }`
 *      payloads, by parsing the row id);
 *   3. delegates the delete to `deleteTransaction`;
 *   4. fires `resnapshotDay({ businessDate })` to verify the affected
 *      day is still consistent (the heals boards are computed live
 *      from rows, so this is a defensive check rather than a
 *      materialised rebuild);
 *   5. on recalc failure or when consistency warnings come back,
 *      persists the deletion (already persisted by step 3) and
 *      surfaces a `warning` field per Req 13.3 — the caller's UI
 *      shows a non-blocking toast so the owner knows the day may
 *      have drifted until they investigate.
 *
 * Audit logging is handled by the AFTER DELETE trigger installed in
 * migration `004_audit_trigger.sql` (Req 1.6); this action does not
 * need to write `audit_log` itself.
 *
 * Validates: Requirements 13.3 (owner full-power delete on past
 *            records; recalc failure surfaces as a warning rather
 *            than rolling back the deletion),
 *            1.2 (owner role gate enforced at the action layer in
 *            addition to RLS).
 */

import { z } from 'zod'

import { parseRowId } from '@/domain/row-id'
import { getCurrentProfile } from '@/lib/profile'
import { createServerSupabaseClient } from '@/lib/supabase/server'

import {
  deleteTransaction,
  type DeleteTransactionErrorCode,
} from './deleteTransaction'
import { resnapshotDay } from './resnapshotDay'

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const ownerDeleteTransactionInputSchema = z.union([
  z.object({ rowId: z.string().min(1) }),
  z.object({ id: z.string().uuid() }),
])

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type OwnerDeleteTransactionErrorCode =
  | 'UNAUTHENTICATED'
  | 'NOT_OWNER'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'DB_ERROR'

export type OwnerDeleteTransactionResult =
  | {
      ok: true
      businessDate: string
      /**
       * Set when the deletion succeeded but the downstream
       * `resnapshotDay` call failed. Per Req 13.3 the deletion is
       * still persisted; the UI uses this to render a non-blocking
       * toast so the owner can re-run the snapshot manually.
       */
      warning?: string
    }
  | {
      ok: false
      code: OwnerDeleteTransactionErrorCode
      message: string
      details?: unknown
    }

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function ownerDeleteTransaction(
  input: unknown,
): Promise<OwnerDeleteTransactionResult> {
  // 1. Auth gate. ----------------------------------------------------------
  const profile = await getCurrentProfile()
  if (!profile) {
    return {
      ok: false,
      code: 'UNAUTHENTICATED',
      message: 'Sign-in required',
    }
  }

  // 2. Role gate. ----------------------------------------------------------
  // Surface NOT_OWNER explicitly so callers never see the downstream
  // `INVALID_INPUT` ("Cashiers must use { rowId }") or a silent
  // `NOT_FOUND` after RLS strips the row.
  if (profile.role !== 'owner') {
    return {
      ok: false,
      code: 'NOT_OWNER',
      message: 'Owner role required',
    }
  }

  // 3. Validate the input shape. ------------------------------------------
  const parsed = ownerDeleteTransactionInputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Expected { rowId } or { id }',
      details: parsed.error.flatten(),
    }
  }

  // 4. Resolve `businessDate` for the recalculation step. ------------------
  // For `{ rowId }` payloads we can parse it locally — no DB roundtrip.
  // For `{ id }` payloads we must SELECT the row first so we know which
  // day to re-snapshot once the delete lands.
  let businessDate: string
  if ('rowId' in parsed.data) {
    try {
      businessDate = parseRowId(parsed.data.rowId).businessDate
    } catch {
      return {
        ok: false,
        code: 'INVALID_INPUT',
        message: 'Malformed rowId',
      }
    }
  } else {
    const sb = createServerSupabaseClient()
    const { data: row, error } = await sb
      .from('transactions')
      .select('business_date')
      .eq('id', parsed.data.id)
      .maybeSingle()
    if (error) {
      return {
        ok: false,
        code: 'DB_ERROR',
        message: error.message,
        details: error,
      }
    }
    if (!row) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: 'Transaction not found',
      }
    }
    businessDate = row.business_date as string
  }

  // 5. Delegate the actual delete to the shared action. -------------------
  // `deleteTransaction` already accepts both input shapes, runs the
  // owner-role bypass, and returns a structured result. We map its
  // error codes one-to-one onto our own (the union is a strict subset
  // of `DeleteTransactionErrorCode` plus our role-gate codes).
  const deleteResult = await deleteTransaction(parsed.data)
  if (!deleteResult.ok) {
    return {
      ok: false,
      code: mapDeleteErrorCode(deleteResult.code),
      message: deleteResult.message,
      details: deleteResult.details,
    }
  }

  // 6. Fire downstream recalculation. -------------------------------------
  // Per Req 13.3, recalculation is a best-effort step: the deletion is
  // already committed, so we never roll back on failure — instead the
  // caller is told via `warning` so the UI can prompt the owner to
  // re-run the snapshot. `resnapshotDay` may not yet exist in earlier
  // builds (task 7.16 is independently scheduled); the try/catch
  // ensures we degrade gracefully even if the underlying RPC is
  // missing rather than failing the whole action.
  let warning: string | undefined
  try {
    const recalc = await resnapshotDay({ businessDate })
    if (!recalc.ok) {
      warning = `Deletion persisted, but board recalculation failed: ${recalc.message}`
      // eslint-disable-next-line no-console
      console.warn('[ownerDeleteTransaction] resnapshotDay failed', {
        code: recalc.code,
        message: recalc.message,
        businessDate,
      })
    } else if (recalc.warnings.length > 0) {
      // Successful recheck that surfaced data-consistency anomalies.
      // Per Req 13.3 these are non-blocking — the deletion stays
      // committed and we just bubble the first issue to the caller.
      warning = `Deletion persisted, but consistency check flagged: ${recalc.warnings.join('; ')}`
      // eslint-disable-next-line no-console
      console.warn('[ownerDeleteTransaction] resnapshotDay warnings', {
        warnings: recalc.warnings,
        businessDate,
      })
    }
  } catch (err) {
    warning =
      'Deletion persisted, but board recalculation threw an unexpected error.'
    // eslint-disable-next-line no-console
    console.warn('[ownerDeleteTransaction] resnapshotDay threw', err)
  }

  return warning
    ? { ok: true, businessDate, warning }
    : { ok: true, businessDate }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Translate a `deleteTransaction` error code into our owner-facing
 * surface. The mapping is identity for every shared code; the
 * cashier-only codes (`BRANCH_MISMATCH`, `TOO_OLD`) are not reachable
 * from this action (we already gated on role === 'owner') so we
 * collapse them into `INVALID_INPUT` defensively.
 */
function mapDeleteErrorCode(
  code: DeleteTransactionErrorCode,
): OwnerDeleteTransactionErrorCode {
  switch (code) {
    case 'UNAUTHENTICATED':
    case 'INVALID_INPUT':
    case 'NOT_FOUND':
    case 'DB_ERROR':
      return code
    case 'BRANCH_MISMATCH':
    case 'TOO_OLD':
      // Unreachable on the owner path; surface as INVALID_INPUT so
      // the caller never sees a cashier-specific code.
      return 'INVALID_INPUT'
    default: {
      // Exhaustiveness check.
      const _exhaustive: never = code
      void _exhaustive
      return 'DB_ERROR'
    }
  }
}
