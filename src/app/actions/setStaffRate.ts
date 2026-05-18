'use server'

/**
 * heals-system-rebuild — `setStaffRate` server action.
 *
 * Owner-only mutation that records a *new* regular-rate row in the
 * `commission_rates` table. Rate changes never overwrite history: each
 * edit inserts a row with its own `effective_from` so the salary board
 * and any future historical recalc can look up the rate that was in
 * effect on a given business date (per design.md §"commission_rates"
 * and §"Server Actions"). The `lookupRegularRate(...)` helper in
 * `src/domain/commission.ts` resolves the most recent
 * `effective_from <= businessDate` row at compute time.
 *
 * Pipeline:
 *   1. Resolve the current profile via `getCurrentProfile()`. Reject
 *      anonymous (`UNAUTHENTICATED`) and non-owner (`NOT_OWNER`) callers
 *      before touching the database. RLS on `commission_rates` (policy
 *      `rates_owner_all` in migration `003_rls_policies.sql`) is the
 *      ultimate gate, but the application-level check returns a clearer
 *      error code for the owner rate-editor UI (Task 19.1).
 *   2. Validate input with `commissionRateSchema`. The shared schema
 *      enforces course / duration enums, non-negative amount, and
 *      yyyy-MM-dd format on `effectiveFrom`. `branchGroup` defaults to
 *      `'all'`.
 *   3. INSERT into `commission_rates` with `rate_type = 'regular'`.
 *      INSERT, not upsert: the UNIQUE index on
 *      (course, duration, rate_type, branch_group, effective_from) means
 *      same-day re-edits collide; the action surfaces that as `DB_ERROR`
 *      so the UI can prompt the owner to advance `effective_from`.
 *      Audit logging is automatic via the AFTER INSERT trigger on
 *      `commission_rates` (migration `004_audit_trigger.sql`).
 *
 * Validates: Requirements 6.7 (owner-editable rate tables, point-in-time),
 *            18.5 (separate freelance table — counterpart action),
 *            20.5 (versioning by effective date).
 */

import { commissionRateSchema } from '@/domain/validators'
import { getCurrentProfile } from '@/lib/profile'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { Course, Duration } from '@/domain/types'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SetStaffRateErrorCode =
  | 'UNAUTHENTICATED'
  | 'NOT_OWNER'
  | 'INVALID_INPUT'
  | 'DB_ERROR'

export interface PersistedCommissionRate {
  id: string
  course: Course
  duration: Duration
  rateType: 'regular'
  branchGroup: string
  amount: number
  effectiveFrom: string
}

export type SetStaffRateResult =
  | { ok: true; row: PersistedCommissionRate }
  | {
      ok: false
      code: SetStaffRateErrorCode
      message: string
      details?: unknown
    }

// ---------------------------------------------------------------------------
// Internal row shape (snake_case as returned by PostgREST). `amount` is a
// `numeric(10,2)` column so PostgREST returns it as a string — coerce on
// the way out.
// ---------------------------------------------------------------------------

interface CommissionRateDbRow {
  id: string
  course: Course
  duration: Duration
  rate_type: 'regular'
  branch_group: string
  amount: string | number
  effective_from: string
}

function toNumber(value: string | number): number {
  return typeof value === 'number' ? value : Number.parseFloat(value)
}

function todayIso(): string {
  // YYYY-MM-DD in local time. Matches the DATE column shape used by
  // `effective_from`.
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function setStaffRate(input: unknown): Promise<SetStaffRateResult> {
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
      message: 'Only owner accounts may change staff commission rates',
    }
  }

  // 2. Validate input ------------------------------------------------------
  const parsed = commissionRateSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Staff rate input failed validation',
      details: parsed.error.flatten(),
    }
  }
  const data = parsed.data

  // Defence in depth: this action only writes regular rates. If a caller
  // smuggles a `rateType` field (the schema allows both), reject it.
  if (data.rateType !== 'regular') {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: "setStaffRate only writes rateType='regular' rows",
    }
  }

  // 3. INSERT a new row ----------------------------------------------------
  // Rate edits create a new effective row; old rows remain for history.
  const sb = createServerSupabaseClient()
  const { data: inserted, error: insertError } = await sb
    .from('commission_rates')
    .insert({
      course: data.course,
      duration: data.duration,
      rate_type: 'regular',
      branch_group: data.branchGroup,
      amount: data.amount,
      effective_from: data.effectiveFrom ?? todayIso(),
    })
    .select('id, course, duration, rate_type, branch_group, amount, effective_from')
    .single<CommissionRateDbRow>()

  if (insertError || !inserted) {
    return {
      ok: false,
      code: 'DB_ERROR',
      message: insertError?.message ?? 'Insert returned no row',
      details: insertError,
    }
  }

  return {
    ok: true,
    row: {
      id: inserted.id,
      course: inserted.course,
      duration: inserted.duration,
      rateType: 'regular',
      branchGroup: inserted.branch_group,
      amount: toNumber(inserted.amount),
      effectiveFrom: inserted.effective_from,
    },
  }
}
