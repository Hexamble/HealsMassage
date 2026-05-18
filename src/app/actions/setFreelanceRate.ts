'use server'

/**
 * heals-system-rebuild — `setFreelanceRate` server action.
 *
 * Owner-only mutation that records a *new* freelance-rate row in the
 * `commission_rates` table. Rate changes never overwrite history: each
 * edit inserts a row with its own `effective_from` so the salary board
 * and any future historical recalc can look up the rate that was in
 * effect on a given business date (per design.md §"commission_rates"
 * and §"Server Actions"). The `lookupFreelanceRate(...)` helper in
 * `src/domain/commission.ts` resolves the most recent
 * `effective_from <= businessDate` row at compute time.
 *
 * Bishop FR floor:
 *   The Bishop freelance FR rate is *not* stored as its own row. It is
 *   derived at lookup time as `max(0, kimRate - 1)` and `max(0, chuRate
 *   - 1)` per Reqs 6.6 and 18.4. Owners therefore edit the
 *   Kimberry/Chulia base values under `branchGroup = 'all'` and the
 *   compute layer enforces the RM 0 floor — keeping the store side as
 *   plain data and the rule in one place.
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
 *   3. INSERT into `commission_rates` with `rate_type = 'freelance'`.
 *      INSERT, not upsert: the UNIQUE index on
 *      (course, duration, rate_type, branch_group, effective_from) means
 *      same-day re-edits collide; the action surfaces that as `DB_ERROR`
 *      so the UI can prompt the owner to advance `effective_from`.
 *      Audit logging is automatic via the AFTER INSERT trigger on
 *      `commission_rates` (migration `004_audit_trigger.sql`).
 *
 * Validates: Requirements 6.7 (owner-editable rate tables, point-in-time),
 *            18.5 (separate freelance commission table),
 *            20.5 (versioning by effective date).
 */

import { commissionRateSchema } from '@/domain/validators'
import { getCurrentProfile } from '@/lib/profile'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { Course, Duration } from '@/domain/types'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SetFreelanceRateErrorCode =
  | 'UNAUTHENTICATED'
  | 'NOT_OWNER'
  | 'INVALID_INPUT'
  | 'DB_ERROR'

export interface PersistedFreelanceRate {
  id: string
  course: Course
  duration: Duration
  rateType: 'freelance'
  branchGroup: string
  amount: number
  effectiveFrom: string
}

export type SetFreelanceRateResult =
  | { ok: true; row: PersistedFreelanceRate }
  | {
      ok: false
      code: SetFreelanceRateErrorCode
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
  rate_type: 'freelance'
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

export async function setFreelanceRate(
  input: unknown,
): Promise<SetFreelanceRateResult> {
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
      message: 'Only owner accounts may change freelance commission rates',
    }
  }

  // 2. Validate input ------------------------------------------------------
  const parsed = commissionRateSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Freelance rate input failed validation',
      details: parsed.error.flatten(),
    }
  }
  const data = parsed.data

  // Defence in depth: this action only writes freelance rates. If a
  // caller smuggles a `rateType` field (the schema allows both), reject
  // it so the audit trail accurately reflects which surface drove the
  // edit.
  if (data.rateType !== 'freelance') {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: "setFreelanceRate only writes rateType='freelance' rows",
    }
  }

  // 3. INSERT a new row ----------------------------------------------------
  // Rate edits create a new effective row; old rows remain for history.
  // Bishop FR floor at RM 0 is applied at lookup time, not here.
  const sb = createServerSupabaseClient()
  const { data: inserted, error: insertError } = await sb
    .from('commission_rates')
    .insert({
      course: data.course,
      duration: data.duration,
      rate_type: 'freelance',
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
      rateType: 'freelance',
      branchGroup: inserted.branch_group,
      amount: toNumber(inserted.amount),
      effectiveFrom: inserted.effective_from,
    },
  }
}
