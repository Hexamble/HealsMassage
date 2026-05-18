'use server'

/**
 * heals-system-rebuild — `ownerSetDayCommission` server action (task 7.15).
 *
 * Owner-only override of the computed commission parts for a specific
 * `transactions` row. The owner edits one or more of the part columns
 * (`baseCommission`, `balmBonus`, `bookingBonus`, `addon`) and the
 * server recomputes `totalCommission = base + balm + book + addon` so
 * the `total_commission_equals_parts` CHECK constraint (migration
 * `001_init_schema.sql`) is always satisfied.
 *
 * Audit:
 *   The `audit_transactions` AFTER UPDATE trigger installed by
 *   migration `004_audit_trigger.sql` records this write into
 *   `audit_log` automatically (Req 1.6). This action does NOT insert
 *   into `audit_log` itself; the trigger captures the actor via
 *   `auth.uid()` from the user-bound SSR client session.
 *
 * Input shape (`OwnerSetDayCommissionInput`):
 *   - `id: string`              — UUID primary key of the target row.
 *   - `baseCommission?: number` — optional override of `base_commission`.
 *   - `balmBonus?: number`      — optional override of `balm_bonus`.
 *   - `bookingBonus?: number`   — optional override of `booking_bonus`.
 *   - `addon?: number`          — optional override of `addon`.
 *   At least one of the four optional fields must be present.
 *
 * Pipeline:
 *   1. Auth gate — `getCurrentProfile()`. Anonymous → `UNAUTHENTICATED`.
 *   2. Role gate — non-owner → `NOT_OWNER`. RLS (`tx_owner_all` from
 *      `003_rls_policies.sql`) is already permissive for owner; the
 *      explicit application-layer check produces a clear error code.
 *   3. Validate input via Zod. Empty patch (no override fields) → reject.
 *   4. SELECT the existing row by `id` to fetch the current parts. The
 *      missing fields in the patch fall back to the row's current
 *      values so the recomputed total is consistent with the CHECK.
 *   5. Recompute `total_commission` from the merged parts (server side).
 *   6. UPDATE the row with the merged parts + new total. PostgREST
 *      returns the persisted row via `.select(...).single()`. The
 *      audit trigger fires on the UPDATE.
 *   7. Return `{ ok: true, row }` (camelCase projection) or a
 *      discriminated `{ ok: false, code, message }` error.
 *
 * Validates: Requirements 1.6 (audit trail via DB trigger),
 *            13.3 (owner full-power edit on past records).
 *
 * @see c:/BILL/.kiro/specs/heals-system-rebuild/design.md
 *      §"Server Actions" → §"Audit Logging"
 * @see c:/BILL/.kiro/specs/heals-system-rebuild/requirements.md §1.6, §13.3
 */

import { z } from 'zod'

import { getCurrentProfile } from '@/lib/profile'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { buildRowId } from '@/domain/row-id'
import type {
  Branch,
  Course,
  Duration,
} from '@/domain/types'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type OwnerSetDayCommissionErrorCode =
  | 'UNAUTHENTICATED'
  | 'NOT_OWNER'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'DB_ERROR'

/**
 * Camel-case projection of the persisted `transactions` row, matching
 * the shape returned by `writeTransaction` so the cashier / Boss HQ UI
 * can normalise on a single row type regardless of which action wrote
 * the change.
 */
export interface PersistedTransactionRow {
  id: string
  rowId: string
  branch: Branch
  businessDate: string
  cashierRowNumber: number
  staff: string
  course: Course
  duration: Duration
  timeIn: string | null
  timeOut: string | null
  method: string
  addon: number
  baseCommission: number
  balmBonus: number
  bookingBonus: number
  totalCommission: number
  cash: number
  qr: number
  credit: number
  price: number
  flags: string
  comment: string
  createdAt: string
  updatedAt: string
  createdBy: string | null
}

export interface OwnerSetDayCommissionInput {
  id: string
  baseCommission?: number
  balmBonus?: number
  bookingBonus?: number
  addon?: number
}

export type OwnerSetDayCommissionResult =
  | { ok: true; row: PersistedTransactionRow }
  | {
      ok: false
      code: OwnerSetDayCommissionErrorCode
      message: string
      details?: unknown
    }

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const ownerSetDayCommissionInputSchema = z
  .object({
    id: z.string().uuid('id must be a UUID'),
    baseCommission: z.number().nonnegative().optional(),
    balmBonus: z.number().nonnegative().optional(),
    bookingBonus: z.number().nonnegative().optional(),
    addon: z.number().nonnegative().optional(),
  })
  .refine(
    (data) =>
      data.baseCommission !== undefined ||
      data.balmBonus !== undefined ||
      data.bookingBonus !== undefined ||
      data.addon !== undefined,
    {
      message:
        'At least one of baseCommission, balmBonus, bookingBonus, addon must be provided',
    },
  )

// ---------------------------------------------------------------------------
// Snake_case shape returned by PostgREST
// ---------------------------------------------------------------------------

const TX_COLUMNS = [
  'id',
  'branch',
  'business_date',
  'cashier_row_number',
  'staff',
  'course',
  'duration',
  'time_in',
  'time_out',
  'method',
  'addon',
  'base_commission',
  'balm_bonus',
  'booking_bonus',
  'total_commission',
  'cash',
  'qr',
  'credit',
  'price',
  'flags',
  'comment',
  'created_at',
  'updated_at',
  'created_by',
].join(', ')

interface TransactionDbRow {
  id: string
  branch: Branch
  business_date: string
  cashier_row_number: number
  staff: string
  course: Course
  duration: number
  time_in: string | null
  time_out: string | null
  method: string
  addon: number | string
  base_commission: number | string
  balm_bonus: number | string
  booking_bonus: number | string
  total_commission: number | string
  cash: number | string
  qr: number | string
  credit: number | string
  price: number | string
  flags: string | null
  comment: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function ownerSetDayCommission(
  input: unknown,
): Promise<OwnerSetDayCommissionResult> {
  // 1. Auth gate ------------------------------------------------------------
  const profile = await getCurrentProfile()
  if (!profile) {
    return {
      ok: false,
      code: 'UNAUTHENTICATED',
      message: 'Sign in required',
    }
  }

  // 2. Role gate ------------------------------------------------------------
  if (profile.role !== 'owner') {
    return {
      ok: false,
      code: 'NOT_OWNER',
      message: 'Only owner accounts may override commission parts',
    }
  }

  // 3. Validate input -------------------------------------------------------
  const parsed = ownerSetDayCommissionInputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'Invalid input',
      details: parsed.error.flatten(),
    }
  }
  const patch = parsed.data

  const sb = createServerSupabaseClient()

  // 4. Fetch the existing row to merge missing parts -----------------------
  //    The `total_commission_equals_parts` CHECK constraint requires the
  //    full identity to hold on the new row; for any part the caller
  //    omits, fall back to the row's current value before recomputing
  //    the total.
  const { data: existing, error: fetchErr } = await sb
    .from('transactions')
    .select('base_commission, balm_bonus, booking_bonus, addon')
    .eq('id', patch.id)
    .maybeSingle<{
      base_commission: number | string
      balm_bonus: number | string
      booking_bonus: number | string
      addon: number | string
    }>()

  if (fetchErr) {
    return {
      ok: false,
      code: 'DB_ERROR',
      message: fetchErr.message,
      details: fetchErr,
    }
  }
  if (!existing) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: `No transaction with id ${patch.id}`,
    }
  }

  // 5. Resolve merged parts + recompute total ------------------------------
  const mergedBase =
    patch.baseCommission ?? toNumber(existing.base_commission)
  const mergedBalm = patch.balmBonus ?? toNumber(existing.balm_bonus)
  const mergedBook = patch.bookingBonus ?? toNumber(existing.booking_bonus)
  const mergedAddon = patch.addon ?? toNumber(existing.addon)
  const totalCommission =
    Math.round((mergedBase + mergedBalm + mergedBook + mergedAddon) * 100) / 100

  // 6. UPDATE the row -------------------------------------------------------
  //    The audit trigger captures the change; no manual audit_log insert.
  const { data: updated, error: updateErr } = await sb
    .from('transactions')
    .update({
      base_commission: mergedBase,
      balm_bonus: mergedBalm,
      booking_bonus: mergedBook,
      addon: mergedAddon,
      total_commission: totalCommission,
    })
    .eq('id', patch.id)
    .select(TX_COLUMNS)
    .maybeSingle<TransactionDbRow>()

  if (updateErr) {
    return {
      ok: false,
      code: 'DB_ERROR',
      message: updateErr.message,
      details: updateErr,
    }
  }
  if (!updated) {
    // Row vanished between SELECT and UPDATE (or RLS rejected). Surface
    // as NOT_FOUND so the UI can refetch.
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: `Transaction ${patch.id} not found or not editable`,
    }
  }

  return { ok: true, row: mapPersistedRow(updated) }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapPersistedRow(row: TransactionDbRow): PersistedTransactionRow {
  const branch = row.branch
  const businessDate = row.business_date
  const cashierRowNumber = Number(row.cashier_row_number)
  return {
    id: String(row.id),
    rowId: buildRowId(branch, businessDate, cashierRowNumber),
    branch,
    businessDate,
    cashierRowNumber,
    staff: String(row.staff),
    course: row.course,
    duration: Number(row.duration) as Duration,
    timeIn: row.time_in == null ? null : String(row.time_in),
    timeOut: row.time_out == null ? null : String(row.time_out),
    method: String(row.method),
    addon: toNumber(row.addon),
    baseCommission: toNumber(row.base_commission),
    balmBonus: toNumber(row.balm_bonus),
    bookingBonus: toNumber(row.booking_bonus),
    totalCommission: toNumber(row.total_commission),
    cash: toNumber(row.cash),
    qr: toNumber(row.qr),
    credit: toNumber(row.credit),
    price: toNumber(row.price),
    flags: String(row.flags ?? ''),
    comment: String(row.comment ?? ''),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
    createdBy: row.created_by == null ? null : String(row.created_by),
  }
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (value == null) return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}
